import { describe, it, expect } from 'vitest';
import type { RepoItem } from './repo-types';
import {
    workspaceToken,
    nsId,
    tokenOf,
    bareIdOf,
    namespaceRepo,
    denamespaceRepo,
    namespacePipelineData,
    denamespacePipelineData,
    mergeWorkspaces,
    NS_SEP,
} from './workspace-ns';

const repoA = (): RepoItem[] => [
    { id: 'root', name: 'WS A', type: 'project' },
    { id: 'pipelines', name: 'Pipelines', type: 'folder', parentId: 'root' },
    { id: 'j1', name: 'orders_etl', type: 'pipeline', parentId: 'pipelines' },
    {
        id: 'c1',
        name: 'pg',
        type: 'connection',
        parentId: 'connections',
        payload: { kind: 'postgres', host: 'localhost', connectionRef: 'c1' } as never,
    },
];

describe('workspaceToken', () => {
    it('is deterministic for a given path', () => {
        expect(workspaceToken('/a/b/ws')).toBe(workspaceToken('/a/b/ws'));
    });

    it('differs for different paths', () => {
        expect(workspaceToken('/a/ws')).not.toBe(workspaceToken('/b/ws'));
    });

    it('never contains the namespace separator', () => {
        expect(workspaceToken('/some/deep/path/quilt-samples')).not.toContain(NS_SEP);
    });
});

describe('id helpers', () => {
    it('nsId / tokenOf / bareIdOf round-trip', () => {
        const t = workspaceToken('/x/ws');
        const id = nsId(t, 'j1');
        expect(tokenOf(id)).toBe(t);
        expect(bareIdOf(id)).toBe('j1');
    });

    it('tokenOf returns null for a bare id', () => {
        expect(tokenOf('j1')).toBeNull();
    });

    it('bareIdOf is identity for a bare id', () => {
        expect(bareIdOf('j1')).toBe('j1');
    });
});

describe('namespaceRepo / denamespaceRepo', () => {
    it('round-trips back to the original repo', () => {
        const t = workspaceToken('/x/ws');
        const out = denamespaceRepo(t, namespaceRepo(t, repoA()));
        expect(out).toEqual(repoA());
    });

    it('prefixes id and parentId', () => {
        const t = workspaceToken('/x/ws');
        const ns = namespaceRepo(t, repoA());
        const j1 = ns.find(i => i.id === nsId(t, 'j1'))!;
        expect(j1.parentId).toBe(nsId(t, 'pipelines'));
    });

    it('leaves payload (and its refs) untouched', () => {
        const t = workspaceToken('/x/ws');
        const ns = namespaceRepo(t, repoA());
        const conn = ns.find(i => i.type === 'connection')!;
        // The connectionRef inside the payload must NOT be namespaced.
        expect((conn.payload as unknown as { connectionRef: string }).connectionRef).toBe('c1');
    });

    it('keeps two workspaces with identical bare ids distinct', () => {
        const ta = workspaceToken('/a/ws');
        const tb = workspaceToken('/b/ws');
        const merged = [...namespaceRepo(ta, repoA()), ...namespaceRepo(tb, repoA())];
        const ids = merged.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length); // no collisions
        // Each workspace extracts back to exactly its own items.
        expect(denamespaceRepo(ta, merged)).toEqual(repoA());
        expect(denamespaceRepo(tb, merged)).toEqual(repoA());
    });

    it('two folders with the SAME basename get distinct tokens (path-derived)', () => {
        // User scenario: open ~/work/quilt-samples and ~/archive/quilt-samples.
        // The display name (basename) is identical, but the token is derived
        // from the full path, so ids stay distinct and runtime is unaffected.
        const ta = workspaceToken('/home/u/work/quilt-samples');
        const tb = workspaceToken('/home/u/archive/quilt-samples');
        expect(ta).not.toBe(tb);
        const merged = [...namespaceRepo(ta, repoA()), ...namespaceRepo(tb, repoA())];
        const ids = merged.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length); // no collision despite same name
        // Closing one (filter by token) leaves the other fully intact.
        const afterCloseA = merged.filter(i => tokenOf(i.id) !== ta);
        expect(denamespaceRepo(tb, afterCloseA)).toEqual(repoA());
        expect(afterCloseA.some(i => tokenOf(i.id) === ta)).toBe(false);
    });
});

describe('namespacePipelineData / denamespacePipelineData', () => {
    const data = () => ({
        j1: { nodes: [{ id: 'n1', data: { properties: { connectionRef: 'c1' } } }], edges: [] },
        j2: { nodes: [], edges: [] },
    });

    it('round-trips keys and preserves values by reference', () => {
        const t = workspaceToken('/x/ws');
        const original = data();
        const ns = namespacePipelineData(t, original);
        expect(Object.keys(ns)).toEqual([nsId(t, 'j1'), nsId(t, 'j2')]);
        // Value object identity preserved (no deep clone of node graphs / refs).
        expect(ns[nsId(t, 'j1')]).toBe(original.j1);
        const out = denamespacePipelineData(t, ns);
        expect(out).toEqual(original);
    });

    it('extracts only the requested workspace from a merged map', () => {
        const ta = workspaceToken('/a/ws');
        const tb = workspaceToken('/b/ws');
        const merged = {
            ...namespacePipelineData(ta, data()),
            ...namespacePipelineData(tb, { j1: { nodes: [], edges: [] } }),
        };
        expect(Object.keys(denamespacePipelineData(ta, merged))).toEqual(['j1', 'j2']);
        expect(Object.keys(denamespacePipelineData(tb, merged))).toEqual(['j1']);
    });
});

