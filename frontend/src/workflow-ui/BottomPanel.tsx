import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Terminal } from 'lucide-react';

type TabId = 'problems' | 'output' | 'console';

const TABS: { id: TabId; label: string; badge?: number }[] = [
    { id: 'problems', label: 'Problems', badge: 0 },
    { id: 'output', label: 'Output' },
    { id: 'console', label: 'Console' },
];

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 220;

export default function BottomPanel() {
    const [tab, setTab] = useState<TabId>('problems');
    const [collapsed, setCollapsed] = useState<boolean>(true);
    const [height, setHeight] = useState<number>(DEFAULT_HEIGHT);
    const dragRef = useRef<{ startY: number; startH: number } | null>(null);

    const onResizeStart = useCallback(
        (e: React.MouseEvent) => {
            if (collapsed) return;
            dragRef.current = { startY: e.clientY, startH: height };
            e.preventDefault();
        },
        [collapsed, height],
    );

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const dy = dragRef.current.startY - e.clientY;
            const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startH + dy));
            setHeight(next);
        };
        const onUp = () => {
            dragRef.current = null;
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, []);

    const onTabClick = (id: TabId) => {
        if (collapsed) {
            setCollapsed(false);
            setTab(id);
        } else if (tab === id) {
            setCollapsed(true);
        } else {
            setTab(id);
        }
    };

    return (
        <div
            className={'bottom-panel' + (collapsed ? ' is-collapsed' : '')}
            style={collapsed ? undefined : { height }}
        >
            <div className="bottom-panel-resize" onMouseDown={onResizeStart} aria-hidden="true" />
            <div className="bottom-panel-tabs" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={!collapsed && tab === t.id}
                        className="bottom-panel-tab"
                        onClick={() => onTabClick(t.id)}
                    >
                        {t.label}
                        {t.badge !== undefined ? (
                            <span className="bottom-panel-tab-badge">{t.badge}</span>
                        ) : null}
                    </button>
                ))}
                <div className="bottom-panel-spacer" />
                <button
                    type="button"
                    className="bottom-panel-toggle"
                    onClick={() => setCollapsed(c => !c)}
                    aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                >
                    {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            </div>
            {!collapsed ? (
                <div className="bottom-panel-content">
                    {tab === 'problems' ? <ProblemsTab /> : null}
                    {tab === 'output' ? <OutputTab /> : null}
                    {tab === 'console' ? <ConsoleTab /> : null}
                </div>
            ) : null}
        </div>
    );
}

function ProblemsTab() {
    return (
        <div className="bottom-empty">
            <CheckCircle2 size={22} className="bottom-empty-icon bottom-empty-icon-ok" />
            <div className="bottom-empty-title">No problems detected</div>
            <div className="bottom-empty-desc">
                Schema mismatches, missing required properties, and engine compatibility warnings
                surface here. Click an issue to jump to the offending node.
            </div>
        </div>
    );
}

function OutputTab() {
    return (
        <div className="bottom-empty">
            <div className="bottom-empty-title">No run output yet</div>
            <div className="bottom-empty-desc">
                Press <kbd className="kbd">F5</kbd> or click <b>Run</b> to execute the pipeline.
                Logs, per-node row counts, and execution timings stream here.
            </div>
        </div>
    );
}

function ConsoleTab() {
    return (
        <div className="bottom-empty bottom-console">
            <div className="bottom-console-line">
                <Terminal size={12} className="bottom-console-icon" />
                <span className="bottom-console-time">[ready]</span>
                <span className="bottom-console-msg">
                    Diagnostics console. Runtime events, engine diagnostics, and connector errors
                    stream here.
                </span>
            </div>
        </div>
    );
}
