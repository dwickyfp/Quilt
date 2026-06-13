// Pure graph-patch engine for the graph-aware copilot (C2). The LLM returns a
// list of ops; this applies them immutably so the diff/apply UI (C4) can
// preview before committing. DOM-free + side-effect-free for easy testing.

export type PatchNode = {
    id: string;
    data: {
        label?: string;
        componentId?: string;
        kind?: string;
        properties?: Record<string, unknown>;
        [k: string]: unknown;
    };
    [k: string]: unknown;
};

export type PatchEdge = {
    id?: string;
    source: string;
    target: string;
    [k: string]: unknown;
};

export type GraphPatchOp =
    | { op: 'add_node'; node: PatchNode }
    | { op: 'update_node'; id: string; properties: Record<string, unknown> }
    | { op: 'delete_node'; id: string }
    | { op: 'connect'; source: string; target: string }
    | { op: 'disconnect'; source: string; target: string };

export type PatchResult = { nodes: PatchNode[]; edges: PatchEdge[] };

function edgeId(source: string, target: string): string {
    return `e-${source}-${target}`;
}

/**
 * Apply a list of patch ops to (nodes, edges) immutably. Ops referencing
 * unknown nodes are skipped silently (the LLM may hallucinate). Returns new
 * arrays; inputs are never mutated.
 */
export function applyGraphPatch(
    nodes: PatchNode[],
    edges: PatchEdge[],
    ops: GraphPatchOp[],
): PatchResult {
    let outNodes: PatchNode[] = nodes.map(n => ({ ...n, data: { ...n.data } }));
    let outEdges: PatchEdge[] = edges.map(e => ({ ...e }));

    for (const op of ops) {
        switch (op.op) {
            case 'add_node': {
                if (!outNodes.some(n => n.id === op.node.id)) {
                    outNodes = [...outNodes, { ...op.node, data: { ...op.node.data } }];
                }
                break;
            }
            case 'update_node': {
                outNodes = outNodes.map(n =>
                    n.id === op.id
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  properties: { ...(n.data.properties ?? {}), ...op.properties },
                              },
                          }
                        : n,
                );
                break;
            }
            case 'delete_node': {
                outNodes = outNodes.filter(n => n.id !== op.id);
                outEdges = outEdges.filter(e => e.source !== op.id && e.target !== op.id);
                break;
            }
            case 'connect': {
                const known = outNodes.some(n => n.id === op.source) && outNodes.some(n => n.id === op.target);
                const dup = outEdges.some(e => e.source === op.source && e.target === op.target);
                if (known && !dup) {
                    outEdges = [...outEdges, { id: edgeId(op.source, op.target), source: op.source, target: op.target }];
                }
                break;
            }
            case 'disconnect': {
                outEdges = outEdges.filter(e => !(e.source === op.source && e.target === op.target));
                break;
            }
        }
    }

    return { nodes: outNodes, edges: outEdges };
}

/** Human-readable one-line summary per op for the diff/approve UI. */
export function summarizePatch(ops: GraphPatchOp[]): string[] {
    return ops.map(op => {
        switch (op.op) {
            case 'add_node':
                return `Add node ${op.node.id} (${op.node.data.componentId ?? '?'})`;
            case 'update_node':
                return `Update node ${op.id}: ${Object.keys(op.properties).join(', ')}`;
            case 'delete_node':
                return `Delete node ${op.id}`;
            case 'connect':
                return `Connect ${op.source} -> ${op.target}`;
            case 'disconnect':
                return `Disconnect ${op.source} -> ${op.target}`;
        }
    });
}

const VALID_OPS = new Set(['add_node', 'update_node', 'delete_node', 'connect', 'disconnect']);

/**
 * Extract a graph patch from an assistant reply. The LLM is asked to emit a
 * fenced ```json block of shape {"ops":[...]}. Returns the validated ops, or
 * null when there is no patch / it's malformed / it's not a patch payload.
 * Ops with unknown op names are dropped (defensive against hallucination).
 */
export function extractGraphPatch(assistantText: string): GraphPatchOp[] | null {
    const lower = assistantText.toLowerCase();
    let start = lower.indexOf('```json');
    if (start === -1) start = lower.indexOf('```');
    if (start === -1) return null;
    const nl = assistantText.indexOf('\n', start);
    if (nl === -1) return null;
    const after = assistantText.slice(nl + 1);
    const end = after.indexOf('```');
    if (end === -1) return null;
    const body = after.slice(0, end).trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const ops = (parsed as { ops?: unknown }).ops;
    if (!Array.isArray(ops)) return null;

    const valid = ops.filter(
        (o): o is GraphPatchOp =>
            typeof o === 'object' && o !== null && VALID_OPS.has((o as { op?: string }).op ?? ''),
    );
    return valid;
}

