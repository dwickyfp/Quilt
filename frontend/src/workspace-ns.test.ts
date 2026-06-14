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
