// Multi-provider / multi-model AI settings for the Qunnie chat assistant.
//
// Supersedes the single-config `ai-provider.ts` model. Persisted in
// localStorage. The legacy single-config key is migrated on first load so
// existing users keep their provider. The API key is stored in plaintext
// (same tradeoff as before; see ai-provider.ts).

import { loadPersisted, savePersisted } from './persistence';
import {
    type AiProvider,
    type AiProviderConfig,
    loadAiProviderConfig,
} from './ai-provider';

/** A configured provider with one or more models the user added. */
export type ProviderEntry = {
    id: string;
    label: string;
    provider: AiProvider;
    apiKey: string;
    baseUrl: string;
    models: string[];
};

/** Which provider+model is currently active for the chat. */
export type ActiveSelection = {
    providerId: string;
    model: string;
} | null;

export type AiSettings = {
    providers: ProviderEntry[];
    active: ActiveSelection;
};

const STORAGE_KEY = 'ai-settings';

/** Stable-ish id generator (no crypto dependency needed for this). */
export function newProviderId(): string {
    return 'p_' + Math.random().toString(36).slice(2, 10);
}

/** Turn the old single-config shape into the new multi-provider settings. */
export function migrateLegacy(legacy: AiProviderConfig): AiSettings {
    const id = newProviderId();
    const models = legacy.model.trim() ? [legacy.model.trim()] : [];
    const entry: ProviderEntry = {
        id,
        label: defaultLabel(legacy.provider),
        provider: legacy.provider,
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl,
        models,
    };
    return {
        providers: [entry],
        active: models.length ? { providerId: id, model: models[0] } : null,
    };
}

export function defaultLabel(provider: AiProvider): string {
    switch (provider) {
        case 'openai':
            return 'OpenAI';
        case 'claude':
            return 'Claude';
        case 'openai-compatible':
            return 'OpenAI-compatible';
    }
}

/** Load settings, migrating from the legacy single-config key if needed. */
export function loadAiSettings(): AiSettings {
    const existing = loadPersisted<AiSettings | null>(STORAGE_KEY, null);
    if (existing && Array.isArray(existing.providers)) {
        return existing;
    }
    // First run on the new model: migrate whatever the old key held.
    return migrateLegacy(loadAiProviderConfig());
}

export function saveAiSettings(settings: AiSettings): void {
    savePersisted(STORAGE_KEY, settings);
}

/**
 * Derive the legacy single-config (consumed by chatSend / aiTestConnection)
 * from the active selection. Returns null when nothing valid is active.
 */
export function resolveActiveConfig(settings: AiSettings): AiProviderConfig | null {
    const { active } = settings;
    if (!active) return null;
    const entry = settings.providers.find(p => p.id === active.providerId);
    if (!entry) return null;
    if (!entry.models.includes(active.model)) return null;
    return {
        provider: entry.provider,
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl,
        model: active.model,
    };
}

/** Flatten every model across providers for the chat model dropdown. */
export function listAllModels(
    settings: AiSettings,
): { providerId: string; providerLabel: string; model: string }[] {
    const out: { providerId: string; providerLabel: string; model: string }[] = [];
    for (const p of settings.providers) {
        for (const m of p.models) {
            out.push({ providerId: p.id, providerLabel: p.label, model: m });
        }
    }
    return out;
}

/** True when the active selection resolves to a usable provider config. */
export function isSettingsConfigured(settings: AiSettings): boolean {
    const cfg = resolveActiveConfig(settings);
    if (!cfg) return false;
    const hasEndpoint = cfg.baseUrl.trim().length > 0 && cfg.model.trim().length > 0;
    if (cfg.provider === 'openai-compatible') return hasEndpoint;
    return cfg.apiKey.trim().length > 0 && hasEndpoint;
}
