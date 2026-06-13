import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Settings, Sparkles, X, Workflow } from 'lucide-react';
import {
    chatExtractPipeline,
    chatSend,
    type ChatMessage,
} from '../tauri-bridge';
import { isAiConfigured, loadAiProviderConfig, type AiProviderConfig } from '../ai-provider';

type Props = {
    onClose: () => void;
    onInsertPipeline: (pipeline: unknown) => void;
    onOpenSettings: () => void;
};

type Bubble = ChatMessage & {
    /** True while tokens are still streaming in. */
    streaming?: boolean;
    /** Cached extracted pipeline, computed after the stream finishes. */
    pipeline?: unknown;
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

export default function ChatPanel({ onClose, onInsertPipeline, onOpenSettings }: Props) {
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
        const history: ChatMessage[] = [
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
                        // Try to extract a pipeline once streaming finishes.
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
