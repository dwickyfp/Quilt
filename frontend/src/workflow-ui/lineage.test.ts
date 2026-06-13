import { describe, it, expect } from 'vitest';
import {
    buildLineage,
    traceColumn,
    type LineageNodeInput,
    type LineageEdgeInput,
} from './lineage';

// Minimal node/edge builders mirroring the canvas shape used elsewhere.
const node = (
    id: string,
    componentId: string,
    columns: string[],
    properties: Record<string, unknown> = {},
): LineageNodeInput => ({
    id,
    data: { componentId, properties, schema: columns.map(name => ({ name })) },
});

const edge = (
    source: string,
    target: string,
    connectionType = 'main',
    targetHandle?: string,
): LineageEdgeInput => ({ id: `${source}->${target}`, source, target, connectionType, targetHandle });

describe('buildLineage', () => {
    it('passthrough transform keeps the same column origin', () => {
        const nodes = [
            node('s', 'src.csv', ['id', 'amount']),
            node('f', 'xf.filter', ['id', 'amount']),
        ];
        const edges = [edge('s', 'f')];
        const lin = buildLineage(nodes, edges);
        // amount @ f traces back to amount @ s
        expect(lin.get('f')?.get('amount')).toEqual([{ nodeId: 's', column: 'amount' }]);
        expect(lin.get('f')?.get('id')).toEqual([{ nodeId: 's', column: 'id' }]);
    });

    it('source columns originate from themselves', () => {
        const nodes = [node('s', 'src.csv', ['id'])];
        const lin = buildLineage(nodes, []);
        expect(lin.get('s')?.get('id')).toEqual([{ nodeId: 's', column: 'id' }]);
    });

    it('rename remaps the renamed column origin, keeps others', () => {
        const nodes = [
            node('s', 'src.csv', ['cust', 'amount']),
            node('r', 'xf.rename', ['customer', 'amount'], {
                renames: [{ from: 'cust', to: 'customer' }],
            }),
        ];
        const edges = [edge('s', 'r')];
        const lin = buildLineage(nodes, edges);
        // renamed output 'customer' traces to source 'cust'
        expect(lin.get('r')?.get('customer')).toEqual([{ nodeId: 's', column: 'cust' }]);
        // untouched column carries through
        expect(lin.get('r')?.get('amount')).toEqual([{ nodeId: 's', column: 'amount' }]);
    });

    it('drop removes the dropped column from lineage', () => {
        const nodes = [
            node('s', 'src.csv', ['id', 'secret']),
            node('d', 'xf.drop', ['id'], { columns: ['secret'] }),
        ];
        const edges = [edge('s', 'd')];
        const lin = buildLineage(nodes, edges);
        expect(lin.get('d')?.has('secret')).toBe(false);
        expect(lin.get('d')?.get('id')).toEqual([{ nodeId: 's', column: 'id' }]);
    });

    it('join unions columns from both driving and lookup inputs', () => {
        const nodes = [
            node('l', 'src.csv', ['id', 'amount']),
            node('r', 'src.csv', ['id', 'region']),
            node('j', 'xf.join.inner', ['id', 'amount', 'region']),
        ];
        const edges = [
            edge('l', 'j', 'main'),
            edge('r', 'j', 'lookup', 'lookup'),
        ];
        const lin = buildLineage(nodes, edges);
        // amount comes only from left, region only from right
        expect(lin.get('j')?.get('amount')).toEqual([{ nodeId: 'l', column: 'amount' }]);
        expect(lin.get('j')?.get('region')).toEqual([{ nodeId: 'r', column: 'region' }]);
        // id exists on both sides -> both origins recorded
        const idOrigins = lin.get('j')?.get('id') ?? [];
        expect(idOrigins).toContainEqual({ nodeId: 'l', column: 'id' });
        expect(idOrigins).toContainEqual({ nodeId: 'r', column: 'id' });
    });
});

describe('traceColumn', () => {
    it('walks a column back to its ultimate source through a chain', () => {
        const nodes = [
            node('s', 'src.csv', ['cust', 'amount']),
            node('r', 'xf.rename', ['customer', 'amount'], {
                renames: [{ from: 'cust', to: 'customer' }],
            }),
            node('f', 'xf.filter', ['customer', 'amount']),
        ];
        const edges = [edge('s', 'r'), edge('r', 'f')];
        const lin = buildLineage(nodes, edges);
        const trace = traceColumn(lin, 'f', 'customer');
        // The trace ends at the source node/column.
        expect(trace[trace.length - 1]).toEqual({ nodeId: 's', column: 'cust' });
    });

    it('returns a single-element trace for an unknown column', () => {
        const nodes = [node('s', 'src.csv', ['id'])];
        const lin = buildLineage(nodes, []);
        const trace = traceColumn(lin, 's', 'id');
        expect(trace).toEqual([{ nodeId: 's', column: 'id' }]);
    });
});
