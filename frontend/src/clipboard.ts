import type { Edge, Node } from '@xyflow/react';
import type { QuiltNodeData } from './pipeline-types';

// A localStorage-backed clipboard for canvas components (issue #28). Using
// localStorage (not React state) means a copy survives switching the active
// pipeline, so components can be pasted from one pipeline into another.
const CLIPBOARD_KEY = 'quilt.clipboard';

export type Clipboard = {
    nodes: Node<QuiltNodeData>[];
    edges: Edge[];
};

// Store the given nodes plus only the edges whose endpoints are both in the
// copied set (internal wiring). Returns how many nodes were copied.
export function writeClipboard(nodes: Node<QuiltNodeData>[], allEdges: Edge[]): number {
    if (nodes.length === 0) return 0;
    const ids = new Set(nodes.map(n => n.id));
    const edges = allEdges.filter(e => ids.has(e.source) && ids.has(e.target));
    const payload: Clipboard = {
        nodes: nodes.map(n => ({ ...n, selected: false, dragging: false })),
        edges: edges.map(e => ({ ...e, selected: false })),
    };
    try {
        localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {
        return 0;
    }
    return nodes.length;
}

export function readClipboard(): Clipboard | null {
    try {
        const raw = localStorage.getItem(CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Clipboard;
        if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
        return { nodes: parsed.nodes, edges: Array.isArray(parsed.edges) ? parsed.edges : [] };
    } catch {
        return null;
    }
}

// Turn a clipboard into fresh nodes/edges ready to insert: brand-new ids (so
// they never collide with existing nodes), a small position offset so the
// paste is visibly distinct, and selected so the user sees what landed.
// `mkNodeId` / `mkEdgeId` mint ids in the caller's scheme.
export function instantiateClipboard(
    clip: Clipboard,
    mkNodeId: () => string,
    mkEdgeId: () => string,
    offset = 40,
): { nodes: Node<QuiltNodeData>[]; edges: Edge[] } {
    const idMap = new Map<string, string>();
    for (const n of clip.nodes) idMap.set(n.id, mkNodeId());
    const nodes = clip.nodes.map(n => ({
        ...n,
        id: idMap.get(n.id) as string,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: true,
        dragging: false,
    }));
    const edges = clip.edges.map(e => ({
        ...e,
        id: mkEdgeId(),
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
        selected: false,
    }));
    return { nodes, edges };
}
