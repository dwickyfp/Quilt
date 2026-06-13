import { describe, it, expect } from 'vitest';
import {
    computeCacheKeys,
    invalidatedNodes,
    staleNodes,
    type CacheNode,
    type CacheEdge,
} from './stage-cache';

const node = (id: string, componentId: string, properties: Record<string, unknown> = {}): CacheNode => ({
    id,
    data: { componentId, properties },
});
const edge = (source: string, target: string): CacheEdge => ({ source, target });

describe('computeCacheKeys', () => {
    it('is stable across recomputation for the same graph', () => {
        const nodes = [node('s', 'src.csv', { path: '/a.csv' }), node('f', 'xf.filter', { expr: 'x>1' })];
        const edges = [edge('s', 'f')];
        const k1 = computeCacheKeys(nodes, edges);
        const k2 = computeCacheKeys(nodes, edges);
        expect(k1.get('s')).toBe(k2.get('s'));
        expect(k1.get('f')).toBe(k2.get('f'));
    });

    it('changes a node key when its props change', () => {
        const base = [node('s', 'src.csv', { path: '/a.csv' })];
        const changed = [node('s', 'src.csv', { path: '/b.csv' })];
        expect(computeCacheKeys(base, []).get('s')).not.toBe(computeCacheKeys(changed, []).get('s'));
    });

    it('is insensitive to prop key order', () => {
        const a = [node('s', 'src.csv', { path: '/a.csv', hasHeader: true })];
        const b = [node('s', 'src.csv', { hasHeader: true, path: '/a.csv' })];
        expect(computeCacheKeys(a, []).get('s')).toBe(computeCacheKeys(b, []).get('s'));
    });

    it('propagates an upstream change into downstream keys', () => {
        const nodes1 = [node('s', 'src.csv', { path: '/a.csv' }), node('f', 'xf.filter', { expr: 'x>1' })];
        const nodes2 = [node('s', 'src.csv', { path: '/b.csv' }), node('f', 'xf.filter', { expr: 'x>1' })];
        const edges = [edge('s', 'f')];
        const k1 = computeCacheKeys(nodes1, edges);
        const k2 = computeCacheKeys(nodes2, edges);
        // f's config is unchanged, but its upstream changed -> its key must change.
        expect(k1.get('f')).not.toBe(k2.get('f'));
    });

    it('does not change a sibling whose upstream is untouched', () => {
        const nodes1 = [
            node('s1', 'src.csv', { path: '/a.csv' }),
            node('s2', 'src.csv', { path: '/x.csv' }),
            node('f1', 'xf.filter', { expr: 'x>1' }),
            node('f2', 'xf.filter', { expr: 'y>1' }),
        ];
        const nodes2 = [
            node('s1', 'src.csv', { path: '/CHANGED.csv' }),
            node('s2', 'src.csv', { path: '/x.csv' }),
            node('f1', 'xf.filter', { expr: 'x>1' }),
            node('f2', 'xf.filter', { expr: 'y>1' }),
        ];
        const edges = [edge('s1', 'f1'), edge('s2', 'f2')];
        const k1 = computeCacheKeys(nodes1, edges);
        const k2 = computeCacheKeys(nodes2, edges);
        expect(k1.get('f1')).not.toBe(k2.get('f1')); // downstream of changed s1
        expect(k1.get('f2')).toBe(k2.get('f2')); // independent branch unaffected
    });
});

describe('invalidatedNodes', () => {
    it('returns the edited node plus all transitive downstream nodes', () => {
        // a -> b -> c ; d -> c (c has two parents)
        const edges = [edge('a', 'b'), edge('b', 'c'), edge('d', 'c')];
        const out = invalidatedNodes(['a', 'b', 'c', 'd'], edges, 'a');
        expect([...out].sort()).toEqual(['a', 'b', 'c']);
        expect(out.has('d')).toBe(false);
    });

    it('handles a leaf node (only itself)', () => {
        const edges = [edge('a', 'b')];
        expect([...invalidatedNodes(['a', 'b'], edges, 'b')].sort()).toEqual(['b']);
    });
});

describe('staleNodes', () => {
    it('flags nodes whose current key differs from the last-run key', () => {
        const prev = new Map([['s', 'k1'], ['f', 'k2']]);
        const cur = new Map([['s', 'k1'], ['f', 'k2_CHANGED']]);
        expect([...staleNodes(cur, prev)].sort()).toEqual(['f']);
    });

    it('treats a never-run node (no prev key) as stale', () => {
        const prev = new Map([['s', 'k1']]);
        const cur = new Map([['s', 'k1'], ['new', 'k9']]);
        expect([...staleNodes(cur, prev)]).toEqual(['new']);
    });
});
