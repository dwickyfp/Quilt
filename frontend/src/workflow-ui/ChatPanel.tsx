import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Loader2, Plus, Send, Settings, Sparkles, Trash2, X, Workflow } from 'lucide-react';
import {
    chatExtractPipeline,
    chatSend,
    type ChatMessage,
} from '../tauri-bridge';
import { isAiConfigured, type AiProviderConfig } from '../ai-provider';
import {
    loadAiSettings,
    saveAiSettings,
    resolveActiveConfig,
    listAllModels,
    type AiSettings,
} from '../ai-settings';
import { serializeGraph, type GraphNodeInput, type GraphEdgeInput } from './graph-context';
import { extractGraphPatch, summarizePatch, type GraphPatchOp } from './graph-patch';
import { parseToolCall, validateToolCall, getSkill, type ToolCall } from './agent-skills';
import { buildAgentPrompt, formatObservation, canContinue, type ToolResult } from './agent-loop';
import { hardenPrompt, validateAgainstGraph, isRepeatCall } from './agent-guardrails';
import {
    type ChatSession,
    type StoredMessage,
    loadSessions,
    saveSession,
    deleteSession,
    getSession,
    newSessionId,
    deriveTitle,
    saveActiveSessionId,
    loadActiveSessionId,
} from './chat-history';

type Props = {
    onClose: () => void;
    onInsertPipeline: (pipeline: unknown) => void;
    onOpenSettings: () => void;
    nodes: GraphNodeInput[];
    edges: GraphEdgeInput[];
    onApplyPatch: (ops: GraphPatchOp[]) => void;
};

type Bubble = ChatMessage & {
    /** True while tokens are still streaming in. */
    streaming?: boolean;
    /** Cached extracted pipeline, computed after the stream finishes. */
    pipeline?: unknown;
    /** Proposed graph patch detected in the reply (C4). */
    patch?: GraphPatchOp[];
    /** True once the user has applied the proposed patch. */
    patchApplied?: boolean;
    /** Pending HITL approval for an agent tool call (feature #4). */
    approval?: ToolCall;
    /** Set once the user has resolved the approval ('approved' | 'rejected'). */
    approvalResolved?: 'approved' | 'rejected';
    /** Skill-used trace chip: the executed tool name + ok/err outcome. */
    trace?: { tool: string; ok: boolean };
};

const EXAMPLE_PROMPTS = [
    'Read orders.csv, filter where status = "shipped", write to shipped.parquet',
    'Pull GitHub issues from my repo and load them into a Postgres table',
    'Embed the description column with OpenAI and dedupe near-duplicates',
];

/**
 * Restore the last active session on mount so closing and reopening the panel
 * resumes where the user left off (instead of starting a blank session). Falls
 * back to a fresh session id with no messages when there's nothing to restore.
 */
function restoreActiveSession(): { id: string; messages: Bubble[] } {
    const id = loadActiveSessionId();
    if (id) {
        const s = getSession(id);
        if (s) {
            return { id, messages: s.messages.map(m => ({ role: m.role, content: m.content })) };
        }
    }
    return { id: newSessionId(), messages: [] };
}

