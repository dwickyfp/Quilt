// Pure reusable-component core. DOM-free and side-effect-free for trivial unit
// testing. A "component" is a saved subgraph turned into a single reusable node:
// extractComponent() derives its boundary ports (input/output) from the edges
// that cross the selection boundary; instantiateComponent() inlines a saved
// definition back into a graph with namespaced node ids (no collisions) and
// param substitution into inner node props. The engine reuses the existing
// run-pipeline inlining to execute an instantiated component.

export type CompNode = {
    id: string;
    data: { componentId?: string; properties?: Record<string, unknown> };
};

export type CompEdge = {
    id: string;
    source: string;
    target: string;
    targetHandle?: string;
};

/** A boundary input port: an inner node (+ optional handle) that an outside
 *  edge feeds into. */
export type InputPort = { node: string; handle?: string };
/** A boundary output port: an inner node whose output leaves the selection. */
export type OutputPort = { node: string };

/** A parameter exposed by the component: substitutes into one inner node's prop. */
export type ComponentParam = { key: string; node: string; prop: string };

export type ComponentDef = {
    nodes: CompNode[];
    edges: CompEdge[];
    inputs: InputPort[];
    outputs: OutputPort[];
    params: ComponentParam[];
};

/**
 * Extract a component definition from a selection of node ids. Edges fully
 * inside the selection are kept as the component body; edges crossing the
 * boundary become input ports (entering) or output ports (leaving).
 */
export function extractComponent(
    nodes: CompNode[],
    edges: CompEdge[],
    selectedIds: string[],
): ComponentDef {
    const selected = new Set(selectedIds);
    const bodyNodes = nodes.filter(n => selected.has(n.id));
    const bodyEdges: CompEdge[] = [];
    const inputs: InputPort[] = [];
    const outputs: OutputPort[] = [];

    for (const e of edges) {
        const srcIn = selected.has(e.source);
        const tgtIn = selected.has(e.target);
        if (srcIn && tgtIn) {
            bodyEdges.push({ id: e.id, source: e.source, target: e.target, targetHandle: e.targetHandle });
        } else if (!srcIn && tgtIn) {
            inputs.push({ node: e.target, handle: e.targetHandle });
        } else if (srcIn && !tgtIn) {
            outputs.push({ node: e.source });
        }
    }
    return { nodes: bodyNodes, edges: bodyEdges, inputs, outputs, params: [] };
}

const NS = '__';
const nsId = (prefix: string, id: string): string => `${prefix}${NS}${id}`;

/**
 * Instantiate a saved component into concrete nodes/edges. Every inner node id
 * is namespaced with `instanceId` so multiple instances never collide. Params
 * are substituted into the targeted inner node's prop (exact replace of the
 * whole value). Boundary ports are remapped to the namespaced ids so the caller
 * can wire the instance into the host graph.
 */
export function instantiateComponent(
    def: ComponentDef,
    instanceId: string,
    paramValues: Record<string, unknown>,
): {
    nodes: CompNode[];
    edges: CompEdge[];
    inputs: InputPort[];
    outputs: OutputPort[];
} {
    // Clone nodes with namespaced ids + apply param substitution.
    const paramsByNode = new Map<string, ComponentParam[]>();
    for (const p of def.params) {
        const list = paramsByNode.get(p.node) ?? [];
        list.push(p);
        paramsByNode.set(p.node, list);
    }

    const nodes: CompNode[] = def.nodes.map(orig => {
        const props: Record<string, unknown> = { ...(orig.data.properties ?? {}) };
        for (const p of paramsByNode.get(orig.id) ?? []) {
            if (Object.prototype.hasOwnProperty.call(paramValues, p.key)) {
                props[p.prop] = paramValues[p.key];
            }
        }
        return {
            id: nsId(instanceId, orig.id),
            data: { componentId: orig.data.componentId, properties: props },
        };
    });

    const edges: CompEdge[] = def.edges.map(orig => ({
        id: nsId(instanceId, orig.id),
        source: nsId(instanceId, orig.source),
        target: nsId(instanceId, orig.target),
        targetHandle: orig.targetHandle,
    }));

    const inputs: InputPort[] = def.inputs.map(p => ({ node: nsId(instanceId, p.node), handle: p.handle }));
    const outputs: OutputPort[] = def.outputs.map(p => ({ node: nsId(instanceId, p.node) }));

    return { nodes, edges, inputs, outputs };
}
