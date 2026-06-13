import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Save, Settings, X } from 'lucide-react';
import {
    AI_PROVIDER_DEFAULTS,
    isAiConfigured,
    loadAiProviderConfig,
    saveAiProviderConfig,
    type AiProvider,
    type AiProviderConfig,
} from '../ai-provider';
import { aiTestConnection } from '../tauri-bridge';

type Props = {
    onClose: () => void;
};

type TestState =
    | { phase: 'idle' }
    | { phase: 'testing' }
    | { phase: 'ok' }
    | { phase: 'failed'; error: string };

const PROVIDERS: AiProvider[] = ['openai', 'claude', 'openai-compatible'];

export default function SettingsPage({ onClose }: Props) {
    const { t } = useTranslation();
    const [config, setConfig] = useState<AiProviderConfig>(() => loadAiProviderConfig());
    const [test, setTest] = useState<TestState>({ phase: 'idle' });
    const [saved, setSaved] = useState(false);
    const apiKeyRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setTimeout(() => apiKeyRef.current?.focus(), 30);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleProviderChange = (provider: AiProvider) => {
        setTest({ phase: 'idle' });
        setSaved(false);
        setConfig(prev => {
            const defaults = AI_PROVIDER_DEFAULTS[provider];
            // Only overwrite baseUrl/model if they still match another
            // provider's default (or are empty), so we don't clobber a
            // value the user typed by hand.
            const isPreset = (field: 'baseUrl' | 'model', value: string) =>
                value.trim() === '' ||
                PROVIDERS.some(p => AI_PROVIDER_DEFAULTS[p][field] === value);
            return {
                ...prev,
                provider,
                baseUrl: isPreset('baseUrl', prev.baseUrl) ? defaults.baseUrl : prev.baseUrl,
                model: isPreset('model', prev.model) ? defaults.model : prev.model,
            };
        });
    };

    const setField = (key: keyof AiProviderConfig, value: string) => {
        setTest({ phase: 'idle' });
        setSaved(false);
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const canSave = isAiConfigured(config);

    const handleSave = () => {
        if (!canSave) return;
        saveAiProviderConfig(config);
        setSaved(true);
    };

    const handleTest = async () => {
        if (!canSave) return;
        setTest({ phase: 'testing' });
        const result = await aiTestConnection(config);
        setTest(result.ok ? { phase: 'ok' } : { phase: 'failed', error: result.error ?? '' });
    };

    return createPortal(
        <div
            className="settings-overlay"
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="settings-shell" role="dialog" aria-label={t('settings.title')}>
                <header className="settings-header">
                    <div className="modal-title-row">
                        <Settings size={16} className="modal-title-icon" />
                        <div className="modal-title">{t('settings.title')}</div>
                    </div>
                    <button
                        type="button"
                        className="modal-close"
                        onClick={onClose}
                        aria-label={t('settings.cancel')}
                    >
                        <X size={16} />
                    </button>
                </header>

                <div className="settings-main">
                    <nav className="settings-sidebar" aria-label={t('settings.title')}>
                        <button type="button" className="settings-nav-item is-active">
                            {t('settings.navAiProvider')}
                        </button>
                    </nav>

                    <div className="settings-content">
                        <section className="settings-section">
                            <div className="settings-section-title">
                                {t('settings.aiProvider')}
                            </div>

                            <div className="modal-field">
                                <label className="modal-field-label">
                                    {t('settings.provider')}
                                </label>
                                <select
                                    className="modal-input modal-select"
                                    value={config.provider}
                                    onChange={e =>
                                        handleProviderChange(e.target.value as AiProvider)
                                    }
                                >
                                    <option value="openai">{t('settings.providerOpenai')}</option>
                                    <option value="claude">{t('settings.providerClaude')}</option>
                                    <option value="openai-compatible">
                                        {t('settings.providerCompatible')}
                                    </option>
                                </select>
                                <div className="modal-field-hint">
                                    {config.provider === 'openai'
                                        ? t('settings.hintOpenai')
                                        : config.provider === 'claude'
                                          ? t('settings.hintClaude')
                                          : t('settings.hintCompatible')}
                                </div>
                            </div>

                            <div className="modal-field">
                                <label className="modal-field-label">{t('settings.apiKey')}</label>
                                <input
                                    ref={apiKeyRef}
                                    type="password"
                                    className="modal-input"
                                    value={config.apiKey}
                                    placeholder="••••••••"
                                    onChange={e => setField('apiKey', e.target.value)}
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="modal-field">
                                <label className="modal-field-label">{t('settings.baseUrl')}</label>
                                <input
                                    type="text"
                                    className="modal-input"
                                    value={config.baseUrl}
                                    placeholder="https://api.openai.com"
                                    onChange={e => setField('baseUrl', e.target.value)}
                                    spellCheck={false}
                                />
                            </div>

                            <div className="modal-field">
                                <label className="modal-field-label">{t('settings.model')}</label>
                                <input
                                    type="text"
                                    className="modal-input"
                                    value={config.model}
                                    placeholder="gpt-4o-mini"
                                    onChange={e => setField('model', e.target.value)}
                                    spellCheck={false}
                                />
                            </div>

                            {test.phase === 'ok' ? (
                                <div className="settings-status settings-status-ok">
                                    {t('settings.testOk')}
                                </div>
                            ) : test.phase === 'failed' ? (
                                <div className="settings-status settings-status-error">
                                    {t('settings.testFailed', { error: test.error })}
                                </div>
                            ) : saved ? (
                                <div className="settings-status settings-status-ok">
                                    {t('settings.savedConfirm')}
                                </div>
                            ) : null}
                        </section>
                    </div>
                </div>

                <footer className="modal-footer">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleTest()}
                        disabled={!canSave || test.phase === 'testing'}
                    >
                        {test.phase === 'testing' ? (
                            <Loader2 size={13} className="spin" />
                        ) : null}
                        {t('settings.test')}
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={!canSave}
                    >
                        <Save size={13} />
                        {t('settings.save')}
                    </button>
                </footer>
            </div>
        </div>,
        document.body,
    );
}
