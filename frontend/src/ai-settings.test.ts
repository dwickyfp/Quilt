import { describe, it, expect } from 'vitest';
import {
    type AiSettings,
    type ProviderEntry,
    migrateLegacy,
    resolveActiveConfig,
    listAllModels,
    isSettingsConfigured,
} from './ai-settings';

const entry = (over: Partial<ProviderEntry>): ProviderEntry => ({
    id: 'p1',
    label: 'OpenAI',
    provider: 'openai',
    apiKey: 'sk-x',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o-mini'],
    ...over,
});

describe('migrateLegacy', () => {
    it('wraps a single legacy config into a one-provider settings with active selection', () => {
        const s = migrateLegacy({
            provider: 'openai',
            apiKey: 'sk-x',
            baseUrl: 'https://api.openai.com',
            model: 'gpt-4o-mini',
        });
        expect(s.providers).toHaveLength(1);
        expect(s.providers[0].models).toEqual(['gpt-4o-mini']);
        expect(s.active).toEqual({ providerId: s.providers[0].id, model: 'gpt-4o-mini' });
    });

    it('leaves active null when legacy has no model', () => {
        const s = migrateLegacy({ provider: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434', model: '' });
        expect(s.providers[0].models).toEqual([]);
        expect(s.active).toBeNull();
    });
});

describe('resolveActiveConfig', () => {
    it('derives a legacy config from the active selection', () => {
        const s: AiSettings = { providers: [entry({})], active: { providerId: 'p1', model: 'gpt-4o-mini' } };
        expect(resolveActiveConfig(s)).toEqual({
            provider: 'openai',
            apiKey: 'sk-x',
            baseUrl: 'https://api.openai.com',
            model: 'gpt-4o-mini',
        });
    });

    it('returns null when there is no active selection', () => {
        expect(resolveActiveConfig({ providers: [entry({})], active: null })).toBeNull();
    });

    it('returns null when the active provider id is unknown', () => {
        const s: AiSettings = { providers: [entry({})], active: { providerId: 'gone', model: 'gpt-4o-mini' } };
        expect(resolveActiveConfig(s)).toBeNull();
    });

    it('returns null when the active model is not in the provider model list', () => {
        const s: AiSettings = { providers: [entry({ models: ['a'] })], active: { providerId: 'p1', model: 'b' } };
        expect(resolveActiveConfig(s)).toBeNull();
    });
});

describe('listAllModels', () => {
    it('flattens all models across providers with their provider id + label', () => {
        const s: AiSettings = {
            providers: [
                entry({ id: 'p1', label: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4o'] }),
                entry({ id: 'p2', label: 'Local', provider: 'openai-compatible', models: ['llama3'] }),
            ],
            active: null,
        };
        expect(listAllModels(s)).toEqual([
            { providerId: 'p1', providerLabel: 'OpenAI', model: 'gpt-4o-mini' },
            { providerId: 'p1', providerLabel: 'OpenAI', model: 'gpt-4o' },
            { providerId: 'p2', providerLabel: 'Local', model: 'llama3' },
        ]);
    });
});

describe('isSettingsConfigured', () => {
    it('true when active resolves to a fully configured provider', () => {
        const s: AiSettings = { providers: [entry({})], active: { providerId: 'p1', model: 'gpt-4o-mini' } };
        expect(isSettingsConfigured(s)).toBe(true);
    });

    it('openai-compatible active is configured even without an api key', () => {
        const s: AiSettings = {
            providers: [entry({ provider: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434', models: ['llama3'] })],
            active: { providerId: 'p1', model: 'llama3' },
        };
        expect(isSettingsConfigured(s)).toBe(true);
    });

    it('false when no active selection', () => {
        expect(isSettingsConfigured({ providers: [entry({})], active: null })).toBe(false);
    });
});
