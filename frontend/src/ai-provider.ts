// App-level AI provider configuration for the Qunnie chat assistant.
//
// Persisted in localStorage (app-global, like theme/language) via the
// persistence helpers. NOTE: the API key is stored in plaintext - it is
// readable by any code in the webview and visible on disk. This is a
// deliberate tradeoff for simplicity; revisit if at-rest protection is
// needed (the desktop crate already has AES-GCM secrets infrastructure).

import { loadPersisted, savePersisted } from './persistence';

export type AiProvider = 'openai' | 'claude' | 'openai-compatible';

export type AiProviderConfig = {
    provider: AiProvider;
    apiKey: string;
    baseUrl: string;
    model: string;
};

export const AI_PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
    claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
    'openai-compatible': { baseUrl: '', model: '' },
};

const STORAGE_KEY = 'ai-provider';

const DEFAULT_CONFIG: AiProviderConfig = {
    provider: 'openai',
    apiKey: '',
    baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
    model: AI_PROVIDER_DEFAULTS.openai.model,
};

export function loadAiProviderConfig(): AiProviderConfig {
    return loadPersisted<AiProviderConfig>(STORAGE_KEY, DEFAULT_CONFIG);
}

export function saveAiProviderConfig(config: AiProviderConfig): void {
    savePersisted(STORAGE_KEY, config);
}

export function isAiConfigured(config: AiProviderConfig): boolean {
    const hasEndpoint =
        config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
    // OpenAI-compatible endpoints (Ollama, LM Studio, local llama.cpp / vLLM)
    // commonly need no API key, so don't require one there. Hosted OpenAI /
    // Claude still require a key.
    if (config.provider === 'openai-compatible') {
        return hasEndpoint;
    }
    return config.apiKey.trim().length > 0 && hasEndpoint;
}
