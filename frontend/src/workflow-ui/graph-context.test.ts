import { describe, it, expect } from 'vitest';
import { serializeGraph, type GraphNodeInput, type GraphEdgeInput } from './graph-context';

const node = (
    id: string,
    componentId: string,
    kind: string,
    label: string,
    extra: Partial<GraphNodeInput['data']> = {},
): GraphNodeInput => ({
    id,
    data: { label, componentId, kind, ...extra },
});

describe('serializeGraph', () => {
    it('summarizes nodes with id, componentId, kind, label', () => {
        const nodes = [node('n1', 'src.csv', 'source', 'orders.csv')];
        const out = serializeGraph(nodes, []);
        expect(out.nodes).toEqual([
            { id: 'n1', componentId: 'src.csv', kind: 'source', label: 'orders.csv' },
        ]);
        expect(out.edges).toEqual([]);
    });

    it('includes edges as source->target pairs', () => {
        const nodes = [
            node('n1', 'src.csv', 'source', 'csv'),
            node('n2', 'xf.filter', 'transform', 'filter'),
        ];
        const edges: GraphEdgeInput[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
        const out = serializeGraph(nodes, edges);
        expect(out.edges).toEqual([{ source: 'n1', target: 'n2' }]);
    });

    it('includes non-empty properties but omits empty ones', () => {
        const nodes = [
            node('n1', 'xf.filter', 'transform', 'filter', { properties: { expr: "status='paid'" } }),
            node('n2', 'xf.sort', 'transform', 'sort', { properties: {} }),
        ];
        const out = serializeGraph(nodes, []);
        expect(out.nodes[0].properties).toEqual({ expr: "status='paid'" });
        expect(out.nodes[1].properties).toBeUndefined();
    });

    it('includes schema column names when present', () => {
        const nodes = [
            node('n1', 'src.csv', 'source', 'csv', {
                schema: [
                    { name: 'id', type: 'INTEGER' },
                    { name: 'amount', type: 'DECIMAL' },
                ],
            }),
        ];
        const out = serializeGraph(nodes, []);
        expect(out.nodes[0].columns).toEqual(['id', 'amount']);
    });

    it('omits columns when schema is empty or missing', () => {
        const nodes = [node('n1', 'src.csv', 'source', 'csv', { schema: [] })];
        const out = serializeGraph(nodes, []);
        expect(out.nodes[0].columns).toBeUndefined();
    });

    it('handles a node with no componentId gracefully', () => {
        const nodes: GraphNodeInput[] = [{ id: 'n1', data: { label: 'mystery' } }];
        const out = serializeGraph(nodes, []);
        expect(out.nodes[0].componentId).toBeUndefined();
        expect(out.nodes[0].label).toBe('mystery');
    });
});
