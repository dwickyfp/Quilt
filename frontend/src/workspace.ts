import { isTauri } from './tauri-dialog';

const WORKSPACE_PATH_KEY = 'quilt:workspace-path';

// Workspace v1 (single file, everything in one blob). Kept for the
// migration path.
const V1_FILE = 'workspace.json';
// Workspace v2 (this commit).
const METADATA_FILE = 'quilt.json';
const REPOSITORY_FILE = 'repository.json';
const PIPELINES_DIR = 'pipelines';
const CONNECTIONS_DIR = 'connections';
const CONTEXTS_DIR = 'contexts';
const ROUTINES_DIR = 'routines';
const DOCS_DIR = 'docs';

const PAYLOAD_DIR_BY_TYPE: Record<string, string> = {
    pipeline: PIPELINES_DIR,
    connection: CONNECTIONS_DIR,
    context: CONTEXTS_DIR,
    routine: ROUTINES_DIR,
    doc: DOCS_DIR,
};

// Workspace-level JSON files that are NOT pipelines, so the root scan must
// never mistake them for an orphan pipeline.
const RESERVED_ROOT_FILES = new Set<string>([METADATA_FILE, REPOSITORY_FILE, V1_FILE]);

export type DiscoveredPipeline = {
    id: string;
    name: string;
};

/**
 * Reconcile the repository manifest against the pipeline files actually found
 * on disk. Returns the RepoItems for any pipeline that exists as a file but is
 * missing from `repository.json`, so the Project sidebar stays
 * disk-authoritative: a pipeline is visible even if the manifest never
 * recorded it (e.g. a file dropped into the folder by hand, restored from git,
 * or written by an external tool). Pure / DOM-free for unit testing; the
 * directory scan + file reads live in `loadV2`.
 */
export function reconcilePipelineItems(
    repo: Array<Record<string, unknown>>,
    discovered: DiscoveredPipeline[],
): Array<Record<string, unknown>> {
    const knownIds = new Set(
        repo.filter(i => i.type === 'pipeline').map(i => i.id as string),
    );
    // Newly-registered orphans need a parent folder. Prefer the standard
    // "pipelines" folder; fall back to the project root if the manifest is
    // missing it, so the item is never dangling/invisible.
    const parentId = repo.some(i => i.id === 'pipelines' && i.type === 'folder')
        ? 'pipelines'
        : 'root';
    const added: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const d of discovered) {
        if (knownIds.has(d.id) || seen.has(d.id)) continue;
        seen.add(d.id);
        added.push({ id: d.id, name: d.name, type: 'pipeline', parentId });
    }
    return added;
}

function pipelineDisplayName(content: Record<string, unknown>, id: string): string {
    const n = content.name;
    return typeof n === 'string' && n.trim() ? n.trim() : id;
}

function isPipelineShape(content: unknown): content is Record<string, unknown> {
    return (
        !!content &&
        typeof content === 'object' &&
        Array.isArray((content as Record<string, unknown>).nodes)
    );
}

export type WorkspaceState = {
    version: number;
    pipelineData?: Record<string, unknown>;
    repo?: unknown[];
    jobs?: unknown[];
    activeJobId?: string;
};

export function isInTauri(): boolean {
    return isTauri();
}

export function getWorkspacePath(): string | null {
    try {
        return localStorage.getItem(WORKSPACE_PATH_KEY);
    } catch {
        return null;
    }
}

export function setWorkspacePath(path: string): void {
    try {
        localStorage.setItem(WORKSPACE_PATH_KEY, path);
    } catch {
        /* ignore */
    }
}

