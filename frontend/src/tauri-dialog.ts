import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

export type FileFilter = { name: string; extensions: string[] };

function isTauriContext(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        '__TAURI_INTERNALS__' in window ||
        '__TAURI__' in window ||
        '__TAURI_IPC__' in window
    );
}

export function isTauri(): boolean {
    return isTauriContext();
}

export async function tauriOpenFile(opts?: {
    filters?: FileFilter[];
    title?: string;
}): Promise<string | null> {
    try {
        const result = await tauriOpen({
            multiple: false,
            directory: false,
            filters: opts?.filters,
            title: opts?.title,
        });
        if (Array.isArray(result)) return result[0] ?? null;
        return result ?? null;
    } catch (err) {
        console.error('Tauri open dialog failed', err);
        return null;
    }
}

export async function tauriSavePath(opts?: {
    defaultPath?: string;
    filters?: FileFilter[];
    title?: string;
}): Promise<string | null> {
    try {
        return await tauriSave({
            defaultPath: opts?.defaultPath,
            filters: opts?.filters,
            title: opts?.title,
        });
    } catch (err) {
        console.error('Tauri save dialog failed', err);
        return null;
    }
}
