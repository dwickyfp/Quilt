import { useEffect, useState } from 'react';
import { Copy, Minus, Plus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../tauri-dialog';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

type Side = 'left' | 'right';

/**
 * Window controls for the frameless window. macOS renders native-style
 * traffic lights on the left; other platforms render Windows-style controls
 * on the right. Only shows under Tauri - in the browser the OS chrome applies.
 */
export default function WindowControls({ side }: { side: Side }) {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        if (!isTauri()) return;
        const win = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        void win.isMaximized().then(setMaximized).catch(() => {});
        win.onResized(() => {
            void win.isMaximized().then(setMaximized).catch(() => {});
        })
            .then(u => {
                unlisten = u;
            })
            .catch(() => {});
        return () => unlisten?.();
    }, []);

    if (!isTauri()) return null;
    // Each platform owns one slot; the other render is a no-op.
    if (IS_MAC ? side !== 'left' : side !== 'right') return null;

    const win = getCurrentWindow();

    if (IS_MAC) {
        return (
            <div className="win-controls-mac">
                <button
                    type="button"
                    className="win-mac win-mac-close"
                    title="Close"
                    aria-label="Close"
                    onClick={() => void win.close()}
                >
                    <X size={8} strokeWidth={2.5} className="win-mac-glyph" />
                </button>
                <button
                    type="button"
                    className="win-mac win-mac-min"
                    title="Minimize"
                    aria-label="Minimize"
                    onClick={() => void win.minimize()}
                >
                    <Minus size={8} strokeWidth={2.5} className="win-mac-glyph" />
                </button>
                <button
                    type="button"
                    className="win-mac win-mac-zoom"
                    title={maximized ? 'Restore' : 'Maximize'}
                    aria-label={maximized ? 'Restore' : 'Maximize'}
                    onClick={() => void win.toggleMaximize()}
                >
                    <Plus size={8} strokeWidth={2.5} className="win-mac-glyph" />
                </button>
            </div>
        );
    }

    return (
        <div className="win-controls">
            <button
                type="button"
                className="win-ctl"
                title="Minimize"
                aria-label="Minimize"
                onClick={() => void win.minimize()}
            >
                <Minus size={15} />
            </button>
            <button
                type="button"
                className="win-ctl"
                title={maximized ? 'Restore' : 'Maximize'}
                aria-label={maximized ? 'Restore' : 'Maximize'}
                onClick={() => void win.toggleMaximize()}
            >
                {maximized ? <Copy size={11} /> : <Square size={11} />}
            </button>
            <button
                type="button"
                className="win-ctl win-ctl-close"
                title="Close"
                aria-label="Close"
                onClick={() => void win.close()}
            >
                <X size={15} />
            </button>
        </div>
    );
}
