// Pure stage-cache core for smart incremental re-run. DOM-free and
// side-effect-free for trivial unit testing. The idea: each stage gets a
// deterministic content key = hash(componentId + canonical props + the keys of
// all its upstream stages). Editing a node changes its key, which cascades to
// every downstream node's key (because they fold in their parents' keys). On a
// run, a stage whose key matches the last successful run can reuse its cached
// materialized table instead of re-executing. The engine consumes these keys;
// this module just computes + compares them.

export type CacheNode = {
    id: string;
    data: { componentId?: string; properties?: Record<string, unknown> };
};

export type CacheEdge = { source: string; target: string };

// Stable stringify: object keys sorted recursively so prop order never affects
// the hash. Arrays keep their order (order is semantic for e.g. column lists).
function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

// FNV-1a 32-bit string hash rendered as hex. Deterministic, no deps; collision
// risk is irrelevant here (a collision just means a spurious cache hit on two
// genuinely different configs, astronomically unlikely for this input size).
function hash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute a deterministic cache key per node. A node's key folds in its
 * componentId, its canonicalized props, and the (sorted) keys of all its
 * upstream nodes - so any upstream change propagates downstream. Computed in
 * topological order; cycles (which the engine rejects anyway) fall back to an
 * empty upstream contribution to stay deterministic and terminating.
 */
export function computeCacheKeys(nodes: CacheNode[], edges: CacheEdge[]): Map<string, string> {
    const parents = new Map<string, string[]>();
    for (const n of nodes) parents.set(n.id, []);
    for (const e of edges) {
        if (parents.has(e.target)) parents.get(e.target)!.push(e.source);
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    const keys = new Map<string, string>();
    const visiting = new Set<string>();

    const keyOf = (id: string): string => {
        const cached = keys.get(id);
        if (cached !== undefined) return cached;
        if (visiting.has(id)) return ''; // cycle guard
        visiting.add(id);
        const node = byId.get(id);
        const cid = node?.data.componentId ?? '';
        const props = canonical(node?.data.properties ?? {});
        const upKeys = (parents.get(id) ?? [])
            .map(keyOf)
            .sort()
            .join('|');
        const key = hash(`${cid}\u0000${props}\u0000${upKeys}`);
        visiting.delete(id);
        keys.set(id, key);
        return key;
    };

    for (const n of nodes) keyOf(n.id);
    return keys;
}

/**
 * Given an edited node, return the set of nodes that must be re-executed: the
 * node itself plus every transitive downstream node (a BFS over outgoing edges).
 */
export function invalidatedNodes(
    nodeIds: string[],
    edges: CacheEdge[],
    editedId: string,
): Set<string> {
    const children = new Map<string, string[]>();
    for (const id of nodeIds) children.set(id, []);
    for (const e of edges) {
        if (children.has(e.source)) children.get(e.source)!.push(e.target);
    }
    const out = new Set<string>();
    const queue = [editedId];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (out.has(cur)) continue;
        out.add(cur);
        for (const c of children.get(cur) ?? []) queue.push(c);
    }
    return out;
}

/**
 * Compare freshly computed keys against the keys from the last successful run.
 * A node is stale (needs re-exec) if its key changed or it was never run.
 */
export function staleNodes(current: Map<string, string>, previous: Map<string, string>): Set<string> {
    const out = new Set<string>();
    for (const [id, key] of current) {
        if (previous.get(id) !== key) out.add(id);
    }
    return out;
}
