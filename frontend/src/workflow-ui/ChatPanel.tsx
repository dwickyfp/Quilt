import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Settings, Sparkles, X, Workflow } from 'lucide-react';
import {
    chatExtractPipeline,
    chatSend,
    type ChatMessage,
} from '../tauri-bridge';
import { isAiConfigured, loadAiProviderConfig, type AiProviderConfig } from '../ai-provider';
import { serializeGraph, type GraphNodeInput, type GraphEdgeInput } from './graph-context';
import { extractGraphPatch, summarizePatch, type GraphPatchOp } from './graph-patch';

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
};

const PROVIDER_LABELS: Record<AiProviderConfig['provider'], string> = {
    openai: 'OpenAI',
    claude: 'Claude',
    'openai-compatible': 'OpenAI-compatible',
};

const EXAMPLE_PROMPTS = [
    'Read orders.csv, filter where status = "shipped", write to shipped.parquet',
    'Pull GitHub issues from my repo and load them into a Postgres table',
    'Embed the description column with OpenAI and dedupe near-duplicates',
];

/**
 * Build the graph-aware context prompt (C3 + C5). Embeds the serialized live
 * graph and instructs the model to emit a fenced ```json {"ops":[...]} patch
 * when the user wants to MODIFY the existing pipeline. Provider-agnostic: the
 * patch travels as plain text in the stream, parsed by extractGraphPatch.
 */
function buildContextPrompt(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): string {
    const graph = JSON.stringify(serializeGraph(nodes, edges));
    return [
        "You are Qunnie, an assistant embedded in the Quilt pipeline editor.",
        "The user's CURRENT pipeline graph (JSON) is:",
        graph,
        "",
        "When the user asks to MODIFY the existing pipeline (add/remove/reconfigure/connect nodes), respond with a brief explanation AND a fenced ```json code block of shape {\"ops\":[...]} where each op is one of:",
        "{op:'add_node', node:{id, data:{label, componentId, kind}}}, {op:'update_node', id, properties:{...}}, {op:'delete_node', id}, {op:'connect', source, target}, {op:'disconnect', source, target}.",
        "Use the node ids shown in the graph. For new nodes invent a short unique id.",
        "The graph includes each node's `columns` when known — use real column names from upstream when configuring filters/aggregations, and if you detect a schema mismatch (e.g. a sink expects a column the upstream doesn't produce) point it out and propose an update_node or a new cast/rename node to fix it.",
    ].join('\n');
}

export default function ChatPanel({ onClose, onInsertPipeline, onOpenSettings, nodes, edges, onApplyPatch }: Props) {
    const { t } = useTranslation();
    const [config, setConfig] = useState<AiProviderConfig>(() => loadAiProviderConfig());
    const [messages, setMessages] = useState<Bubble[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const configured = isAiConfigured(config);

    // Re-read the config whenever the panel regains focus, so a key
    // just entered in Settings takes effect without a remount.
    useEffect(() => {
        const refresh = () => setConfig(loadAiProviderConfig());
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, []);

    const send = useCallback(async (text?: string) => {
        const body = (text ?? draft).trim();
        if (!body || busy || !configured) return;
        if (!text) setDraft('');
        const userMsg: Bubble = { role: 'user', content: body };
        setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', streaming: true }]);
        setBusy(true);
        // Prepend the live-graph context as a LEADING USER message (not a
        // system role): the Claude backend path drops system-role turns
        // (only user/assistant survive), so a user message is the only
        // provider-agnostic way to inject context across all providers.
        const contextMsg: ChatMessage = { role: 'user', content: buildContextPrompt(nodes, edges) };
        const history: ChatMessage[] = [
            contextMsg,
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: body },
        ];
        await chatSend(history, config, ev => {
            if (ev.kind === 'token') {
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
                        // Try a graph patch first (modify existing pipeline);
                        // fall back to full-pipeline extraction as before.
                        const ops = extractGraphPatch(last.content);
                        if (ops && ops.length > 0) {
                            out[out.length - 1] = { ...out[out.length - 1], patch: ops };
                        } else {
                            void chatExtractPipeline(last.content).then(pipe => {
                                if (pipe) {
                                    setMessages(c => {
                                        const o2 = c.slice();
                                        const t = o2[o2.length - 1];
                                        if (t && t.role === 'assistant') {
                                            o2[o2.length - 1] = { ...t, pipeline: pipe };
                                        }
                                        return o2;
                                    });
                                }
                            });
                        }
                    }
                    return out;
                });
                setBusy(false);
            } else if (ev.kind === 'error') {
                setMessages(prev => {
                    const out = prev.slice();
                    const last = out[out.length - 1];
                    if (last && last.role === 'assistant' && last.streaming) {
                        out[out.length - 1] = {
                            ...last,
                            streaming: false,
                            content: ev.message,
                        };
                    }
                    return out;
                });
                setBusy(false);
            }
        });
    }, [draft, busy, messages, config, configured]);

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
                    {configured ? (
                        <span className="chat-panel-tag">
                            {t('chat.providerTag', {
                                provider: PROVIDER_LABELS[config.provider],
                                model: config.model,
                            })}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    className="chat-panel-close"
                    onClick={onClose}
                    title={t('common.close')}
                    aria-label={t('common.close')}
                >
                    <X size={14} />
                </button>
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
                                </div>
                            ))
                        )}
                    </div>

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
