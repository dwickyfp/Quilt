import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    Check,
    ChevronDown,
    ChevronRight,
    Cloud,
    Code2,
    GitFork,
    Search,
    ShieldCheck,
    Workflow,
    X,
} from 'lucide-react';
import {
    PALETTE,
    TOTAL_COMPONENT_COUNT,
    AVAILABLE_COUNT,
    type ComponentDef,
    type NodeKind,
} from './palette-data';

const KIND_COLOR: Record<NodeKind, string> = {
    source: 'var(--kind-source)',
    transform: 'var(--kind-transform)',
    sink: 'var(--kind-sink)',
    control: 'var(--kind-control)',
    quality: 'var(--kind-quality)',
    custom: 'var(--kind-custom)',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    sources: <ArrowDownToLine size={13} />,
    transforms: <Workflow size={13} />,
    sinks: <ArrowUpFromLine size={13} />,
    control: <GitFork size={13} />,
    quality: <ShieldCheck size={13} />,
    code: <Code2 size={13} />,
    saas: <Cloud size={13} />,
};

const DEFAULT_EXPANDED = new Set<string>();
const ALL_CATEGORY_IDS = PALETTE.map(c => c.id);

// Map palette top-level category IDs to i18n keys under "palette.*".
// Only top-level group labels are translated for now; subgroup labels
// ("Files", "Databases", "APIs", etc.) and component names stay English.
const CAT_LABEL_KEY: Record<string, string> = {
    sources: 'palette.sources',
    transforms: 'palette.transforms',
    sinks: 'palette.sinks',
    control: 'palette.controlFlow',
    quality: 'palette.dataQuality',
    code: 'palette.customCode',
};

export default function Palette() {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(DEFAULT_EXPANDED);

    const q = query.trim().toLowerCase();

    const filtered = useMemo(() => {
        if (!q) return PALETTE;
        return PALETTE.map(cat => ({
            ...cat,
            groups: cat.groups
                .map(g => ({
                    ...g,
                    components: g.components.filter(
                        c =>
                            c.label.toLowerCase().includes(q) ||
                            c.id.toLowerCase().includes(q) ||
                            (c.summary?.toLowerCase().includes(q) ?? false),
                    ),
                }))
                .filter(g => g.components.length > 0),
        })).filter(cat => cat.groups.length > 0);
    }, [q]);

    const toggle = (id: string) => {
        setExpanded(s => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const onDragStart = (e: DragEvent<HTMLDivElement>, c: ComponentDef) => {
        e.dataTransfer.setData('application/duckle-component', JSON.stringify(c));
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <aside className="palette">
            <div className="palette-header">
                <div className="palette-search-wrap">
                    <Search className="palette-search-icon" size={14} aria-hidden="true" />
                    <input
                        type="text"
                        className="palette-search"
                        placeholder="Search components…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        spellCheck={false}
                    />
                    {query ? (
                        <button
                            type="button"
                            className="palette-search-clear"
                            onClick={() => setQuery('')}
                            aria-label="Clear search"
                        >
                            <X size={12} />
                        </button>
                    ) : null}
                </div>
                <div className="palette-stats">
                    <span>
                        <b>{AVAILABLE_COUNT}</b> available
                    </span>
                    <span className="palette-stats-sep">·</span>
                    <span>
                        <b>{TOTAL_COMPONENT_COUNT}</b> total
                    </span>
                    <span className="palette-stats-spacer" />
                    <button
                        type="button"
                        className="palette-stats-btn"
                        onClick={() => setExpanded(new Set(ALL_CATEGORY_IDS))}
                        title="Expand all categories"
                    >
                        Expand all
                    </button>
                    <button
                        type="button"
                        className="palette-stats-btn"
                        onClick={() => setExpanded(new Set())}
                        title="Collapse all categories"
                    >
                        Collapse all
                    </button>
                </div>
            </div>

            <div className="palette-body">
                {filtered.length === 0 ? (
                    <div className="palette-empty">
                        No components match <span className="quote">{query}</span>
                    </div>
                ) : (
                    filtered.map(cat => {
                        const isExpanded = !!q || expanded.has(cat.id);
                        const count = cat.groups.reduce((acc, g) => acc + g.components.length, 0);
                        return (
                            <div className="palette-category" key={cat.id}>
                                <button
                                    type="button"
                                    className="palette-category-header"
                                    aria-expanded={isExpanded}
                                    onClick={() => toggle(cat.id)}
                                >
                                    <span className="palette-cat-chevron" aria-hidden="true">
                                        {isExpanded ? (
                                            <ChevronDown size={12} />
                                        ) : (
                                            <ChevronRight size={12} />
                                        )}
                                    </span>
                                    <span className="palette-cat-icon" aria-hidden="true">
                                        {CATEGORY_ICONS[cat.id]}
                                    </span>
                                    <span className="palette-cat-label">{CAT_LABEL_KEY[cat.id] ? t(CAT_LABEL_KEY[cat.id]) : cat.label}</span>
                                    <span className="palette-cat-count">{count}</span>
                                </button>
                                {isExpanded ? (
                                    <div className="palette-category-body">
                                        {cat.groups.map(g => (
                                            <div className="palette-group" key={g.id}>
                                                <div className="palette-group-label">{g.label}</div>
                                                {g.components.map(c => (
                                                    <div
                                                        key={c.id}
                                                        className={
                                                            'palette-component' +
                                                            (c.availability === 'planned'
                                                                ? ' is-planned'
                                                                : ' is-available')
                                                        }
                                                        draggable
                                                        onDragStart={e => onDragStart(e, c)}
                                                        title={c.summary ?? c.label}
                                                    >
                                                        <span
                                                            className="palette-component-dot"
                                                            style={{ background: KIND_COLOR[c.kind] }}
                                                            aria-hidden="true"
                                                        />
                                                        <span className="palette-component-label">
                                                            {c.label}
                                                        </span>
                                                        {c.availability === 'available' ? (
                                                            <Check
                                                                className="palette-availability palette-availability-yes"
                                                                size={12}
                                                                aria-label="available"
                                                            />
                                                        ) : (
                                                            <span
                                                                className="palette-availability palette-availability-no"
                                                                aria-label="planned"
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
