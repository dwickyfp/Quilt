import { describe, it, expect } from 'vitest';
import { expandComponents, type HostNode, type HostEdge, type SavedComponent } from './component-expand';

// A saved component: filter -> derive, one input (filter), one output (derive).
const filterDerive: SavedComponent = {
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

const host = (
    nodes: HostNode[],
    edges: HostEdge[],
): { nodes: HostNode[]; edges: HostEdge[] } => ({ nodes, edges });

describe('expandComponents', () => {
    it('leaves a graph with no component instances untouched', () => {
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                { id: 'k', data: { componentId: 'snk.csv', properties: {} } },
            ],
            [{ id: 'e', source: 's', target: 'k' }],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        expect(out.nodes).toHaveLength(2);
        expect(out.edges).toHaveLength(1);
        expect(out.nodes.map(n => n.id).sort()).toEqual(['k', 's']);
    });

    it('expands an instance into namespaced inner nodes + edges', () => {
        // src -> [cmp.clean instance "c1"] -> sink
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                { id: 'c1', data: { componentId: 'cmp.clean', properties: {} } },
                { id: 'k', data: { componentId: 'snk.csv', properties: {} } },
            ],
            [
                { id: 'e1', source: 's', target: 'c1' },
                { id: 'e2', source: 'c1', target: 'k' },
            ],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        // instance replaced by 2 inner nodes; s + k remain => 4 nodes.
        expect(out.nodes).toHaveLength(4);
        const ids = out.nodes.map(n => n.id).sort();
        expect(ids).toContain('s');
        expect(ids).toContain('k');
        expect(ids).toContain('c1__f');
        expect(ids).toContain('c1__d');
        // no node still carries the cmp.* component id.
        expect(out.nodes.every(n => !n.data.componentId?.startsWith('cmp.'))).toBe(true);
    });

    it('rewires the inbound host edge to the input port, outbound to the output port', () => {
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                { id: 'c1', data: { componentId: 'cmp.clean', properties: {} } },
                { id: 'k', data: { componentId: 'snk.csv', properties: {} } },
            ],
            [
                { id: 'e1', source: 's', target: 'c1' },
                { id: 'e2', source: 'c1', target: 'k' },
            ],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        // inbound: s -> c1__f (the input port)
        expect(out.edges.some(e => e.source === 's' && e.target === 'c1__f')).toBe(true);
        // outbound: c1__d -> k (the output port)
        expect(out.edges.some(e => e.source === 'c1__d' && e.target === 'k')).toBe(true);
        // inner edge present, namespaced
        expect(out.edges.some(e => e.source === 'c1__f' && e.target === 'c1__d')).toBe(true);
        // no edge references the instance id anymore
        expect(out.edges.every(e => e.source !== 'c1' && e.target !== 'c1')).toBe(true);
    });

    it('substitutes instance params into the targeted inner node prop', () => {
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                {
                    id: 'c1',
                    data: { componentId: 'cmp.clean', properties: { minAmount: 'amount > 100' } },
                },
                { id: 'k', data: { componentId: 'snk.csv', properties: {} } },
            ],
            [
                { id: 'e1', source: 's', target: 'c1' },
                { id: 'e2', source: 'c1', target: 'k' },
            ],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        const f = out.nodes.find(n => n.id === 'c1__f');
        expect(f?.data.properties?.predicate).toBe('amount > 100');
        // unrelated inner prop preserved
        const d = out.nodes.find(n => n.id === 'c1__d');
        expect(d?.data.properties?.expr).toBe('amount * 2');
    });

    it('expands multiple instances of the same component without id collision', () => {
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                { id: 'a', data: { componentId: 'cmp.clean', properties: {} } },
                { id: 'b', data: { componentId: 'cmp.clean', properties: {} } },
                { id: 'k', data: { componentId: 'snk.csv', properties: {} } },
            ],
            [
                { id: 'e1', source: 's', target: 'a' },
                { id: 'e2', source: 'a', target: 'b' },
                { id: 'e3', source: 'b', target: 'k' },
            ],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        // s, k + 2 inner each = 6 nodes, all unique.
        expect(out.nodes).toHaveLength(6);
        expect(new Set(out.nodes.map(n => n.id)).size).toBe(6);
        // chain reconnected: a's output -> b's input
        expect(out.edges.some(e => e.source === 'a__d' && e.target === 'b__f')).toBe(true);
    });

    it('drops an instance whose definition is missing (unknown component id) and warns', () => {
        const { nodes, edges } = host(
            [
                { id: 's', data: { componentId: 'src.csv', properties: {} } },
                { id: 'c1', data: { componentId: 'cmp.ghost', properties: {} } },
            ],
            [{ id: 'e1', source: 's', target: 'c1' }],
        );
        const out = expandComponents(nodes, edges, [filterDerive]);
        // unknown instance is left as-is (engine will report it), not silently dropped.
        expect(out.nodes.some(n => n.id === 'c1')).toBe(true);
    });
});
