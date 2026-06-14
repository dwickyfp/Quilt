import { describe, it, expect } from 'vitest';
import { layoutTree, type LayoutNode, type LayoutEdge } from './tree-layout';

const node = (id: string, width = 220, height = 80): LayoutNode => ({
    id,
    measured: { width, height },
});
const edge = (source: string, target: string): LayoutEdge => ({
    id: `${source}->${target}`,
    source,
    target,
});

describe('layoutTree', () => {
    it('returns an empty map for an empty graph', () => {
        expect(layoutTree([], []).size).toBe(0);
    });

    it('lays a chain left-to-right on a single rank line', () => {
        const nodes = [node('a'), node('b'), node('c')];
        const edges = [edge('a', 'b'), edge('b', 'c')];
        const pos = layoutTree(nodes, edges);

        const a = pos.get('a')!;
        const b = pos.get('b')!;
        const c = pos.get('c')!;

        // x increases downstream (LR flow)
        expect(b.x).toBeGreaterThan(a.x);
        expect(c.x).toBeGreaterThan(b.x);
        // chain stays on one horizontal line
        expect(a.y).toBeCloseTo(b.y, 5);
        expect(b.y).toBeCloseTo(c.y, 5);
    });

    it('branches up and down without overlap', () => {
        const nodes = [node('a'), node('b'), node('c')];
        const edges = [edge('a', 'b'), edge('a', 'c')];
        const pos = layoutTree(nodes, edges);

        const a = pos.get('a')!;
        const b = pos.get('b')!;
        const c = pos.get('c')!;

        // children share a downstream rank (same x), spread vertically
        expect(b.x).toBeGreaterThan(a.x);
        expect(c.x).toBeGreaterThan(a.x);
        expect(b.x).toBeCloseTo(c.x, 5);
        expect(Math.abs(b.y - c.y)).toBeGreaterThan(0);
    });

    it('places isolated nodes at unique positions', () => {
        const nodes = [node('a'), node('b'), node('iso')];
        const edges = [edge('a', 'b')];
        const pos = layoutTree(nodes, edges);

        expect(pos.has('iso')).toBe(true);
        const keys = ['a', 'b', 'iso'].map(id => {
            const p = pos.get(id)!;
            return `${p.x},${p.y}`;
        });
        expect(new Set(keys).size).toBe(3);
    });

    it('falls back to default dimensions when measured is absent', () => {
        const pos = layoutTree([{ id: 'a' }, { id: 'b' }], [edge('a', 'b')]);
        expect(pos.has('a')).toBe(true);
        expect(pos.has('b')).toBe(true);
        expect(pos.get('b')!.x).toBeGreaterThan(pos.get('a')!.x);
    });
});