export default function ChatPanel({ onClose, onInsertPipeline, onOpenSettings, nodes, edges, onApplyPatch }: Props) {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
    // Restore the last active session once, before the first render, so both
    // messages and sessionId init from the same snapshot.
    const restoredRef = useRef<{ id: string; messages: Bubble[] } | null>(null);
    if (restoredRef.current === null) restoredRef.current = restoreActiveSession();
    const [messages, setMessages] = useState<Bubble[]>(() => restoredRef.current!.messages);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // Set true by the Stop button to break the ReAct loop on the next check.
    const cancelledRef = useRef(false);
    // Resolver for the pending HITL approval promise — the Approve/Reject
    // buttons call this to unblock the paused agent loop. Null when no
    // approval is pending.
    const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);

    // Chat history: the active session id, whether the history popover is open,
    // and the cached session list (refreshed when the popover opens).
    const [sessionId, setSessionId] = useState<string>(() => restoredRef.current!.id);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const historyRef = useRef<HTMLDivElement | null>(null);

    const config: AiProviderConfig | null = resolveActiveConfig(settings);
    const configured = config != null && isAiConfigured(config);
    const allModels = listAllModels(settings);

    // Re-read settings whenever the panel regains focus, so a provider/model
    // just added in Settings takes effect without a remount.
    useEffect(() => {
        const refresh = () => setSettings(loadAiSettings());
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, []);

    // Switch the active provider+model from the chat dropdown and persist it.
    const selectModel = useCallback((providerId: string, model: string) => {
        setSettings(prev => {
            const next = { ...prev, active: { providerId, model } };
            saveAiSettings(next);
            return next;
        });
    }, []);

    // Persist the active session whenever its messages change. Only sessions
    // with at least one real message are stored, and the title is (re)derived
    // from the first user turn so saved chats get a meaningful label.
    useEffect(() => {
        const stored: StoredMessage[] = messages
            .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        if (stored.length === 0) return;
        const existing = getSession(sessionId);
        const now = Date.now();
        saveSession({
            id: sessionId,
            title: deriveTitle(stored),
            messages: stored,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }, [messages, sessionId]);

    // Remember which session is active so closing/reopening the panel resumes it.
    useEffect(() => {
        saveActiveSessionId(sessionId);
    }, [sessionId]);

    // Open the history popover, refreshing the cached session list.
    const openHistory = useCallback(() => {
        setSessions(loadSessions());
        setHistoryOpen(true);
    }, []);

    // Load a past session into the panel (read-only bubbles: content + role).
    const loadSession = useCallback((id: string) => {
        const s = getSession(id);
        if (!s) return;
        setMessages(s.messages.map(m => ({ role: m.role, content: m.content })));
        setSessionId(id);
        setHistoryOpen(false);
    }, []);

    // Start a fresh session. The current one is already auto-saved.
    const newSession = useCallback(() => {
        setMessages([]);
        setSessionId(newSessionId());
        setHistoryOpen(false);
    }, []);

    // Delete a stored session; if it's the active one, also clear the panel.
    const removeSession = useCallback(
        (id: string) => {
            deleteSession(id);
            setSessions(loadSessions());
            if (id === sessionId) {
                setMessages([]);
                setSessionId(newSessionId());
            }
        },
        [sessionId],
    );

    // Close the history popover on outside click.
    useEffect(() => {
        if (!historyOpen) return;
        const onDown = (e: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
                setHistoryOpen(false);
            }
        };
        window.addEventListener('mousedown', onDown);
        return () => window.removeEventListener('mousedown', onDown);
    }, [historyOpen]);

    // Execute one agent skill against REAL graph data. Read-only skills compute
    // from the live serialized graph; edit skills translate args into a graph
    // patch and mutate the canvas (already approval-gated by the caller);
    // runtime skills (run_*/generate_pipeline/create_chart) are HONESTLY
    // reported as not wired rather than faking a result.
    const executeSkill = useCallback(async (call: ToolCall): Promise<ToolResult> => {
        const summary = serializeGraph(nodes, edges);
        const args = call.args;
        switch (call.tool) {
            case 'list_nodes': {
                if (summary.nodes.length === 0) return { ok: true, output: 'No nodes on the canvas.' };
                return {
                    ok: true,
                    output: summary.nodes
                        .map(n => `${n.id} (${n.kind ?? '?'}, ${n.componentId ?? '?'})`)
                        .join('\n'),
                };
            }
            case 'get_node_schema': {
                const n = summary.nodes.find(x => x.id === args.id);
                if (!n) return { ok: false, output: `No node with id ${String(args.id)}` };
                if (!n.columns || n.columns.length === 0) {
                    return { ok: true, output: `Node ${n.id} has no known columns yet.` };
                }
                return { ok: true, output: n.columns.join(', ') };
            }
            case 'get_pipeline_status':
                return { ok: true, output: 'No run yet' };
            case 'get_profile_metrics':
                return { ok: true, output: 'No run yet — no profile metrics available.' };
            case 'detect_schema_mismatch': {
                const issues: string[] = [];
                for (const edge of summary.edges) {
                    const up = summary.nodes.find(n => n.id === edge.source);
                    const down = summary.nodes.find(n => n.id === edge.target);
                    if (!up || !down || !down.columns || !up.columns) continue;
                    const missing = down.columns.filter(c => !up.columns!.includes(c));
                    if (missing.length > 0) {
                        issues.push(
                            `${down.id} references columns not produced by ${up.id}: ${missing.join(', ')}`,
                        );
                    }
                }
                return {
                    ok: true,
                    output: issues.length ? issues.join('\n') : 'No schema mismatches detected.',
                };
            }
            case 'suggest_fix': {
                const n = summary.nodes.find(x => x.id === args.id);
                if (!n) return { ok: false, output: `No node with id ${String(args.id)}` };
                return {
                    ok: true,
                    output: `Align node ${n.id}'s columns with its upstream: add a rename/cast node or update its config so column names match.`,
                };
            }
            case 'add_node': {
                const props =
                    args.properties && typeof args.properties === 'object'
                        ? (args.properties as Record<string, unknown>)
                        : undefined;
                onApplyPatch([
                    {
                        op: 'add_node',
                        node: {
                            id: String(args.id),
                            data: {
                                label: typeof args.label === 'string' ? args.label : String(args.id),
                                componentId:
                                    typeof args.componentId === 'string' ? args.componentId : undefined,
                                kind: typeof args.kind === 'string' ? args.kind : undefined,
                                properties: props,
                            },
                        },
                    },
                ]);
                return { ok: true, output: 'Applied' };
            }
            case 'update_node': {
                const props =
                    args.properties && typeof args.properties === 'object'
                        ? (args.properties as Record<string, unknown>)
                        : {};
                onApplyPatch([{ op: 'update_node', id: String(args.id), properties: props }]);
                return { ok: true, output: 'Applied' };
            }
            case 'delete_node':
                onApplyPatch([{ op: 'delete_node', id: String(args.id) }]);
                return { ok: true, output: 'Applied' };
            case 'connect_nodes':
                onApplyPatch([
                    { op: 'connect', source: String(args.source), target: String(args.target) },
                ]);
                return { ok: true, output: 'Applied' };
            case 'disconnect_nodes':
                onApplyPatch([
                    { op: 'disconnect', source: String(args.source), target: String(args.target) },
                ]);
                return { ok: true, output: 'Applied' };
            // Inspect/profile data we genuinely cannot derive client-side, and
            // runtime/generation skills that need callbacks ChatPanel lacks.
            case 'get_node_preview':
            case 'list_catalog':
            case 'explain_node':
                return { ok: false, output: 'Not available from the canvas context' };
            default:
                return { ok: false, output: `${call.tool} is not wired into the agent yet` };
        }
    }, [nodes, edges, onApplyPatch]);

    // Render a HITL approval card and block until the user resolves it. The
    // returned promise settles when resolveApproval / stopAgent fires.
    const requestApprovalRef = useRef<((call: ToolCall) => Promise<boolean>) | null>(null);
    requestApprovalRef.current = (call: ToolCall) =>
        new Promise<boolean>(resolve => {
            setMessages(prev => [...prev, { role: 'assistant', content: '', approval: call }]);
            approvalResolverRef.current = resolve;
        });

    // Resolve a pending approval from the Approve/Reject buttons.
    const resolveApproval = useCallback((index: number, approved: boolean) => {
        const r = approvalResolverRef.current;
        approvalResolverRef.current = null;
        setMessages(prev => {
            const out = prev.slice();
            const b = out[index];
            if (b) out[index] = { ...b, approvalResolved: approved ? 'approved' : 'rejected' };
            return out;
        });
        if (r) r(approved);
    }, []);

    // Stop the running agent loop and release any pending approval.
    const stopAgent = useCallback(() => {
        cancelledRef.current = true;
        const r = approvalResolverRef.current;
        approvalResolverRef.current = null;
        if (r) r(false);
    }, []);

    // Run the bounded ReAct loop: think -> (optional) tool call -> observe ->
    // repeat, gating mutating skills behind the HITL approval card. Mutating
    // skills NEVER execute before the user approves (see requiresApproval gate).
    const runAgent = useCallback(async (body: string) => {
        if (!config) return;
        cancelledRef.current = false;
        setMessages(prev => [...prev, { role: 'user', content: body }]);
        setBusy(true);

        const priorHistory: ChatMessage[] = messages
            .filter(m => m.content && !m.approval && !m.trace)
            .map(m => ({ role: m.role, content: m.content }));
        // Leading USER message (not system): the Claude path drops system turns,
        // so a user message is the only provider-agnostic context injection.
        const agentPrompt: ChatMessage = {
            role: 'user',
            content: hardenPrompt(buildAgentPrompt(JSON.stringify(serializeGraph(nodes, edges)))),
        };
        const loopHistory: ChatMessage[] = [
            agentPrompt,
            ...priorHistory,
            { role: 'user', content: body },
        ];

        const runChatTurn = (): Promise<string> =>
            new Promise(resolve => {
                setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);
                let full = '';
                void chatSend(loopHistory, config, ev => {
                    if (ev.kind === 'token') {
                        full += ev.text;
                        setMessages(prev => {
                            const out = prev.slice();
                            const last = out[out.length - 1];
                            if (last && last.role === 'assistant' && last.streaming) {
                                out[out.length - 1] = { ...last, content: last.content + ev.text };
                            }
                            return out;
                        });
                    } else if (ev.kind === 'done') {
                        setMessages(prev => {
                            const out = prev.slice();
                            const last = out[out.length - 1];
                            if (last && last.role === 'assistant' && last.streaming) {
                                out[out.length - 1] = { ...last, streaming: false };
                            }
                            return out;
                        });
                        resolve(full);
                    } else if (ev.kind === 'error') {
                        setMessages(prev => {
                            const out = prev.slice();
                            const last = out[out.length - 1];
                            if (last && last.role === 'assistant' && last.streaming) {
                                out[out.length - 1] = { ...last, streaming: false, content: ev.message };
                            }
                            return out;
                        });
                        resolve('');
                    }
                });
            });

        const pushTrace = (tool: string, ok: boolean) => {
            setMessages(prev => [...prev, { role: 'assistant', content: '', trace: { tool, ok } }]);
        };

        // Snapshot of the graph for semantic validation (Layer 2) and the set of
        // tool calls already issued this run for repeat detection (Layer 3).
        const graphSnapshot = serializeGraph(nodes, edges);
        const callHistory: ToolCall[] = [];

        for (let i = 0; canContinue(i); i++) {
            if (cancelledRef.current) break;
            const text = await runChatTurn();
            if (cancelledRef.current) break;
            const call = parseToolCall(text);
            if (!call) {
                // No tool call => final answer. Run the same post-processing the
                // old one-shot path did so generate/modify still work: offer a
                // graph patch (modify) or a full-pipeline insert (build new).
                const ops = extractGraphPatch(text);
                if (ops && ops.length > 0) {
                    setMessages(prev => {
                        const out = prev.slice();
                        const last = out[out.length - 1];
                        if (last && last.role === 'assistant') {
                            out[out.length - 1] = { ...last, patch: ops };
                        }
                        return out;
                    });
                } else {
                    void chatExtractPipeline(text).then(pipe => {
                        if (pipe) {
                            setMessages(prev => {
                                const out = prev.slice();
                                const last = out[out.length - 1];
                                if (last && last.role === 'assistant') {
                                    out[out.length - 1] = { ...last, pipeline: pipe };
                                }
                                return out;
                            });
                        }
                    });
                }
                break; // final answer, stop the loop
            }
            loopHistory.push({ role: 'assistant', content: text });
            const v = validateToolCall(call);
            if (!v.ok) {
                // Feed the validation error back so the model can correct itself.
                loopHistory.push({
                    role: 'user',
                    content: formatObservation(call.tool, { ok: false, output: v.error }),
                });
                continue;
            }
            // Layer 2 — semantic guardrail: the call may only reference nodes
            // that exist, fresh ids, allowlisted chart types, no self-loops.
            const g = validateAgainstGraph(call, graphSnapshot);
            if (!g.ok) {
                loopHistory.push({
                    role: 'user',
                    content: formatObservation(call.tool, { ok: false, output: g.error }),
                });
                continue;
            }
            // Layer 3 — liveness guardrail: if the model re-issues an identical
            // call it is stuck; stop rather than burning iterations.
            if (isRepeatCall(callHistory, call)) {
                setMessages(prev => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: '',
                        trace: { tool: call.tool, ok: false },
                    },
                ]);
                break;
            }
            callHistory.push(call);
            const skill = getSkill(call.tool);
            let result: ToolResult;
            if (skill && skill.requiresApproval) {
                // HITL gate: pause here. executeSkill (the only mutation path)
                // is NOT reached unless the user explicitly approves.
                const approved = await requestApprovalRef.current!(call);
                if (cancelledRef.current) break;
                if (!approved) {
                    result = { ok: false, output: 'User rejected this action' };
                } else {
                    result = await executeSkill(call);
                    pushTrace(call.tool, result.ok);
                }
            } else {
                result = await executeSkill(call);
                pushTrace(call.tool, result.ok);
            }
            loopHistory.push({ role: 'user', content: formatObservation(call.tool, result) });
        }

        setBusy(false);
    }, [config, messages, nodes, edges, executeSkill]);

    const send = useCallback(async (text?: string) => {
        const body = (text ?? draft).trim();
        if (!body || busy || !configured || !config) return;
        if (!text) setDraft('');
        // Always run the agent loop. With the JSON-block protocol the loop is a
        // superset of the old one-shot chat: if the model emits no tool call, it
        // breaks after one turn and the final answer is post-processed for a
        // graph patch (modify) or full-pipeline insert (build) — so plain Q&A,
        // pipeline generation, and tool-using agentic flows all share one path.
        await runAgent(body);
    }, [draft, busy, configured, config, runAgent]);

    // Esc closes the panel.
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    // Auto-scroll as tokens stream in.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    // Apply a proposed patch to the canvas, then mark the bubble applied so
    // the buttons collapse to an "Applied" badge. Gated behind the explicit
    // Apply button — patches are NEVER applied automatically (key safety).
    const applyPatch = useCallback((index: number, ops: GraphPatchOp[]) => {
        onApplyPatch(ops);
        setMessages(prev => {
            const out = prev.slice();
            const b = out[index];
            if (b) out[index] = { ...b, patchApplied: true };
            return out;
        });
    }, [onApplyPatch]);

    // Dismiss a proposed patch without touching the canvas.
    const dismissPatch = useCallback((index: number) => {
        setMessages(prev => {
            const out = prev.slice();
            const b = out[index];
            if (b) {
                const { patch: _patch, ...rest } = b;
                out[index] = rest;
            }
            return out;
        });
    }, []);

    return (
        <aside className="chat-panel" role="complementary" aria-label={t('chat.title')}>
            <header className="chat-panel-head">
                <div className="chat-panel-title">
                    <Sparkles size={14} aria-hidden="true" />
                    <span>{t('chat.title')}</span>
                </div>
                <div className="chat-panel-actions">
                    <div className="chat-history-wrap" ref={historyRef}>
                        <button
                            type="button"
                            className="chat-panel-action"
                            onClick={() => (historyOpen ? setHistoryOpen(false) : openHistory())}
                            title={t('chat.history')}
                            aria-label={t('chat.history')}
                            aria-expanded={historyOpen}
                        >
                            <Clock size={14} />
                        </button>
                        {historyOpen ? (
                            <div className="chat-history-popover" role="menu">
                                <div className="chat-history-head">{t('chat.history')}</div>
                                {sessions.length === 0 ? (
                                    <div className="chat-history-empty">{t('chat.historyEmpty')}</div>
                                ) : (
                                    <ul className="chat-history-list">
                                        {sessions.map(s => (
                                            <li key={s.id} className="chat-history-item">
                                                <button
                                                    type="button"
                                                    className="chat-history-open"
                                                    onClick={() => loadSession(s.id)}
                                                    title={s.title}
                                                >
                                                    {s.title}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="chat-history-del"
                                                    onClick={() => removeSession(s.id)}
                                                    title={t('chat.deleteChat')}
                                                    aria-label={t('chat.deleteChat')}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        className="chat-panel-action"
                        onClick={newSession}
                        title={t('chat.newChat')}
                        aria-label={t('chat.newChat')}
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        type="button"
                        className="chat-panel-close"
                        onClick={onClose}
                        title={t('common.close')}
                        aria-label={t('common.close')}
                    >
                        <X size={14} />
                    </button>
                </div>
            </header>

            {!configured ? (
                <div className="chat-panel-setup">
                    <div className="chat-panel-setup-icon">
                        <Sparkles size={20} />
                    </div>
                    <div className="chat-panel-setup-title">{t('chat.notConfiguredTitle')}</div>
                    <div className="chat-panel-setup-body">{t('chat.notConfiguredBody')}</div>
                    <button
                        type="button"
                        className="chat-panel-setup-cta"
                        onClick={onOpenSettings}
                    >
                        <Settings size={14} /> {t('chat.openSettings')}
                    </button>
                </div>
            ) : (
                <>
                    <div ref={scrollRef} className="chat-panel-scroll">
                        {messages.length === 0 ? (
                            <div className="chat-panel-empty">
                                <Workflow size={26} className="chat-panel-empty-icon" />
                                <div className="chat-panel-empty-title">
                                    {t('chat.emptyTitle')}
                                </div>
                                <div className="chat-panel-empty-hint">
                                    {t('chat.emptyHint')}
                                </div>
                                <div className="chat-panel-prompts">
                                    {EXAMPLE_PROMPTS.map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            className="chat-panel-prompt"
                                            onClick={() => void send(p)}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            messages.map((m, i) => (
                                <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
                                    {m.trace ? (
                                        <div className="chat-skill-trace">
                                            ⚙ {m.trace.tool} {m.trace.ok ? '✓' : '�— '}
                                        </div>
                                    ) : m.approval ? (
                                        <div className="chat-approval-card" role="group" aria-label={t('chat.skillUsed')}>
                                            <div className="chat-patch-head">{m.approval.tool}</div>
                                            <ul className="chat-patch-ops">
                                                {Object.entries(m.approval.args).map(([k, v]) => (
                                                    <li key={k}>{k}: {JSON.stringify(v)}</li>
                                                ))}
                                            </ul>
                                            {m.approvalResolved ? (
                                                <div className="chat-patch-applied">
                                                    {m.approvalResolved === 'approved'
                                                        ? t('chat.approve')
                                                        : t('chat.reject')}
                                                </div>
                                            ) : (
                                                <div className="chat-patch-actions">
                                                    <button
                                                        type="button"
                                                        className="chat-patch-apply"
                                                        onClick={() => resolveApproval(i, true)}
                                                    >
                                                        {t('chat.approve')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="chat-patch-dismiss"
                                                        onClick={() => resolveApproval(i, false)}
                                                    >
                                                        {t('chat.reject')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                    <>
                                    <div className="chat-bubble-content">
                                        {m.content}
                                        {m.streaming ? <span className="chat-caret" /> : null}
                                    </div>
                                    {m.pipeline ? (
                                        <button
                                            type="button"
                                            className="chat-bubble-insert"
                                            onClick={() => onInsertPipeline(m.pipeline)}
                                        >
                                            <Workflow size={12} /> {t('chat.insertIntoCanvas')}
                                        </button>
                                    ) : null}
                                    {m.patch ? (
                                        <div className="chat-patch-card" role="group" aria-label={t('chat.proposedChanges')}>
                                            <div className="chat-patch-head">{t('chat.proposedChanges')}</div>
                                            <ul className="chat-patch-ops">
                                                {summarizePatch(m.patch).map((line, j) => (
                                                    <li key={j}>{line}</li>
                                                ))}
                                            </ul>
                                            {m.patchApplied ? (
                                                <div className="chat-patch-applied">{t('chat.applied')}</div>
                                            ) : (
                                                <div className="chat-patch-actions">
                                                    <button
                                                        type="button"
                                                        className="chat-patch-apply"
                                                        onClick={() => applyPatch(i, m.patch!)}
                                                        aria-label={t('chat.applyChanges')}
                                                    >
                                                        {t('chat.apply')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="chat-patch-dismiss"
                                                        onClick={() => dismissPatch(i)}
                                                        aria-label={t('chat.dismissChanges')}
                                                    >
                                                        {t('chat.dismiss')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : null}
                                    </>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {allModels.length > 0 ? (
                        <div className="chat-panel-modelbar">
                            <label className="chat-panel-model-label" htmlFor="chat-model-select">
                                {t('chat.model')}
                            </label>
                            <select
                                id="chat-model-select"
                                className="chat-panel-model-select"
                                value={
                                    settings.active
                                        ? `${settings.active.providerId}::${settings.active.model}`
                                        : ''
                                }
                                onChange={e => {
                                    const [pid, ...rest] = e.target.value.split('::');
                                    selectModel(pid, rest.join('::'));
                                }}
                                disabled={busy}
                            >
                                {allModels.map(m => (
                                    <option
                                        key={`${m.providerId}::${m.model}`}
                                        value={`${m.providerId}::${m.model}`}
                                    >
                                        {m.providerLabel} · {m.model}
                                    </option>
                                ))}
                            </select>
                            {busy ? (
                                <button
                                    type="button"
                                    className="chat-agent-stop"
                                    onClick={stopAgent}
                                >
                                    {t('chat.stop')}
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    <form
                        className="chat-panel-form"
                        onSubmit={e => {
                            e.preventDefault();
                            void send();
                        }}
                    >
                        <textarea
                            className="chat-panel-input"
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            placeholder={busy ? t('chat.thinking') : t('chat.placeholder')}
                            rows={2}
                            disabled={busy}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void send();
                                }
                            }}
                        />
                        <button
                            type="submit"
                            className="chat-panel-send"
                            disabled={busy || !draft.trim()}
                            aria-label={t('chat.sendAria')}
                            title={t('chat.sendTooltip')}
                        >
                            {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        </button>
                    </form>
                </>
            )}
        </aside>
    );
}
