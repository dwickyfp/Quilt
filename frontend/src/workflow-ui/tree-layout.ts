import dagre from '@dagrejs/dagre';

export type LayoutNode = {
    id: string;
    measured?: { width?: number; height?: number };
};

export type LayoutEdge = {
    id: string;
    source: string;
    target: string;
};

export type XY = { x: number; y: number };

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 80;

// Tree-style layered layout. rankdir 'LR' flows left→right (matching the
// node's Left=in / Right=out handles); branches spread vertically (up/down).
// dagre returns node centers — we convert to React Flow's top-left origin.
export function layoutTree(
    nodes: LayoutNode[],
    edges: LayoutEdge[],
): Map<string, XY> {
    const result = new Map<string, XY>();
    if (nodes.length === 0) return result;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    const dims = new Map<string, { width: number; height: number }>();
    for (const n of nodes) {
        const width = n.measured?.width ?? DEFAULT_WIDTH;
        const height = n.measured?.height ?? DEFAULT_HEIGHT;
        dims.set(n.id, { width, height });
        g.setNode(n.id, { width, height });
    }

    const nodeIds = new Set(nodes.map(n => n.id));
    for (const e of edges) {
        if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
            g.setEdge(e.source, e.target);
        }
    }

    dagre.layout(g);

    for (const n of nodes) {
        const p = g.node(n.id);
        if (!p) continue;
        const { width, height } = dims.get(n.id)!;
        result.set(n.id, { x: p.x - width / 2, y: p.y - height / 2 });
    }

    return result;
}
