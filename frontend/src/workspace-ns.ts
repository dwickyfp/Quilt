import type { RepoItem } from './repo-types';

/**
 * Multi-workspace namespacing core (pure / DOM-free, unit-tested).
 *
 * Several workspaces are open at once but the app keeps a SINGLE merged `repo`
 * and `pipelineData`. Every workspace ships the same bare ids (`root`,
 * `pipelines`, `j1`, …), so we prefix each id with a per-workspace **token**
 * to keep them distinct in the merged state: `<token>__<bareId>`.
 *
 * CRITICAL INVARIANT: only repo **ids/parentIds** and pipelineData **keys** are
 * namespaced. Node properties — which embed workspace-scoped references like
 * `connectionRef`, `routineRef`, `pipelineRef` — are NEVER touched. They stay
 * bare and are resolved per-workspace at run time (see run-resolve.ts), so the
 * on-disk pipeline files and the ref-resolution logic are completely unchanged.
 * De-namespacing before save/run restores the exact bare ids written to disk.
 */

export const NS_SEP = '__';

/** An open workspace: its namespace token, on-disk path, and display name. */
export type WorkspaceRef = {
    token: string;
    path: string;
    name: string;
};

/**
 * Stable short token for a workspace path. FNV-1a (32-bit) hex — deterministic,
 * collision-resistant enough for a handful of open folders, and guaranteed not
 * to contain the `__` separator or any id-unsafe char.
 */
export function workspaceToken(path: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i);
        // h *= 16777619, kept in 32-bit space.
        h = Math.imul(h, 0x01000193);
    }
    // >>> 0 → unsigned; pad so the token is fixed-width and never empty.
    return 'ws' + (h >>> 0).toString(16).padStart(8, '0');
}

/** Prefix a bare id with a workspace token. */
export function nsId(token: string, bareId: string): string {
    return token + NS_SEP + bareId;
}

/** The workspace token embedded in a namespaced id, or null if unprefixed. */
export function tokenOf(namespacedId: string): string | null {
    const i = namespacedId.indexOf(NS_SEP);
    return i > 0 ? namespacedId.slice(0, i) : null;
}

/** Strip the workspace token from a namespaced id, returning the bare id. */
export function bareIdOf(namespacedId: string): string {
    const i = namespacedId.indexOf(NS_SEP);
    return i >= 0 ? namespacedId.slice(i + NS_SEP.length) : namespacedId;
}

/**
 * Namespace a single workspace's repo items into the merged tree. Prefixes
 * `id` and `parentId` (so the parent links stay intact); leaves `payload`
 * untouched (payloads never reference repo ids).
 */
export function namespaceRepo(token: string, items: RepoItem[]): RepoItem[] {
    return items.map(item => ({
        ...item,
        id: nsId(token, item.id),
        ...(item.parentId !== undefined
            ? { parentId: nsId(token, item.parentId) }
            : {}),
    }));
}

/**
 * Inverse of {@link namespaceRepo}: take the merged repo, keep only the items
 * belonging to `token`, and strip the prefix back to bare ids. This is exactly
 * the shape originally loaded from (and saved back to) the workspace folder.
 */
export function denamespaceRepo(token: string, merged: RepoItem[]): RepoItem[] {
    const prefix = token + NS_SEP;
    return merged
        .filter(item => item.id.startsWith(prefix))
        .map(item => ({
            ...item,
            id: bareIdOf(item.id),
            ...(item.parentId !== undefined
                ? { parentId: bareIdOf(item.parentId) }
                : {}),
        }));
}

/** Namespace a workspace's pipelineData map (keys only; values are untouched). */
export function namespacePipelineData<T>(
    token: string,
    data: Record<string, T>,
): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [id, value] of Object.entries(data)) out[nsId(token, id)] = value;
    return out;
}

/**
 * Inverse: extract one workspace's pipelines from the merged map, with bare
 * keys. Values (node graphs, including their bare refs) pass through unchanged.
 */
export function denamespacePipelineData<T>(
    token: string,
    merged: Record<string, T>,
): Record<string, T> {
    const prefix = token + NS_SEP;
    const out: Record<string, T> = {};
    for (const [id, value] of Object.entries(merged)) {
        if (id.startsWith(prefix)) out[bareIdOf(id)] = value;
    }
    return out;
}

/** One workspace loaded from disk, ready to merge. */
export type LoadedWorkspace<P, J extends { id: string }> = {
    token: string;
    name: string;
    state: {
        repo?: RepoItem[];
        pipelineData?: Record<string, P>;
        jobs?: J[];
        activeJobId?: string;
    } | null;
};

/**
 * Merge several loaded workspaces into ONE namespaced repo + pipelineData +
 * open-tab (jobs) list. This is the pure core of the multi-workspace hydration
 * (App.tsx calls it after loading each workspace from disk). Behaviour:
 *  - each workspace's repo/pipelineData is namespaced by its token (no id
 *    collisions even when two folders ship identical bare ids);
 *  - the project-root node's display name is set to the workspace folder name;
 *  - open editor tabs (`jobs`) are restored per workspace and namespaced, but
 *    only kept if the pipeline they point at actually exists (stale tabs drop);
 *  - `firstActive` is the first workspace's saved activeJobId (namespaced), used
 *    as a fallback for which tab to focus.
 */