export function clearWorkspacePath(): void {
    try {
        localStorage.removeItem(WORKSPACE_PATH_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Derive the display name (last path segment) of a workspace folder from its
 * absolute path. Handles both POSIX and Windows separators and trailing
 * slashes. Returns null for an empty/nullish path. Pure for unit testing.
 */
export function folderNameFromPath(path: string | null | undefined): string | null {
    if (!path) return null;
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
}

function joinPath(dir: string, ...parts: string[]): string {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return [dir.replace(/[/\\]+$/, ''), ...parts].join(sep);
}

export async function pickWorkspaceDirectory(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({
            directory: true,
            multiple: false,
            title: 'Choose Quilt workspace folder',
        });
        return typeof result === 'string' ? result : null;
    } catch (err) {
        console.error('Workspace picker failed', err);
        return null;
    }
}

type FsLib = typeof import('@tauri-apps/plugin-fs');

async function fs(): Promise<FsLib> {
    return await import('@tauri-apps/plugin-fs');
}

// Encrypt a connection payload's sensitive fields (password, tokens, keys) via
// the desktop crypto command, which uses a per-workspace key under
// `.quilt/keys/`. Encryption is mandatory: on any failure we throw rather than
// fall back to the plaintext payload, so a transient key/backend error can
// never silently persist secrets in cleartext. `${...}` placeholders and
// non-secret fields are left untouched by the command.
async function encryptConnectionPayload(workspace: string, payload: unknown): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core');
    const enc = await invoke<string>('connection_encrypt_payload', {
        workspace,
        payloadJson: JSON.stringify(payload),
    });
    return JSON.parse(enc);
}

async function decryptConnectionPayload(workspace: string, payload: unknown): Promise<unknown> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dec = await invoke<string>('connection_decrypt_payload', {
            workspace,
            payloadJson: JSON.stringify(payload),
        });
        return JSON.parse(dec);
    } catch (err) {
        // Decrypt is allowed to fail open: a missing key returns the payload
        // unchanged (legacy plaintext still loads). Log without the raw error
        // object, which could embed payload fragments.
        console.error('decrypt connection failed');
        return payload;
    }
}

async function ensureDir(path: string): Promise<void> {
    const { exists, mkdir } = await fs();
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
}

async function writeJson(path: string, value: unknown): Promise<void> {
    const { writeTextFile } = await fs();
    await writeTextFile(path, JSON.stringify(value, null, 2));
}

async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
    const { exists, readTextFile } = await fs();
    if (!(await exists(path))) return null;
    const content = await readTextFile(path);
    return JSON.parse(content) as T;
}

async function readDirEntries(path: string): Promise<string[]> {
    try {
        const { exists, readDir } = await fs();
        if (!(await exists(path))) return [];
        const entries = await readDir(path);
        return entries
            .filter(e => e.isFile && e.name.endsWith('.json'))
            .map(e => e.name);
    } catch {
        return [];
    }
}

// ---- Load (with migration) ---------------------------------------------

/**
 * Load the workspace from disk. Reads the v2 multi-file layout if it
 * exists; otherwise tries to migrate a v1 workspace.json on the fly.
 * Returns `null` only if there's nothing to load (fresh workspace) or
 * we're running in browser mode.
 */
export async function loadWorkspace(path: string): Promise<WorkspaceState | null> {
    if (!isTauri()) return null;
    try {
        const v2 = await loadV2(path);
        if (v2) return v2;
        const v1 = await loadAndMigrateV1(path);
        if (v1) return v1;
        return null;
    } catch (err) {
        console.error('Failed to load workspace', err);
        return null;
    }
}

