// Pure graph -> compact context serializer for the graph-aware copilot (C1).
// Turns the live canvas (nodes + edges) into a small JSON summary the LLM can
// reason about: node identity, kind, config, columns, and connections. Kept
// DOM-free and side-effect-free so it's trivially unit-testable.

export type GraphNodeInput = {
    id: string;
    data: {
        label?: string;
        componentId?: string;
        kind?: string;
        properties?: Record<string, unknown>;
        schema?: { name: string; type?: string }[];
    };
};

export type GraphEdgeInput = {
    id?: string;
    source: string;
    target: string;
};

export type GraphNodeSummary = {
    id: string;
    componentId?: string;
    kind?: string;
    label?: string;
    properties?: Record<string, unknown>;
    columns?: string[];
};

export type GraphSummary = {
    nodes: GraphNodeSummary[];
    edges: { source: string; target: string }[];
};

/**
 * Serialize the canvas into a compact, LLM-friendly summary. Empty
 * properties / schema are omitted to keep the payload small.
 */
export function serializeGraph(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
): GraphSummary {
    return {
        nodes: nodes.map(n => {
            const summary: GraphNodeSummary = { id: n.id };
            if (n.data.componentId !== undefined) summary.componentId = n.data.componentId;
            if (n.data.kind !== undefined) summary.kind = n.data.kind;
            if (n.data.label !== undefined) summary.label = n.data.label;
            const props = n.data.properties;
            if (props && Object.keys(props).length > 0) summary.properties = props;
            const schema = n.data.schema;
            if (schema && schema.length > 0) summary.columns = schema.map(c => c.name);
            return summary;
        }),
        edges: edges.map(e => ({ source: e.source, target: e.target })),
    };
}
