import type { Node } from '@xyflow/react';
import type { QuiltNodeData } from './pipeline-types';
import type { ConnectionPayload, ContextPayload, RepoItem, RoutinePayload } from './repo-types';
import { SECRET_CONNECTION_KEYS } from './repo-types';

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
