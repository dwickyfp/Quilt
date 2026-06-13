import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Info, X } from 'lucide-react';
import type { FileFilter } from '../../tauri-dialog';

type Props = {
    open: boolean;
    mode: 'open' | 'save';
    title: string;
    initialPath?: string;
    filters?: FileFilter[];
    onConfirm: (path: string) => void;
    onCancel: () => void;
};

const RECENT_KEY = 'quilt:recent-paths';
const MAX_RECENT = 8;

function getRecentPaths(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : [];
    } catch {
        return [];
    }
}

function pushRecentPath(path: string) {
    if (!path) return;
    try {
        const list = getRecentPaths().filter(p => p !== path);
        list.unshift(path);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    } catch {
        /* ignore */
    }
}

export default function FileBrowserModal({
    open,
    mode,
    title,
    initialPath,
    filters,
    onConfirm,
    onCancel,
}: Props) {
    const [path, setPath] = useState(initialPath ?? '');
    const [recent] = useState<string[]>(() => getRecentPaths());
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setPath(initialPath ?? '');
            setTimeout(() => inputRef.current?.focus(), 30);
        }
    }, [open, initialPath]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            } else if (e.key === 'Enter' && path.trim()) {
                e.preventDefault();
                handleConfirm();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, path]);

    if (!open) return null;

    const handleConfirm = () => {
        const trimmed = path.trim();
        if (!trimmed) return;
        pushRecentPath(trimmed);
        onConfirm(trimmed);
    };

    const handleBrowse = () => fileInputRef.current?.click();

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Browser can't expose the full absolute path for security reasons.
            // Use the filename; the user can edit to include the directory.
            setPath(file.name);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
        e.target.value = '';
    };

    const accept = filters
        ? filters
              .flatMap(f => f.extensions)
              .filter(e => e !== '*')
              .map(e => '.' + e)
              .join(',')
        : undefined;

    const ctaLabel = mode === 'save' ? 'Save' : 'Choose';

    return createPortal(
        <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={e => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div className="modal modal-file">
                <div className="modal-header">
                    <div className="modal-title">{title}</div>
                    <button
                        type="button"
                        className="modal-close"
                        onClick={onCancel}
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="modal-field">
                        <label className="modal-field-label">
                            {mode === 'save' ? 'Output path' : 'File path'}
                        </label>
                        <div className="modal-field-pathrow">
                            <input
                                ref={inputRef}
                                type="text"
                                className="modal-input modal-input-path"
                                value={path}
                                placeholder={
                                    mode === 'save'
                                        ? 'e.g. C:\\out\\orders_paid.parquet'
                                        : 'e.g. C:\\data\\orders.csv'
                                }
                                onChange={e => setPath(e.target.value)}
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                className="modal-input-browse"
                                onClick={handleBrowse}
                            >
                                Browse…
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={accept}
                                onChange={handleFileSelected}
                                style={{ display: 'none' }}
                            />
                        </div>
                    </div>

                    {recent.length > 0 ? (
                        <div className="modal-field">
                            <label className="modal-field-label">Recent</label>
                            <div className="modal-recent">
                                {recent.map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        className={
                                            'modal-recent-item' + (p === path ? ' is-active' : '')
                                        }
                                        onClick={() => setPath(p)}
                                        title={p}
                                    >
                                        <Clock size={13} aria-hidden="true" />
                                        <span className="modal-recent-path">{p}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {filters && filters.length > 0 ? (
                        <div className="modal-hint">
                            Accepted:{' '}
                            {filters
                                .map(f => f.extensions.map(e => (e === '*' ? '*' : '.' + e)).join(', '))
                                .join('; ')}
                        </div>
                    ) : null}

                    <div className="modal-tip">
                        <Info size={14} className="modal-tip-icon" aria-hidden="true" />
                        <span>
                            <b>Desktop mode</b> opens a native OS dialog with full filesystem
                            access. In browser, paste or type the full path manually.
                        </span>
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleConfirm}
                        disabled={!path.trim()}
                    >
                        {ctaLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
