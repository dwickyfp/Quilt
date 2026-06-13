import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Save, Settings, Trash2, X } from 'lucide-react';
import { AI_PROVIDER_DEFAULTS, type AiProvider, type AiProviderConfig } from '../ai-provider';
import {
    defaultLabel,
    loadAiSettings,
    newProviderId,
    saveAiSettings,
    type AiSettings,
    type ProviderEntry,
} from '../ai-settings';
import { aiTestConnection } from '../tauri-bridge';
import { LANGUAGES } from '../i18n/languages';

type Props = {
    onClose: () => void;
};

type TestState =
    | { phase: 'idle' }
    | { phase: 'testing'; id: string }
    | { phase: 'ok'; id: string }
    | { phase: 'failed'; id: string; error: string };

const PROVIDERS: AiProvider[] = ['openai', 'claude', 'openai-compatible'];

export default function SettingsPage({ onClose }: Props) {
    const { t, i18n } = useTranslation();
    const [section, setSection] = useState<'general' | 'ai'>('general');
    const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
    const [draftModel, setDraftModel] = useState<Record<string, string>>({});
    const [test, setTest] = useState<TestState>({ phase: 'idle' });
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const dirty = () => {
        setTest({ phase: 'idle' });
        setSaved(false);
    };

    const patchEntry = (id: string, patch: (e: ProviderEntry) => ProviderEntry) => {
        dirty();
        setSettings(prev => ({
            ...prev,
            providers: prev.providers.map(e => (e.id === id ? patch(e) : e)),
        }));
    };

    const changeProviderType = (id: string, provider: AiProvider) => {
        patchEntry(id, e => {
            const defaults = AI_PROVIDER_DEFAULTS[provider];
            // Only overwrite baseUrl if it's empty or still matches a preset,
            // so we don't clobber a value the user typed by hand.
            const isPreset =
                e.baseUrl.trim() === '' ||
                PROVIDERS.some(p => AI_PROVIDER_DEFAULTS[p].baseUrl === e.baseUrl);
            return {
                ...e,
                provider,
                baseUrl: isPreset ? defaults.baseUrl : e.baseUrl,
            };
        });
    };

    const addProvider = () => {
        dirty();
        setSettings(prev => ({
            ...prev,
            providers: [
                ...prev.providers,
                {
                    id: newProviderId(),
                    label: defaultLabel('openai'),
                    provider: 'openai',
                    apiKey: '',
                    baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
                    models: [],
                },
            ],
        }));
    };

    const removeProvider = (id: string) => {
        dirty();
        setSettings(prev => ({
            providers: prev.providers.filter(e => e.id !== id),
            active: prev.active?.providerId === id ? null : prev.active,
        }));
    };

    const addModel = (id: string) => {
        const model = (draftModel[id] ?? '').trim();
        if (!model) return;
        patchEntry(id, e =>
            e.models.includes(model) ? e : { ...e, models: [...e.models, model] },
        );
        setDraftModel(prev => ({ ...prev, [id]: '' }));
    };

    const removeModel = (id: string, model: string) => {
        patchEntry(id, e => ({ ...e, models: e.models.filter(m => m !== model) }));
    };

    const canSave = settings.providers.some(p => p.models.length > 0 && p.baseUrl.trim());

    const handleSave = () => {
        if (!canSave) return;
        let next = settings;
        if (!next.active) {
            const first = next.providers.find(p => p.models.length > 0);
            if (first) {
                next = { ...next, active: { providerId: first.id, model: first.models[0] } };
            }
        }
        saveAiSettings(next);
        setSettings(next);
        setSaved(true);
    };

    const handleTest = async (entry: ProviderEntry) => {
        if (!entry.models.length || !entry.baseUrl.trim()) return;
        setSaved(false);
        setTest({ phase: 'testing', id: entry.id });
        const config: AiProviderConfig = {
            provider: entry.provider,
            apiKey: entry.apiKey,
            baseUrl: entry.baseUrl,
            model: entry.models[0],
        };
        const result = await aiTestConnection(config);
        setTest(
            result.ok
                ? { phase: 'ok', id: entry.id }
                : { phase: 'failed', id: entry.id, error: result.error ?? '' },
        );
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
                        <button
                            type="button"
                            className={`settings-nav-item${section === 'general' ? ' is-active' : ''}`}
                            onClick={() => setSection('general')}
                        >
                            {t('settings.navGeneral')}
                        </button>
                        <button
                            type="button"
                            className={`settings-nav-item${section === 'ai' ? ' is-active' : ''}`}
                            onClick={() => setSection('ai')}
                        >
                            {t('settings.navAiProvider')}
                        </button>
                    </nav>

                    <div className="settings-content">
                        {section === 'general' ? (
                            <section className="settings-section">
                                <div className="settings-section-title">
                                    {t('settings.general')}
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field-label" htmlFor="settings-language">
                                        {t('settings.language')}
                                    </label>
                                    <select
                                        id="settings-language"
                                        className="modal-input modal-select"
                                        value={
                                            LANGUAGES.find(l => l.code === i18n.language)?.code ??
                                            LANGUAGES.find(l => i18n.language?.startsWith(l.code))?.code ??
                                            'en'
                                        }
                                        onChange={e => void i18n.changeLanguage(e.target.value)}
                                    >
                                        {LANGUAGES.map(l => (
                                            <option key={l.code} value={l.code}>
                                                {l.nativeName}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="modal-field-hint">
                                        {t('settings.languageHint')}
                                    </div>
                                </div>
                            </section>
                        ) : null}

                        {section === 'ai' ? (
                        <section className="settings-section">
                            <div className="settings-section-title">
                                {t('settings.aiProvider')}
                            </div>

                            {settings.providers.map(entry => (
                                <div key={entry.id} className="settings-provider-card">
                                    <div className="settings-provider-head">
                                        <div className="modal-field settings-provider-grow">
                                            <label className="modal-field-label">
                                                {t('settings.providerLabel')}
                                            </label>
                                            <input
                                                type="text"
                                                className="modal-input"
                                                value={entry.label}
                                                onChange={e =>
                                                    patchEntry(entry.id, p => ({
                                                        ...p,
                                                        label: e.target.value,
                                                    }))
                                                }
                                                spellCheck={false}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary settings-remove-provider"
                                            onClick={() => removeProvider(entry.id)}
                                            aria-label={t('settings.removeProvider')}
                                            title={t('settings.removeProvider')}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>

                                    <div className="modal-field">
                                        <label className="modal-field-label">
                                            {t('settings.provider')}
                                        </label>
                                        <select
                                            className="modal-input modal-select"
                                            value={entry.provider}
                                            onChange={e =>
                                                changeProviderType(
                                                    entry.id,
                                                    e.target.value as AiProvider,
                                                )
                                            }
                                        >
                                            <option value="openai">
                                                {t('settings.providerOpenai')}
                                            </option>
                                            <option value="claude">
                                                {t('settings.providerClaude')}
                                            </option>
                                            <option value="openai-compatible">
                                                {t('settings.providerCompatible')}
                                            </option>
                                        </select>
                                        <div className="modal-field-hint">
                                            {entry.provider === 'openai'
                                                ? t('settings.hintOpenai')
                                                : entry.provider === 'claude'
                                                  ? t('settings.hintClaude')
                                                  : t('settings.hintCompatible')}
                                        </div>
                                    </div>

                                    <div className="modal-field">
                                        <label className="modal-field-label">
                                            {t('settings.apiKey')}
                                        </label>
                                        <input
                                            type="password"
                                            className="modal-input"
                                            value={entry.apiKey}
                                            placeholder="••••••••"
                                            onChange={e =>
                                                patchEntry(entry.id, p => ({
                                                    ...p,
                                                    apiKey: e.target.value,
                                                }))
                                            }
                                            spellCheck={false}
                                            autoComplete="off"
                                        />
                                        {entry.provider === 'openai-compatible' ? (
                                            <div className="modal-field-hint">
                                                {t('settings.hintCompatible')}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="modal-field">
                                        <label className="modal-field-label">
                                            {t('settings.baseUrl')}
                                        </label>
                                        <input
                                            type="text"
                                            className="modal-input"
                                            value={entry.baseUrl}
                                            placeholder="https://api.openai.com"
                                            onChange={e =>
                                                patchEntry(entry.id, p => ({
                                                    ...p,
                                                    baseUrl: e.target.value,
                                                }))
                                            }
                                            spellCheck={false}
                                        />
                                    </div>

                                    <div className="modal-field settings-models">
                                        <label className="modal-field-label">
                                            {t('settings.models')}
                                        </label>
                                        {entry.models.length === 0 ? (
                                            <div className="modal-field-hint">
                                                {t('settings.noModels')}
                                            </div>
                                        ) : (
                                            entry.models.map(model => (
                                                <div key={model} className="settings-model-row">
                                                    <span className="settings-model-name">
                                                        {model}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary settings-model-remove"
                                                        onClick={() =>
                                                            removeModel(entry.id, model)
                                                        }
                                                        aria-label={t('settings.removeProvider')}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                        <div className="settings-model-add">
                                            <input
                                                type="text"
                                                className="modal-input"
                                                value={draftModel[entry.id] ?? ''}
                                                placeholder={t('settings.modelPlaceholder')}
                                                onChange={e =>
                                                    setDraftModel(prev => ({
                                                        ...prev,
                                                        [entry.id]: e.target.value,
                                                    }))
                                                }
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        addModel(entry.id);
                                                    }
                                                }}
                                                spellCheck={false}
                                            />
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={() => addModel(entry.id)}
                                            >
                                                <Plus size={13} />
                                                {t('settings.addModel')}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="settings-provider-foot">
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => void handleTest(entry)}
                                            disabled={
                                                !entry.models.length ||
                                                !entry.baseUrl.trim() ||
                                                (test.phase === 'testing' && test.id === entry.id)
                                            }
                                        >
                                            {test.phase === 'testing' && test.id === entry.id ? (
                                                <Loader2 size={13} className="spin" />
                                            ) : null}
                                            {t('settings.test')}
                                        </button>
                                        {test.phase === 'ok' && test.id === entry.id ? (
                                            <div className="settings-status settings-status-ok">
                                                {t('settings.testOk')}
                                            </div>
                                        ) : test.phase === 'failed' && test.id === entry.id ? (
                                            <div className="settings-status settings-status-error">
                                                {t('settings.testFailed', { error: test.error })}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ))}

                            <button
                                type="button"
                                className="btn btn-secondary settings-add-provider"
                                onClick={addProvider}
                            >
                                <Plus size={13} />
                                {t('settings.addProvider')}
                            </button>

                            {saved ? (
                                <div className="settings-status settings-status-ok">
                                    {t('settings.savedConfirm')}
                                </div>
                            ) : null}
                        </section>
                        ) : null}
                    </div>
                </div>

                <footer className="modal-footer">
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
