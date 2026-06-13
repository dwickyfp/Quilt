import { describe, it, expect, beforeEach } from 'vitest';
import {
    type ChatSession,
    type StoredMessage,
    loadSessions,
    saveSession,
    deleteSession,
    getSession,
    newSessionId,
    deriveTitle,
} from './chat-history';

const msg = (role: 'user' | 'assistant', content: string): StoredMessage => ({ role, content });

beforeEach(() => {
    localStorage.clear();
});

describe('newSessionId', () => {
    it('produces unique ids', () => {
        expect(newSessionId()).not.toBe(newSessionId());
    });
});

describe('deriveTitle', () => {
    it('uses the first user message, trimmed', () => {
        expect(deriveTitle([msg('user', '  Read orders.csv and filter  ')])).toBe(
            'Read orders.csv and filter',
        );
    });

    it('truncates long titles with an ellipsis', () => {
        const long = 'a'.repeat(80);
        const title = deriveTitle([msg('user', long)]);
        expect(title.length).toBeLessThanOrEqual(48);
        expect(title.endsWith('…')).toBe(true);
    });

    it('collapses whitespace/newlines into single spaces', () => {
        expect(deriveTitle([msg('user', 'line one\n\nline   two')])).toBe('line one line two');
    });

    it('skips empty messages and uses the first non-empty user message', () => {
        expect(deriveTitle([msg('user', '   '), msg('user', 'real prompt')])).toBe('real prompt');
    });

    it('falls back to a default when there is no user content', () => {
        expect(deriveTitle([msg('assistant', 'hi')])).toBe('New chat');
        expect(deriveTitle([])).toBe('New chat');
    });
});

describe('saveSession / loadSessions', () => {
    it('persists a session and reads it back', () => {
        const s: ChatSession = {
            id: 's1',
            title: 'First',
            messages: [msg('user', 'hello')],
            createdAt: 1000,
            updatedAt: 1000,
        };
        saveSession(s);
        const all = loadSessions();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('s1');
        expect(all[0].messages[0].content).toBe('hello');
    });

    it('updates an existing session in place (by id)', () => {
        saveSession({ id: 's1', title: 'A', messages: [], createdAt: 1, updatedAt: 1 });
        saveSession({ id: 's1', title: 'A2', messages: [msg('user', 'x')], createdAt: 1, updatedAt: 2 });
        const all = loadSessions();
        expect(all).toHaveLength(1);
        expect(all[0].title).toBe('A2');
    });

    it('returns sessions newest-first by updatedAt', () => {
        saveSession({ id: 'old', title: 'old', messages: [], createdAt: 1, updatedAt: 1 });
        saveSession({ id: 'new', title: 'new', messages: [], createdAt: 2, updatedAt: 5 });
        const all = loadSessions();
        expect(all[0].id).toBe('new');
        expect(all[1].id).toBe('old');
    });

    it('returns an empty array when nothing is stored', () => {
        expect(loadSessions()).toEqual([]);
    });

    it('tolerates corrupt storage without throwing', () => {
        localStorage.setItem('quilt.chat.sessions', '{not json');
        expect(loadSessions()).toEqual([]);
    });
});

describe('getSession', () => {
    it('returns a session by id', () => {
        saveSession({ id: 's1', title: 'A', messages: [], createdAt: 1, updatedAt: 1 });
        expect(getSession('s1')?.title).toBe('A');
    });
    it('returns undefined for an unknown id', () => {
        expect(getSession('nope')).toBeUndefined();
    });
});

describe('deleteSession', () => {
    it('removes a session by id', () => {
        saveSession({ id: 's1', title: 'A', messages: [], createdAt: 1, updatedAt: 1 });
        saveSession({ id: 's2', title: 'B', messages: [], createdAt: 2, updatedAt: 2 });
        deleteSession('s1');
        const all = loadSessions();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('s2');
    });
    it('is a no-op for an unknown id', () => {
        saveSession({ id: 's1', title: 'A', messages: [], createdAt: 1, updatedAt: 1 });
        deleteSession('ghost');
        expect(loadSessions()).toHaveLength(1);
    });
});
