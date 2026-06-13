import type { Edge, Node } from '@xyflow/react';
import type { QuiltNodeData } from './pipeline-types';
import type { ConnectionPayload, ContextPayload, RepoItem, RoutinePayload } from './repo-types';
import { SECRET_CONNECTION_KEYS } from './repo-types';
import { expandComponents, type HostEdge, type HostNode, type SavedComponent } from './workflow-ui/component-expand';

/**
 * Resolve a pipeline's nodes for execution:
 *   1. Inline a referenced SQL routine into Custom-SQL nodes.
 *   2. Substitute `${var}` / `${context.var}` references in field values
 *      with the workspace's context variables.
 *   3. Map a child-pipeline reference (Run Job / Iterate / Foreach / Try)
 *      stored as a workspace pipeline id to its on-disk file path, which
 *      is what the engine reads.
 *   4. Inject a referenced connection's secret fields (password / access
 *      keys) from the decrypted in-memory connection. These are never stored
 *      on the node (so they can't leak into the unencrypted pipeline file or
 *      git); they live only in the transient run copy produced here.
 *
 * Run on the working nodes right before they're sent to the engine, so
 * the canvas keeps the un-substituted, editable values.
 */

// Props that hold a reference to another pipeline the engine will read
// from disk. The dropdown stores a portable pipeline id; the engine needs
// a file path, so we resolve here at run time.
const PIPELINE_REF_KEYS = [
    'pipelineRef',
    'iteratePipelineRef',
    'foreachPipelineRef',
    'fallbackPipelineRef',
];

function joinPath(dir: string, ...parts: string[]): string {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return [dir.replace(/[/\\]+$/, ''), ...parts].join(sep);
}

export function buildContextVars(repo: RepoItem[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const item of repo) {
        if (item.type !== 'context') continue;
        const payload = item.payload as ContextPayload | undefined;
        if (!payload?.variables) continue;
        for (const v of payload.variables) {
            // Both the bare key and a context-namespaced key resolve.
            out[v.key] = v.value;
            out[`${item.name}.${v.key}`] = v.value;
        }
    }
    return out;
}

function substituteString(value: string, vars: Record<string, string>): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, expr) => {
        const key = String(expr).trim();
        return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match;
    });
}

function substituteDeep(value: unknown, vars: Record<string, string>): unknown {
    if (typeof value === 'string') return substituteString(value, vars);
    if (Array.isArray(value)) return value.map(v => substituteDeep(v, vars));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = substituteDeep(v, vars);
        return out;
    }
    return value;
}

export function resolveForRun(
    nodes: Node<QuiltNodeData>[],
    repo: RepoItem[],
    workspacePath?: string | null,
): Node<QuiltNodeData>[] {
    const vars = buildContextVars(repo);
    const sqlRoutines = new Map<string, string>();
    // Map a workspace pipeline id (or name) to its on-disk file path so a
    // dropdown-stored id resolves to something the engine can read.
    const pipelinePaths = new Map<string, string>();
    // Map a connection id to its (decrypted, in-memory) payload so a node's
    // `connectionRef` can have its secret fields injected at run time.
    const connections = new Map<string, ConnectionPayload>();
    for (const item of repo) {
        if (item.type === 'routine') {
            const payload = item.payload as RoutinePayload | undefined;
            if (payload?.language === 'sql' && payload.code) {
                sqlRoutines.set(item.id, payload.code);
                sqlRoutines.set(item.name, payload.code);
            }
        } else if (item.type === 'pipeline' && workspacePath) {
            const file = joinPath(workspacePath, 'pipelines', `${item.id}.json`);
            pipelinePaths.set(item.id, file);
            pipelinePaths.set(item.name, file);
        } else if (item.type === 'connection' && item.payload) {
            connections.set(item.id, item.payload as ConnectionPayload);
        }
    }
    const hasVars = Object.keys(vars).length > 0;

    return nodes.map(node => {
        const props = { ...(node.data.properties ?? {}) } as Record<string, unknown>;

        // Inline a referenced SQL routine when there's no inline SQL.
        if (node.data.componentId === 'code.sql' || node.data.componentId === 'code.sqltemplate') {
            const ref = typeof props.routineRef === 'string' ? props.routineRef : '';
            const inline = typeof props.sql === 'string' ? props.sql.trim() : '';
            if (ref && !inline && sqlRoutines.has(ref)) {
                props.sql = sqlRoutines.get(ref);
            }
        }

        const resolved = hasVars
            ? (substituteDeep(props, vars) as Record<string, unknown>)
            : props;

        // Inject connection secrets from the saved connection. The node only
        // stores `connectionRef`; secret fields are filled in here for the run
        // and never written back to the node. A field the user typed inline on
        // the node (not empty) wins, so an explicit per-node override still
        // works.
        const ref = typeof resolved.connectionRef === 'string' ? resolved.connectionRef : '';
        if (ref && connections.has(ref)) {
            const conn = connections.get(ref)!;
            for (const key of SECRET_CONNECTION_KEYS) {
                const existing = resolved[key];
                const hasInline = typeof existing === 'string' && existing !== '';
                const secret = conn[key];
                if (!hasInline && secret !== undefined && secret !== '') {
                    resolved[key] = secret;
                }
            }
        }

        // Resolve child-pipeline ids to file paths. A value that isn't a
        // known pipeline id/name (a hand-typed literal path from before the
        // picker existed) is left untouched.
        if (pipelinePaths.size > 0) {
            for (const key of PIPELINE_REF_KEYS) {
                const v = resolved[key];
                if (typeof v === 'string' && pipelinePaths.has(v)) {
                    resolved[key] = pipelinePaths.get(v);
                }
            }
        }

        return { ...node, data: { ...node.data, properties: resolved } };
    });
}

