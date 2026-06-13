import { describe, it, expect } from 'vitest';
import { isAiConfigured, type AiProviderConfig } from './ai-provider';

const cfg = (over: Partial<AiProviderConfig>): AiProviderConfig => ({
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    ...over,
});

describe('isAiConfigured', () => {
    it('openai requires apiKey + baseUrl + model', () => {
        expect(isAiConfigured(cfg({ provider: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' }))).toBe(false); // no key
        expect(
            isAiConfigured(cfg({ provider: 'openai', apiKey: 'sk-x', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })),
        ).toBe(true);
    });

    it('claude requires apiKey too', () => {
        expect(isAiConfigured(cfg({ provider: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' }))).toBe(false);
        expect(
            isAiConfigured(cfg({ provider: 'claude', apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' })),
        ).toBe(true);
    });

    it('openai-compatible does NOT require an apiKey (local servers need none)', () => {
        // baseUrl + model present, no key -> still valid
        expect(
            isAiConfigured(cfg({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434', model: 'llama3' })),
        ).toBe(true);
    });

    it('openai-compatible still requires baseUrl + model', () => {
        expect(isAiConfigured(cfg({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434' }))).toBe(false); // no model
        expect(isAiConfigured(cfg({ provider: 'openai-compatible', model: 'llama3' }))).toBe(false); // no baseUrl
    });

    it('openai-compatible accepts an apiKey when provided', () => {
        expect(
            isAiConfigured(cfg({ provider: 'openai-compatible', apiKey: 'token', baseUrl: 'http://host/v1', model: 'm' })),
        ).toBe(true);
    });
});
