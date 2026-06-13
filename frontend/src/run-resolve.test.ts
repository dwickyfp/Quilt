import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { expandComponentsForRun } from './run-resolve';
import type { QuiltNodeData } from './pipeline-types';
import type { SavedComponent } from './workflow-ui/component-expand';

const clean: SavedComponent = {
    id: 'cmp.clean',
    label: 'Clean',
    def: {
        nodes: [
            { id: 'f', data: { componentId: 'xf.filter', properties: { predicate: 'amount > 0' } } },
            { id: 'd', data: { componentId: 'xf.derive', properties: { expr: 'amount * 2' } } },
        ],
        edges: [{ id: 'fd', source: 'f', target: 'd' }],
        inputs: [{ node: 'f' }],
        outputs: [{ node: 'd' }],
        params: [{ key: 'minAmount', node: 'f', prop: 'predicate' }],
    },
};

const n = (id: string, componentId: string, properties: Record<string, unknown> = {}): Node<QuiltNodeData> => ({
    id,
    type: 'transform',
    position: { x: 10, y: 20 },
    data: { label: id, componentId, properties },
});

const e = (id: string, source: string, target: string): Edge => ({ id, source, target });

describe('expandComponentsForRun (run-path adapter)', () => {
    it('returns the graph untouched when there are no saved components', () => {
        const nodes = [n('s', 'src.csv'), n('k', 'snk.csv')];
        const edges = [e('e1', 's', 'k')];
        const out = expandComponentsForRun(nodes, edges, []);
        expect(out.nodes).toBe(nodes);
        expect(out.edges).toBe(edges);
    });

    it('returns the graph untouched when no instance references a saved component', () => {
        const nodes = [n('s', 'src.csv'), n('k', 'snk.csv')];
        const edges = [e('e1', 's', 'k')];
        const out = expandComponentsForRun(nodes, edges, [clean]);
        // identity: nothing matched cmp.clean, so originals are handed back
        expect(out.nodes).toBe(nodes);
    });

    it('produces a flat, engine-ready graph with no surviving cmp.* nodes', () => {
        const nodes = [n('s', 'src.csv'), n('c1', 'cmp.clean'), n('k', 'snk.csv')];
        const edges = [e('e1', 's', 'c1'), e('e2', 'c1', 'k')];
        const out = expandComponentsForRun(nodes, edges, [clean]);

        // No cmp.* node remains.
        expect(out.nodes.every(node => !node.data.componentId?.startsWith('cmp.'))).toBe(true);
        // Every node has a defined position + type (engine requires position).
        for (const node of out.nodes) {
            expect(node.position).toBeDefined();
            expect(typeof node.position.x).toBe('number');
            expect(node.type).toBeTruthy();
        }
        // Inner nodes inherit the instance's canvas position.
        const inner = out.nodes.find(node => node.id === 'c1__f');
        expect(inner?.position).toEqual({ x: 10, y: 20 });
        expect(inner?.type).toBe('transform');
    });

    it('rewires host edges across the expanded boundary', () => {
        const nodes = [n('s', 'src.csv'), n('c1', 'cmp.clean'), n('k', 'snk.csv')];
        const edges = [e('e1', 's', 'c1'), e('e2', 'c1', 'k')];
        const out = expandComponentsForRun(nodes, edges, [clean]);
        expect(out.edges.some(edge => edge.source === 's' && edge.target === 'c1__f')).toBe(true);
        expect(out.edges.some(edge => edge.source === 'c1__d' && edge.target === 'k')).toBe(true);
        expect(out.edges.every(edge => edge.source !== 'c1' && edge.target !== 'c1')).toBe(true);
    });

    it('applies an instance param override to the inner node prop', () => {
        const nodes = [
            n('s', 'src.csv'),
            n('c1', 'cmp.clean', { minAmount: 'amount > 500' }),
            n('k', 'snk.csv'),
        ];
        const edges = [e('e1', 's', 'c1'), e('e2', 'c1', 'k')];
        const out = expandComponentsForRun(nodes, edges, [clean]);
        const f = out.nodes.find(node => node.id === 'c1__f');
        expect((f?.data.properties as Record<string, unknown>)?.predicate).toBe('amount > 500');
    });

    it('preserves original (non-instance) nodes by reference', () => {
        const nodes = [n('s', 'src.csv'), n('c1', 'cmp.clean'), n('k', 'snk.csv')];
        const edges = [e('e1', 's', 'c1'), e('e2', 'c1', 'k')];
        const out = expandComponentsForRun(nodes, edges, [clean]);
        const s = out.nodes.find(node => node.id === 's');
        expect(s).toBe(nodes[0]); // same reference, untouched
    });
});
