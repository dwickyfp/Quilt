import { describe, it, expect } from 'vitest';
import {
    applyGraphPatch,
    summarizePatch,
    extractGraphPatch,
    type GraphPatchOp,
    type PatchNode,
    type PatchEdge,
} from './graph-patch';

const mkNode = (id: string, componentId: string): PatchNode => ({
    id,
    data: { label: id, componentId, kind: 'transform' },
});

describe('applyGraphPatch', () => {
    it('add_node appends a node', () => {
        const nodes = [mkNode('n1', 'src.csv')];
        const edges: PatchEdge[] = [];
        const ops: GraphPatchOp[] = [
            { op: 'add_node', node: mkNode('n2', 'xf.filter') },
        ];
        const out = applyGraphPatch(nodes, edges, ops);
        expect(out.nodes).toHaveLength(2);
        expect(out.nodes[1].id).toBe('n2');
        // original array not mutated
        expect(nodes).toHaveLength(1);
    });

    it('update_node merges properties without clobbering others', () => {
        const nodes = [
            { id: 'n1', data: { label: 'f', componentId: 'xf.filter', properties: { expr: 'a', keep: true } } },
        ];
        const ops: GraphPatchOp[] = [
            { op: 'update_node', id: 'n1', properties: { expr: 'b' } },
        ];
        const out = applyGraphPatch(nodes, [], ops);
        expect(out.nodes[0].data.properties).toEqual({ expr: 'b', keep: true });
    });

    it('delete_node removes the node and its connected edges', () => {
        const nodes = [mkNode('n1', 'src.csv'), mkNode('n2', 'xf.filter')];
        const edges: PatchEdge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
        const ops: GraphPatchOp[] = [{ op: 'delete_node', id: 'n2' }];
        const out = applyGraphPatch(nodes, edges, ops);
        expect(out.nodes.map(n => n.id)).toEqual(['n1']);
        expect(out.edges).toHaveLength(0);
    });

    it('connect adds an edge with a synthesized id', () => {
        const nodes = [mkNode('n1', 'src.csv'), mkNode('n2', 'xf.filter')];
        const ops: GraphPatchOp[] = [{ op: 'connect', source: 'n1', target: 'n2' }];
        const out = applyGraphPatch(nodes, [], ops);
        expect(out.edges).toHaveLength(1);
        expect(out.edges[0].source).toBe('n1');
        expect(out.edges[0].target).toBe('n2');
        expect(out.edges[0].id).toBeTruthy();
    });

    it('connect is idempotent (no duplicate edge)', () => {
        const nodes = [mkNode('n1', 'src.csv'), mkNode('n2', 'xf.filter')];
        const edges: PatchEdge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
        const ops: GraphPatchOp[] = [{ op: 'connect', source: 'n1', target: 'n2' }];
        const out = applyGraphPatch(nodes, edges, ops);
        expect(out.edges).toHaveLength(1);
    });

    it('disconnect removes a matching edge', () => {
        const nodes = [mkNode('n1', 'src.csv'), mkNode('n2', 'xf.filter')];
        const edges: PatchEdge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
        const ops: GraphPatchOp[] = [{ op: 'disconnect', source: 'n1', target: 'n2' }];
        const out = applyGraphPatch(nodes, edges, ops);
        expect(out.edges).toHaveLength(0);
    });

    it('ignores update/delete/connect referencing unknown nodes (no crash)', () => {
        const nodes = [mkNode('n1', 'src.csv')];
        const ops: GraphPatchOp[] = [
            { op: 'update_node', id: 'ghost', properties: { x: 1 } },
            { op: 'delete_node', id: 'ghost' },
            { op: 'connect', source: 'n1', target: 'ghost' },
        ];
        const out = applyGraphPatch(nodes, [], ops);
        expect(out.nodes).toHaveLength(1);
        expect(out.edges).toHaveLength(0);
    });

    it('applies multiple ops in order', () => {
        const nodes = [mkNode('n1', 'src.csv')];
        const ops: GraphPatchOp[] = [
            { op: 'add_node', node: mkNode('n2', 'xf.filter') },
            { op: 'connect', source: 'n1', target: 'n2' },
        ];
        const out = applyGraphPatch(nodes, [], ops);
        expect(out.nodes).toHaveLength(2);
        expect(out.edges).toHaveLength(1);
    });
});

describe('summarizePatch', () => {
    it('produces a human-readable summary per op', () => {
        const ops: GraphPatchOp[] = [
            { op: 'add_node', node: mkNode('n2', 'xf.filter') },
            { op: 'update_node', id: 'n1', properties: { expr: 'b' } },
            { op: 'delete_node', id: 'n3' },
            { op: 'connect', source: 'n1', target: 'n2' },
            { op: 'disconnect', source: 'n2', target: 'n3' },
        ];
        const lines = summarizePatch(ops);
        expect(lines).toHaveLength(5);
        expect(lines[0]).toContain('Add');
        expect(lines[0]).toContain('xf.filter');
        expect(lines[1]).toContain('n1');
        expect(lines[2]).toContain('n3');
        expect(lines[3]).toContain('n1');
        expect(lines[3]).toContain('n2');
    });
});

describe('extractGraphPatch', () => {
    it('pulls a patch ops array from a fenced json block', () => {
        const text =
            'Sure, I\'ll add a dedup step:\n\n```json\n{"ops":[{"op":"add_node","node":{"id":"n2","data":{"label":"dedup","componentId":"xf.dedup","kind":"transform"}}},{"op":"connect","source":"n1","target":"n2"}]}\n```\nDone.';
        const ops = extractGraphPatch(text);
        expect(ops).toHaveLength(2);
        expect(ops?.[0].op).toBe('add_node');
        expect(ops?.[1].op).toBe('connect');
    });

    it('returns null when no fenced block present', () => {
        expect(extractGraphPatch('just a plain chat reply, no code')).toBeNull();
    });

    it('returns null when json is not a patch (no ops array)', () => {
        const text = '```json\n{"nodes":[{"id":"a"}]}\n```';
        expect(extractGraphPatch(text)).toBeNull();
    });

    it('returns null on malformed json', () => {
        const text = '```json\n{"ops":[ broken\n```';
        expect(extractGraphPatch(text)).toBeNull();
    });

    it('skips ops with unknown op names, keeping valid ones', () => {
        const text =
            '```json\n{"ops":[{"op":"nuke_everything"},{"op":"delete_node","id":"n1"}]}\n```';
        const ops = extractGraphPatch(text);
        expect(ops).toHaveLength(1);
        expect(ops?.[0].op).toBe('delete_node');
    });
});

