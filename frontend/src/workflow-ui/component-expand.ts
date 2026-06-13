// Host-graph component expansion. Bridges the pure `component-def.ts` core to a
// runnable flat graph: every saved-component INSTANCE node (componentId
// `cmp.*`) is replaced in place by its namespaced inner nodes/edges, and the
// host edges that touched the instance are rewired to the component's boundary
// input/output ports. The result is an ordinary graph the engine already knows
// how to run, so reusable components need ZERO engine changes - expansion
// happens in the frontend before the graph is serialized for a run.
//
// Scope: single-input / single-output components (the common reusable
// transform-chain case). Multi-port components are a clean future extension -
// the boundary-port arrays already support it; only the host-edge rewiring
// below assumes one input + one output port.

import { instantiateComponent, type ComponentDef } from './component-def';

export type HostNode = {
    id: string;
    data: { componentId?: string; properties?: Record<string, unknown> };
};

export type HostEdge = {
    id: string;
    source: string;
    target: string;
    targetHandle?: string;
};

/** A saved reusable component: a `cmp.*` id, a label, and its extracted def. */
export type SavedComponent = {
    id: string;
    label: string;
    def: ComponentDef;
};

const NS = '__';
const nsId = (prefix: string, id: string): string => `${prefix}${NS}${id}`;

/**
 * Expand every saved-component instance in a host graph into its inner nodes,
 * rewiring boundary edges to the component's input/output ports. Instances
 * whose definition can't be found are left untouched (the engine will surface
 * the unknown component id rather than silently dropping the node). Pure and
 * side-effect-free: returns new arrays, never mutates the inputs.
 */
export function expandComponents(
    nodes: HostNode[],
    edges: HostEdge[],
    components: SavedComponent[],
): { nodes: HostNode[]; edges: HostEdge[] } {
    const defById = new Map(components.map(c => [c.id, c]));

    // Which nodes are expandable instances? (cmp.* with a known def.)
    const instances = nodes.filter(
        n => n.data.componentId != null && defById.has(n.data.componentId),
    );
    if (instances.length === 0) {
        // Fast path: nothing to expand, hand back shallow copies for safety.
        return { nodes: [...nodes], edges: [...edges] };
    }

    const instanceIds = new Set(instances.map(n => n.id));

    // Carry through every non-instance node unchanged.
    const outNodes: HostNode[] = nodes.filter(n => !instanceIds.has(n.id));
    const outEdges: HostEdge[] = [];

    // Expand each instance: emit its inner nodes/edges and record its boundary
    // ports so host edges can be resolved against them in a single pass below.
    const portOf = new Map<string, { inPort?: string; inHandle?: string; outPort?: string }>();
    for (const inst of instances) {
        const comp = defById.get(inst.data.componentId!)!;
        const paramValues = inst.data.properties ?? {};
        const expanded = instantiateComponent(comp.def, inst.id, paramValues);

        for (const n of expanded.nodes) {
            outNodes.push({
                id: n.id,
                data: { componentId: n.data.componentId, properties: n.data.properties },
            });
        }
        for (const e of expanded.edges) {
            outEdges.push({
                id: e.id,
                source: e.source,
                target: e.target,
                targetHandle: e.targetHandle,
            });
        }
        portOf.set(inst.id, {
            inPort: expanded.inputs[0]?.node,
            inHandle: expanded.inputs[0]?.handle,
            outPort: expanded.outputs[0]?.node,
        });
    }

    // Rewire host edges in one pass. Resolve BOTH endpoints against the port
    // map so an edge between two instances (a -> b) becomes
    // <a output port> -> <b input port> correctly. An edge whose instance
    // endpoint has no matching boundary port is dropped (nothing to wire to).
    for (const e of edges) {
        const srcPorts = portOf.get(e.source);
        const tgtPorts = portOf.get(e.target);

        // Edge untouched by any instance: keep as-is.
        if (!srcPorts && !tgtPorts) {
            outEdges.push({ ...e });
            continue;
        }

        const source = srcPorts ? srcPorts.outPort : e.source;
        const target = tgtPorts ? tgtPorts.inPort : e.target;
        // If either resolved endpoint is missing (component lacks that boundary
        // port), there's nothing valid to connect - skip the edge.
        if (source == null || target == null) {
            continue;
        }
        outEdges.push({
            id: nsId(`${e.source}_${e.target}`, e.id),
            source,
            target,
            targetHandle: tgtPorts ? tgtPorts.inHandle ?? e.targetHandle : e.targetHandle,
        });
    }

    return { nodes: outNodes, edges: outEdges };
}