/** Map a componentId to the React Flow node `type` the engine/canvas expect,
 *  from the id prefix. Defaults to `transform` (the engine only really cares
 *  about `source`/`sink` for port shape; everything else runs as a transform). */
function flowTypeForComponentId(componentId: string | undefined): string {
    if (componentId == null) return 'transform';
    if (componentId.startsWith('src.')) return 'source';
    if (componentId.startsWith('snk.')) return 'sink';
    if (componentId.startsWith('ml.')) return 'ml';
    if (componentId.startsWith('viz.')) return 'viz';
    return 'transform';
}

/**
 * Expand every saved-component instance in a React Flow graph into its inner
 * nodes/edges BEFORE the graph is resolved + sent to the engine. The engine
 * only ever sees a flat graph, so reusable components need no engine support.
 *
 * Inner nodes inherit their parent instance's canvas position (run-only graph,
 * so exact layout is irrelevant - this just keeps every node's `position`
 * defined) and get a `type` derived from their componentId. Returns the
 * expanded nodes + edges; pass the nodes on to `resolveForRun` so inner nodes
 * still get context-var / connection / routine resolution.
 */
export function expandComponentsForRun(
    nodes: Node<QuiltNodeData>[],
    edges: Edge[],
    components: SavedComponent[],
): { nodes: Node<QuiltNodeData>[]; edges: Edge[] } {
    if (components.length === 0) {
        return { nodes, edges };
    }
    const hostNodes: HostNode[] = nodes.map(n => ({
        id: n.id,
        data: { componentId: n.data.componentId, properties: n.data.properties },
    }));
    const hostEdges: HostEdge[] = edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        targetHandle: e.targetHandle ?? undefined,
    }));

    const expanded = expandComponents(hostNodes, hostEdges, components);

    // Nothing expanded: hand back the originals untouched (preserves all RF
    // node/edge fields, no needless reconstruction).
    if (expanded.nodes.length === nodes.length && expanded.edges.length === edges.length) {
        const sameNodes = expanded.nodes.every((n, i) => n.id === nodes[i]?.id);
        if (sameNodes) return { nodes, edges };
    }

    const NS = '__';
    const byId = new Map(nodes.map(n => [n.id, n]));
    const outNodes: Node<QuiltNodeData>[] = expanded.nodes.map(hn => {
        // An untouched original node: reuse it verbatim.
        const original = byId.get(hn.id);
        if (original) return original;
        // A synthesized inner node `<instanceId>__<innerId>`: inherit the
        // instance's position + label, derive type from componentId.
        const instanceId = hn.id.split(NS)[0]!;
        const parent = byId.get(instanceId);
        const position = parent?.position ?? { x: 0, y: 0 };
        return {
            id: hn.id,
            type: flowTypeForComponentId(hn.data.componentId),
            position,
            data: {
                label: hn.data.componentId ?? hn.id,
                componentId: hn.data.componentId,
                properties: hn.data.properties,
            },
        } as Node<QuiltNodeData>;
    });

    const origEdgeById = new Map(edges.map(e => [e.id, e]));
    const outEdges: Edge[] = expanded.edges.map(he => {
        const original = origEdgeById.get(he.id);
        if (original && original.source === he.source && original.target === he.target) {
            return original;
        }
        return {
            id: he.id,
            source: he.source,
            target: he.target,
            ...(he.targetHandle ? { targetHandle: he.targetHandle } : {}),
        } as Edge;
    });

    return { nodes: outNodes, edges: outEdges };
}
