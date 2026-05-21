import { useEffect, useRef, useState } from 'react';

export type EngineId = 'duckdb' | 'slothdb' | 'native';

type EngineMeta = {
    id: EngineId;
    label: string;
    description: string;
    dot: string;
};

const ENGINES: EngineMeta[] = [
    {
        id: 'duckdb',
        label: 'DuckDB',
        description: 'Default. Local analytics, files, SQL pushdown.',
        dot: '#fed060',
    },
    {
        id: 'slothdb',
        label: 'SlothDB',
        description: 'Optional embedded analytics engine.',
        dot: '#a78bfa',
    },
    {
        id: 'native',
        label: 'Native',
        description: 'Rust streaming and incremental pipelines.',
        dot: '#7ee787',
    },
];

type Props = {
    value: EngineId;
    onChange: (id: EngineId) => void;
};

export default function EngineSelector({ value, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const current = ENGINES.find(e => e.id === value) ?? ENGINES[0]!;

    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    return (
        <div className="engine-selector" ref={ref}>
            <button
                type="button"
                className="engine-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                <span className="engine-dot" style={{ background: current.dot }} aria-hidden />
                <span className="engine-trigger-label">Engine</span>
                <span className="engine-trigger-value">{current.label}</span>
                <span className="engine-trigger-chevron" aria-hidden>
                    ▾
                </span>
            </button>
            {open ? (
                <div className="engine-dropdown" role="listbox" aria-label="Engine">
                    {ENGINES.map(e => (
                        <button
                            key={e.id}
                            type="button"
                            role="option"
                            aria-selected={e.id === value}
                            className="engine-option"
                            onClick={() => {
                                onChange(e.id);
                                setOpen(false);
                            }}
                        >
                            <span className="engine-dot" style={{ background: e.dot }} aria-hidden />
                            <div className="engine-option-text">
                                <div className="engine-option-label">{e.label}</div>
                                <div className="engine-option-desc">{e.description}</div>
                            </div>
                            {e.id === value ? (
                                <span className="engine-option-check" aria-hidden>
                                    ✓
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
