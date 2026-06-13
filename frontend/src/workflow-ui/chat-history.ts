// Chat session history for the Qunnie assistant.
//
// Persists past conversations in localStorage so the user can revisit, reload,
// or delete them, and start a fresh session. Kept DOM-free and side-effect-free
// (apart from localStorage) so the title/CRUD logic is unit-testable. Mirrors
// the persistence shape used by ai-settings.ts.

const STORAGE_KEY = 'quilt.chat.sessions';
const ACTIVE_KEY = 'quilt.chat.activeId';
const TITLE_MAX = 48;

/** A persisted chat message — structurally a subset of the live Bubble. */
export type StoredMessage = {
    role: 'user' | 'assistant';
    content: string;
};

export type ChatSession = {
    id: string;
    title: string;
    messages: StoredMessage[];
    createdAt: number;
    updatedAt: number;
};

export function newSessionId(): string {
    return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Derive a short title from the first non-empty user message. Whitespace is
 * collapsed and long titles are ellipsised. Falls back to "New chat".
 */
export function deriveTitle(messages: StoredMessage[]): string {
    const first = messages.find(m => m.role === 'user' && m.content.trim().length > 0);
    if (!first) return 'New chat';
    const clean = first.content.replace(/\s+/g, ' ').trim();
    if (clean.length <= TITLE_MAX) return clean;
    return `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

function readAll(): ChatSession[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (s): s is ChatSession =>
                s && typeof s.id === 'string' && Array.isArray(s.messages),
        );
    } catch {
        return [];
    }
}

function writeAll(sessions: ChatSession[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
        // Storage full / unavailable — fail soft, history is best-effort.
    }
}

/** All sessions, newest-first by updatedAt. */
export function loadSessions(): ChatSession[] {
    return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSession | undefined {
    return readAll().find(s => s.id === id);
}

/** Insert or update (by id) a session. */
export function saveSession(session: ChatSession): void {
    const all = readAll();
    const idx = all.findIndex(s => s.id === session.id);
    if (idx >= 0) all[idx] = session;
    else all.push(session);
    writeAll(all);
}

export function deleteSession(id: string): void {
    writeAll(readAll().filter(s => s.id !== id));
}

/** Persist which session is currently active so it survives close/reopen. */
export function saveActiveSessionId(id: string): void {
    try {
        localStorage.setItem(ACTIVE_KEY, id);
    } catch {
        // Best-effort; fall back to a fresh session if it can't be stored.
    }
}

/** The last active session id, or null if none was stored. */
export function loadActiveSessionId(): string | null {
    try {
        return localStorage.getItem(ACTIVE_KEY);
    } catch {
        return null;
    }
}