async function loadV2(path: string): Promise<WorkspaceState | null> {
    const meta = await readJsonIfExists<{
        version?: number;
        jobs?: unknown[];
        activeJobId?: string;
    }>(joinPath(path, METADATA_FILE));
    if (!meta) return null;

    const repo = (await readJsonIfExists<Array<Record<string, unknown>>>(
        joinPath(path, REPOSITORY_FILE),
    )) ?? [];

    // Hydrate payloads for each repo item that lives in its own file.
    for (const item of repo) {
        const itype = typeof item.type === 'string' ? item.type : '';
        const dir = PAYLOAD_DIR_BY_TYPE[itype];
        if (!dir || itype === 'pipeline' || itype === 'folder' || itype === 'project') continue;
        const file = joinPath(path, dir, `${item.id}.json`);
        const payload = await readJsonIfExists(file);
        if (payload !== null) {
            (item as { payload: unknown }).payload =
                itype === 'connection' ? await decryptConnectionPayload(path, payload) : payload;
        }
    }

    // Load each pipeline file referenced in the repo.
    const pipelineData: Record<string, unknown> = {};
    const loadedIds = new Set<string>();
    for (const item of repo) {
        if (item.type !== 'pipeline') continue;
        const id = item.id as string;
        const file = joinPath(path, PIPELINES_DIR, `${id}.json`);
        const pipeline = await readJsonIfExists(file);
        if (pipeline) {
            pipelineData[id] = pipeline;
            loadedIds.add(id);
        }
    }

    // Disk-authoritative reconciliation: discover pipeline files that exist on
    // disk but aren't referenced by the manifest, so the Project sidebar shows
    // them instead of silently dropping them. This is what makes switching to
    // an existing workspace auto-load its pipelines even if repository.json is
    // stale, was hand-edited, or the file was restored from git / written by an
    // external tool.
    const discovered: DiscoveredPipeline[] = [];

    // (1) Orphans inside the canonical pipelines/ dir.
    for (const fileName of await readDirEntries(joinPath(path, PIPELINES_DIR))) {
        const id = fileName.replace(/\.json$/i, '');
        if (loadedIds.has(id)) continue;
        const content = await readJsonIfExists(joinPath(path, PIPELINES_DIR, fileName));
        if (!isPipelineShape(content)) continue;
        pipelineData[id] = content;
        loadedIds.add(id);
        discovered.push({ id, name: pipelineDisplayName(content, id) });
    }

    // (2) Misplaced / legacy pipeline files sitting at the workspace root.
    // Relocate them into pipelines/ (best-effort) so future saves stay in the
    // canonical layout; the pipeline is loaded regardless of whether the move
    // succeeds.
    for (const fileName of await readDirEntries(path)) {
        if (RESERVED_ROOT_FILES.has(fileName)) continue;
        const id = fileName.replace(/\.json$/i, '');
        if (loadedIds.has(id)) continue;
        const content = await readJsonIfExists(joinPath(path, fileName));
        if (!isPipelineShape(content)) continue;
        pipelineData[id] = content;
        loadedIds.add(id);
        discovered.push({ id, name: pipelineDisplayName(content, id) });
        try {
            await savePipelineFile(path, id, content);
            const { exists, remove } = await fs();
            if (await exists(joinPath(path, PIPELINES_DIR, `${id}.json`))) {
                await remove(joinPath(path, fileName));
            }
        } catch (err) {
            console.warn('Could not relocate root pipeline file', fileName, err);
        }
    }

    // Fold discovered orphans into the manifest so they render in the sidebar
    // and the app's save effect heals repository.json on the next write.
    const added = reconcilePipelineItems(repo, discovered);
    if (added.length) repo.push(...added);

    return {
        version: meta.version ?? 2,
        jobs: meta.jobs,
        activeJobId: meta.activeJobId,
        repo,
        pipelineData,
    };
}

async function loadAndMigrateV1(path: string): Promise<WorkspaceState | null> {
    const v1Path = joinPath(path, V1_FILE);
    const v1 = await readJsonIfExists<WorkspaceState>(v1Path);
    if (!v1) return null;
    // Write v2 files alongside; archive v1.
    try {
        await saveAll(path, v1);
        const { writeTextFile, exists, remove } = await fs();
        const backup = joinPath(path, `${V1_FILE}.v1.bak`);
        await writeTextFile(backup, JSON.stringify(v1, null, 2));
        if (await exists(v1Path)) {
            try {
                await remove(v1Path);
            } catch {
                /* leave it if we can't remove */
            }
        }
        console.info('Migrated workspace from v1 -> v2');
    } catch (err) {
        console.warn('Migration failed; loading v1 in-memory only', err);
    }
    return v1;
}

// ---- Save (granular) ---------------------------------------------------

/**
 * Write the metadata file only - cheap; safe to call on every change.
 */
export async function saveMetadata(
    path: string,
    metadata: { jobs?: unknown; activeJobId?: string },
): Promise<void> {
    if (!isTauri()) return;
    try {
        await ensureDir(path);
        await writeJson(joinPath(path, METADATA_FILE), {
            version: 2,
            ...metadata,
        });
    } catch (err) {
        console.error('saveMetadata failed', err);
    }
}

/**
 * Write the repository tree (id, name, type, parentId, icon). Payloads
 * live in their own per-type directories.
 */