export function mergeWorkspaces<P, J extends { id: string }>(
    workspaces: Array<LoadedWorkspace<P, J>>,
): { repo: RepoItem[]; pipelineData: Record<string, P>; jobs: J[]; firstActive: string | null } {
    const repo: RepoItem[] = [];
    const pipelineData: Record<string, P> = {};
    const jobs: J[] = [];
    let firstActive: string | null = null;
    for (const ws of workspaces) {
        const repoItems = ws.state?.repo ?? [];
        const named = repoItems.map(it =>
            it.type === 'project' ? { ...it, name: ws.name } : it,
        );
        repo.push(...namespaceRepo(ws.token, named));
        const data = ws.state?.pipelineData ?? {};
        Object.assign(pipelineData, namespacePipelineData(ws.token, data));
        const wsJobs = ws.state?.jobs ?? [];
        for (const j of wsJobs) {
            const id = nsId(ws.token, j.id);
            if (pipelineData[id]) jobs.push({ ...j, id });
        }
        if (!firstActive && ws.state?.activeJobId) {
            firstActive = nsId(ws.token, ws.state.activeJobId);
        }
    }
    return { repo, pipelineData, jobs, firstActive };
}

// ----------------------------------------------------------------------------
// Save planners (pure). The App.tsx debounced save effects delegate the routing
// decision to these so the "which file in which folder, with which bare id"
// logic is unit-testable without a filesystem or React. Each returns a flat
// list of operations the effect then executes against the workspace API.
// ----------------------------------------------------------------------------

export type SaveOp =
    | { op: 'saveMetadata'; path: string; jobs: Array<Record<string, unknown>>; activeJobId?: string }
    | { op: 'saveRepository'; path: string; repo: RepoItem[] }
    | { op: 'savePayload'; path: string; itemType: string; bareId: string; payload: unknown }
    | { op: 'deletePayload'; path: string; itemType: string; bareId: string }
    | { op: 'savePipeline'; path: string; bareId: string; state: unknown }
    | { op: 'deletePipeline'; path: string; bareId: string };

const STRUCTURAL = new Set(['folder', 'project', 'pipeline']);

/**
 * Per-workspace metadata (`quilt.json`): each workspace gets ITS OWN open tabs
 * (bare ids) and only the workspace that owns the focused pipeline records the
 * activeJobId (bare). Mirrors the metadata save effect.
 */
export function planMetadataSaves<J extends { id: string }>(
    workspaces: WorkspaceRef[],
    jobs: J[],
    activeJobId: string,
): SaveOp[] {
    const activeTok = tokenOf(activeJobId);
    return workspaces.map(ws => ({
        op: 'saveMetadata' as const,
        path: ws.path,
        jobs: jobs
            .filter(j => tokenOf(j.id) === ws.token)
            .map(j => ({ ...j, id: bareIdOf(j.id) })),
        activeJobId: activeTok === ws.token ? bareIdOf(activeJobId) : undefined,
    }));
}

/**
 * `repository.json` (one per workspace, de-namespaced) plus payload writes for
 * non-structural items (connection/context/doc/routine) whose payload changed,
 * and payload deletes / pipeline-file deletes for items that disappeared.
 * Items are routed to their owning workspace by token; orphans (token not in
 * the open set) are skipped so a just-closed workspace is never written to.
 */
export function planRepoSaves(
    workspaces: WorkspaceRef[],
    repo: RepoItem[],
    prevRepo: RepoItem[],
): SaveOp[] {
    const ops: SaveOp[] = [];
    const wsByToken = new Map(workspaces.map(w => [w.token, w]));
    // 1. Each workspace's repository.json from its own de-namespaced slice.
    for (const ws of workspaces) {
        ops.push({ op: 'saveRepository', path: ws.path, repo: denamespaceRepo(ws.token, repo) });
    }
    const prevById = new Map(prevRepo.map(i => [i.id, i]));
    const currById = new Map(repo.map(i => [i.id, i]));
    // 2. Payload writes for changed non-structural items.
    for (const item of repo) {
        if (STRUCTURAL.has(item.type)) continue;
        const ws = wsByToken.get(tokenOf(item.id) ?? '');
        if (!ws) continue;
        const before = prevById.get(item.id);
        if ((!before || before.payload !== item.payload) && item.payload !== undefined) {
            ops.push({
                op: 'savePayload',
                path: ws.path,
                itemType: item.type,
                bareId: bareIdOf(item.id),
                payload: item.payload,
            });
        }
    }
    // 3. Deletes for items removed since the previous snapshot.
    for (const before of prevRepo) {
        if (currById.has(before.id)) continue;
        const ws = wsByToken.get(tokenOf(before.id) ?? '');
        if (!ws) continue;
        if (before.type === 'pipeline') {
            ops.push({ op: 'deletePipeline', path: ws.path, bareId: bareIdOf(before.id) });
        } else if (before.type !== 'folder' && before.type !== 'project') {
            ops.push({
                op: 'deletePayload',
                path: ws.path,
                itemType: before.type,
                bareId: bareIdOf(before.id),
            });
        }
    }
    return ops;
}

/**
 * Pipeline files: write each pipeline whose state object changed (by reference)
 * to its owning workspace, with the bare id. Routes by token; orphans skipped.
 */
export function planPipelineSaves<P>(
    workspaces: WorkspaceRef[],
    pipelineData: Record<string, P>,
    prevData: Record<string, P>,
): SaveOp[] {
    const ops: SaveOp[] = [];
    const wsByToken = new Map(workspaces.map(w => [w.token, w]));
    for (const [id, state] of Object.entries(pipelineData)) {
        if (prevData[id] === state) continue;
        const ws = wsByToken.get(tokenOf(id) ?? '');
        if (ws) ops.push({ op: 'savePipeline', path: ws.path, bareId: bareIdOf(id), state });
    }
    return ops;
}
