// Pure column-level lineage for the visual pipeline. DOM-free and
// side-effect-free so it's trivially unit-testable. Given the canvas nodes +
// edges, it derives, per node, which upstream column(s) feed each output
// column - using each node's known transform semantics (source / rename /
// passthrough / multi-input join). Deliberately coarse: it mirrors the column
// mapping the engine performs, not a full SQL parser (YAGNI). The result powers
// the "trace this column's origin" overlay.

export type LineageNodeInput = {
    id: string;
    data: {
        componentId?: string;
        properties?: Record<string, unknown>;
        schema?: { name: string }[];
    };
};

export type LineageEdgeInput = {
    id?: string;
    source: string;
    target: string;
    connectionType?: string;
    targetHandle?: string;
};

/** A reference to the column on a node that an output column originates from. */
export type SourceRef = { nodeId: string; column: string };

/** node id -> (output column -> immediate upstream origins). */
export type Lineage = Map<string, Map<string, SourceRef[]>>;

type Upstream = { source: string; isLookup: boolean };

function columnsOf(node: LineageNodeInput): string[] {
    return (node.data.schema ?? []).map(c => c.name);
}

/** Parse the Rename node's "to -> from" map from any of its accepted shapes,
 *  mirroring the engine's rename_pairs precedence (renames/columns arrays with
 *  from/to or source/target, then a mapping object of old -> new). */
function renameToFrom(props: Record<string, unknown> | undefined): Map<string, string> {
    const out = new Map<string, string>();
    if (!props) return out;
    const arr = (props.renames ?? props.columns) as unknown;
    if (Array.isArray(arr)) {
        for (const r of arr) {
            if (r && typeof r === 'object') {
                const rec = r as Record<string, unknown>;
                const from = (rec.from ?? rec.source) as string | undefined;
                const to = (rec.to ?? rec.target) as string | undefined;
                if (from && to) out.set(to, from);
            }
        }
    }
    if (out.size === 0 && props.mapping && typeof props.mapping === 'object') {
        // mapping is old -> new; invert to new(to) -> old(from).
        for (const [oldName, newName] of Object.entries(props.mapping as Record<string, unknown>)) {
            if (typeof newName === 'string' && newName) out.set(newName, oldName);
        }
    }
    return out;
}

/** For a passthrough/multi-input node, an output column originates from every
 *  upstream input that carries a column of that name. A column that no upstream
 *  carries was created at this node, so it originates from itself. */
function originsFromUpstreams(
    col: string,
    upstreams: Upstream[],
    byId: Map<string, LineageNodeInput>,
    selfId: string,
): SourceRef[] {
    const origins: SourceRef[] = [];
    for (const up of upstreams) {
        const upNode = byId.get(up.source);
        if (upNode && columnsOf(upNode).includes(col)) {
            origins.push({ nodeId: up.source, column: col });
        }
    }
    return origins.length > 0 ? origins : [{ nodeId: selfId, column: col }];
}

/**
 * Build per-node, per-column immediate-origin lineage for the whole graph.
 * Each output column maps to the upstream column(s) it came from one hop back;
 * walk the chain with traceColumn for the full path to the source.
 */
export function buildLineage(nodes: LineageNodeInput[], edges: LineageEdgeInput[]): Lineage {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const incoming = new Map<string, Upstream[]>();
    for (const e of edges) {
        const isLookup = e.connectionType === 'lookup' || e.targetHandle === 'lookup';
        const list = incoming.get(e.target) ?? [];
        list.push({ source: e.source, isLookup });
        incoming.set(e.target, list);
    }

    const lineage: Lineage = new Map();
    for (const n of nodes) {
        const cols = columnsOf(n);
        const colMap = new Map<string, SourceRef[]>();
        const cid = n.data.componentId ?? '';
        const upstreams = incoming.get(n.id) ?? [];

        if (cid.startsWith('src.') || upstreams.length === 0) {
            // Source (or disconnected): every column originates from itself.
            for (const col of cols) colMap.set(col, [{ nodeId: n.id, column: col }]);
        } else if (cid === 'xf.rename') {
            const mainUp = (upstreams.find(u => !u.isLookup) ?? upstreams[0]).source;
            const toFrom = renameToFrom(n.data.properties);
            for (const col of cols) {
                const from = toFrom.get(col);
                if (from !== undefined) {
                    colMap.set(col, [{ nodeId: mainUp, column: from }]);
                } else {
                    colMap.set(col, originsFromUpstreams(col, upstreams, byId, n.id));
                }
            }
        } else {
            // Generic (filter / drop / join / set / etc.): each surviving output
            // column traces to whichever upstream input(s) carry that name.
            for (const col of cols) {
                colMap.set(col, originsFromUpstreams(col, upstreams, byId, n.id));
            }
        }
        lineage.set(n.id, colMap);
    }
    return lineage;
}

/**
 * Walk a column back through the lineage graph to its ultimate source(s),
 * following the first immediate origin at each hop. Returns the path starting
 * at the queried node/column and ending at the source node/column. Stops at a
 * self-referential origin (a source node) or a cycle.
 */
export function traceColumn(lineage: Lineage, nodeId: string, column: string): SourceRef[] {
    const path: SourceRef[] = [];
    const visited = new Set<string>();
    let cur: SourceRef = { nodeId, column };
    for (;;) {
        path.push(cur);
        const key = `${cur.nodeId}\u0000${cur.column}`;
        if (visited.has(key)) break;
        visited.add(key);
        const origins = lineage.get(cur.nodeId)?.get(cur.column);
        if (!origins || origins.length === 0) break;
        const next = origins[0];
        if (next.nodeId === cur.nodeId && next.column === cur.column) break; // source reached
        cur = next;
    }
    return path;
}