describe('mergeWorkspaces', () => {
    type P = { nodes: unknown[]; edges: unknown[] };
    type J = { id: string; name: string; dirty: boolean };

    const loaded = (path: string, name: string, opts?: { jobs?: J[]; activeJobId?: string }) => ({
        token: workspaceToken(path),
        name,
        state: {
            repo: [
                { id: 'root', name: 'ignored', type: 'project' as const },
                { id: 'pipelines', name: 'Pipelines', type: 'folder' as const, parentId: 'root' },
                { id: 'j1', name: 'p1', type: 'pipeline' as const, parentId: 'pipelines' },
                { id: 'j2', name: 'p2', type: 'pipeline' as const, parentId: 'pipelines' },
            ],
            pipelineData: {
                j1: { nodes: [], edges: [] } as P,
                j2: { nodes: [], edges: [] } as P,
            },
            jobs: opts?.jobs,
            activeJobId: opts?.activeJobId,
        },
    });

    it('namespaces every workspace and renames each project root to the folder name', () => {
        const wsA = loaded('/u/work/alpha', 'alpha');
        const wsB = loaded('/u/work/beta', 'beta');
        const { repo, pipelineData } = mergeWorkspaces<P, J>([wsA, wsB]);
        // No id collisions across the two workspaces.
        const ids = repo.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        // Each project root carries its own folder name (not the on-disk name).
        const projects = repo.filter(i => i.type === 'project');
        expect(projects.map(p => p.name).sort()).toEqual(['alpha', 'beta']);
        // pipelineData keyed by namespaced ids.
        expect(pipelineData[nsId(wsA.token, 'j1')]).toBeDefined();
        expect(pipelineData[nsId(wsB.token, 'j2')]).toBeDefined();
    });

    it('handles two workspaces with the SAME folder name (distinct tokens)', () => {
        const wsA = loaded('/u/work/quilt-samples', 'quilt-samples');
        const wsB = loaded('/u/archive/quilt-samples', 'quilt-samples');
        expect(wsA.token).not.toBe(wsB.token);
        const { repo, pipelineData } = mergeWorkspaces<P, J>([wsA, wsB]);
        const ids = repo.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length); // no collision despite same name
        // Both roots show the same label — that's allowed — but ids differ.
        expect(repo.filter(i => i.type === 'project').map(p => p.name)).toEqual([
            'quilt-samples',
            'quilt-samples',
        ]);
        expect(Object.keys(pipelineData).length).toBe(4);
        // De-namespacing each token recovers exactly that workspace's pipelines.
        expect(Object.keys(denamespacePipelineData(wsA.token, pipelineData)).sort()).toEqual([
            'j1',
            'j2',
        ]);
    });

    it('restores open tabs per workspace, namespaced, and drops stale tabs', () => {
        const wsA = loaded('/u/work/alpha', 'alpha', {
            jobs: [
                { id: 'j1', name: 'p1', dirty: false },
                { id: 'ghost', name: 'deleted', dirty: false }, // pipeline no longer exists
            ],
            activeJobId: 'j1',
        });
        const wsB = loaded('/u/work/beta', 'beta', {
            jobs: [{ id: 'j2', name: 'p2', dirty: true }],
        });
        const { jobs, firstActive } = mergeWorkspaces<P, J>([wsA, wsB]);
        // ghost tab dropped (its pipeline isn't in pipelineData).
        expect(jobs.map(j => j.id)).toEqual([nsId(wsA.token, 'j1'), nsId(wsB.token, 'j2')]);
        // dirty flag preserved through the merge.
        expect(jobs.find(j => j.id === nsId(wsB.token, 'j2'))?.dirty).toBe(true);
        // firstActive is the first workspace's saved active tab, namespaced.
        expect(firstActive).toBe(nsId(wsA.token, 'j1'));
    });

    it('tolerates a workspace that failed to load (null state)', () => {
        const wsA = loaded('/u/work/alpha', 'alpha');
        const broken = { token: workspaceToken('/u/work/broken'), name: 'broken', state: null };
        const { repo, pipelineData, jobs } = mergeWorkspaces<P, J>([wsA, broken]);
        // Only the healthy workspace contributes; no throw.
        expect(repo.filter(i => i.type === 'project').map(p => p.name)).toEqual(['alpha']);
        expect(Object.keys(pipelineData).length).toBe(2);
        expect(jobs).toEqual([]);
    });

    it('returns empty structures for no workspaces', () => {
        expect(mergeWorkspaces<P, J>([])).toEqual({
            repo: [],
            pipelineData: {},
            jobs: [],
            firstActive: null,
        });
    });
});
