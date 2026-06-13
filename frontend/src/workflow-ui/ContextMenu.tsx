import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
    | {
          kind: 'item';
          key: string;
          label: string;
          icon?: React.ReactNode;
          shortcut?: string;
          onClick: () => void;
          disabled?: boolean;
          danger?: boolean;
      }
    | { kind: 'separator'; key: string }
    | { kind: 'header'; key: string; label: string };

type Position = { x: number; y: number };

type Props = {
    position: Position;
    items: MenuItem[];
    onClose: () => void;
};

const MENU_MIN_WIDTH = 200;
const MENU_PADDING = 8;

export default function ContextMenu({ position, items, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [adjusted, setAdjusted] = useState<Position>(position);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = position.x;
        let y = position.y;
        if (x + rect.width + MENU_PADDING > vw) x = vw - rect.width - MENU_PADDING;
        if (y + rect.height + MENU_PADDING > vh) y = vh - rect.height - MENU_PADDING;
        if (x < MENU_PADDING) x = MENU_PADDING;
        if (y < MENU_PADDING) y = MENU_PADDING;
        if (x !== adjusted.x || y !== adjusted.y) setAdjusted({ x, y });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [position]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const onScroll = () => onClose();
        document.addEventListener('keydown', onKey);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [onClose]);

    return createPortal(
        <div className="context-menu-backdrop" onMouseDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}>
            <div
                ref={ref}
                className="context-menu"
                style={{ top: adjusted.y, left: adjusted.x, minWidth: MENU_MIN_WIDTH }}
                onMouseDown={e => e.stopPropagation()}
                onContextMenu={e => e.preventDefault()}
            >
                {items.map(item => {
                    if (item.kind === 'separator') {
                        return <div key={item.key} className="context-menu-sep" />;
                    }
                    if (item.kind === 'header') {
                        return (
                            <div key={item.key} className="context-menu-header">
                                {item.label}
                            </div>
                        );
                    }
                    return (
                        <button
                            key={item.key}
                            type="button"
                            className={
                                'context-menu-item' +
                                (item.danger ? ' is-danger' : '') +
                                (item.disabled ? ' is-disabled' : '')
                            }
                            onClick={() => {
                                if (!item.disabled) {
                                    item.onClick();
                                    onClose();
                                }
                            }}
                            disabled={item.disabled}
                        >
                            <span className="context-menu-icon" aria-hidden="true">
                                {item.icon}
                            </span>
                            <span className="context-menu-label">{item.label}</span>
                            {item.shortcut ? (
                                <span className="context-menu-shortcut">{item.shortcut}</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </div>,
        document.body,
    );
}

export function useContextMenu() {
    const [state, setState] = useState<{ position: Position; items: MenuItem[] } | null>(null);

    const open = useCallback((e: React.MouseEvent | MouseEvent, items: MenuItem[]) => {
        e.preventDefault();
        e.stopPropagation();
        setState({ position: { x: e.clientX, y: e.clientY }, items });
    }, []);

    const close = useCallback(() => setState(null), []);

    const element = state ? (
        <ContextMenu position={state.position} items={state.items} onClose={close} />
    ) : null;

    return { open, close, element };
}