export async function saveRepository(
    path: string,
    items: Array<Record<string, unknown>>,
): Promise<void> {
    if (!isTauri()) return;
    try {
        await ensureDir(path);
        const stripped = items.map(i => {
            const { payload, ...rest } = i as Record<string, unknown> & { payload?: unknown };
            void payload;
            return rest;
        });
        await writeJson(joinPath(path, REPOSITORY_FILE), stripped);
    } catch (err) {
        console.error('saveRepository failed', err);
    }
}

export async function savePipelineFile(
    path: string,
    pipelineId: string,
    pipeline: unknown,
): Promise<void> {
    if (!isTauri()) return;
    try {
        const dir = joinPath(path, PIPELINES_DIR);
        await ensureDir(dir);
        await writeJson(joinPath(dir, `${pipelineId}.json`), pipeline);
    } catch (err) {
        console.error('savePipelineFile failed', err);
    }
}

export async function saveItemPayload(
    path: string,
    itemType: string,
    itemId: string,
    payload: unknown,
): Promise<void> {
    if (!isTauri()) return;
    const dir = PAYLOAD_DIR_BY_TYPE[itemType];
    if (!dir) return;
    // Encrypt connection payloads first. If encryption throws we must NOT fall
    // through to writing the plaintext payload, so do it before opening/writing
    // the file and bail out (without writing) on failure.
    let toWrite = payload;
    if (itemType === 'connection') {
        try {
            toWrite = await encryptConnectionPayload(path, payload);
        } catch {
            // Fail closed: never persist an unencrypted connection. Log a
            // static message (not the raw error, which could embed secrets).
            console.error('connection encryption failed; not saving to avoid writing plaintext secrets');
            return;
        }
    }
    try {
        const folder = joinPath(path, dir);
        await ensureDir(folder);
        await writeJson(joinPath(folder, `${itemId}.json`), toWrite);
    } catch (err) {
        console.error('saveItemPayload failed', err);
    }
}

export async function deletePipelineFile(
    path: string,
    pipelineId: string,
): Promise<void> {
    if (!isTauri()) return;
    try {
        const { exists, remove } = await fs();
        const file = joinPath(path, PIPELINES_DIR, `${pipelineId}.json`);
        if (await exists(file)) await remove(file);
    } catch (err) {
        console.warn('deletePipelineFile failed', err);
    }
}

export async function deleteItemPayload(
    path: string,
    itemType: string,
    itemId: string,
): Promise<void> {
    if (!isTauri()) return;
    const dir = PAYLOAD_DIR_BY_TYPE[itemType];
    if (!dir) return;
    try {
        const { exists, remove } = await fs();
        const file = joinPath(path, dir, `${itemId}.json`);
        if (await exists(file)) await remove(file);
    } catch (err) {
        console.warn('deleteItemPayload failed', err);
    }
}

/**
 * Convenience: write the full workspace state in v2 layout. Used by
 * migration and as a fallback.
 */
export async function saveAll(path: string, state: WorkspaceState): Promise<void> {
    if (!isTauri()) return;
    await ensureDir(path);
    await saveMetadata(path, {
        jobs: state.jobs,
        activeJobId: state.activeJobId,
    });
    if (Array.isArray(state.repo)) {
        await saveRepository(path, state.repo as Array<Record<string, unknown>>);
        for (const item of state.repo as Array<Record<string, unknown>>) {
            const itype = typeof item.type === 'string' ? item.type : '';
            if (itype === 'pipeline' || itype === 'folder' || itype === 'project') continue;
            const payload = (item as { payload?: unknown }).payload;
            if (payload !== undefined) {
                await saveItemPayload(path, itype, item.id as string, payload);
            }
        }
    }
    if (state.pipelineData) {
        for (const [id, pipeline] of Object.entries(state.pipelineData)) {
            await savePipelineFile(path, id, pipeline);
        }
    }
}

// Kept for backwards compatibility - callers that just want to write
// everything in one shot can still call saveWorkspace().
export const saveWorkspace = saveAll;

// Expose for cleanup utilities.
export async function listPipelineFiles(path: string): Promise<string[]> {
    return readDirEntries(joinPath(path, PIPELINES_DIR));
}
