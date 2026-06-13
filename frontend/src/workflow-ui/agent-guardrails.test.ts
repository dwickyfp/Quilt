import { describe, it, expect } from 'vitest';
import {
    hardenPrompt,
    validateAgainstGraph,
    isRepeatCall,
    CHART_TYPES,
} from './agent-guardrails';
import type { GraphSummary } from './graph-context';
import type { ToolCall } from './agent-skills';

const graph: GraphSummary = {
    nodes: [
        { id: 'src1', componentId: 'src.csv', columns: ['id', 'status'] },
        { id: 'flt1', componentId: 'xf.filter' },
    ],
    edges: [{ source: 'src1', target: 'flt1' }],
};

describe('hardenPrompt', () => {
    const base = 'You are Qunnie.';
    const out = hardenPrompt(base);

    it('keeps the original prompt content', () => {
        expect(out).toContain('You are Qunnie.');
    });
    it('locks the role to the Quilt pipeline domain', () => {
        expect(out.toLowerCase()).toContain('quilt');
        expect(out.toLowerCase()).toMatch(/decline|refuse|only/);
    });
    it('treats graph + observations as untrusted data, not instructions', () => {
        expect(out.toLowerCase()).toMatch(/data, not|not instructions|ignore .*instructions/);
    });
    it('forbids exfiltration / external calls', () => {
        expect(out.toLowerCase()).toMatch(/never .*(send|exfiltrat|external|url)/);
    });
    it('forbids inventing data', () => {
        expect(out.toLowerCase()).toMatch(/do not (invent|fabricate|make up)/);
    });
});

describe('validateAgainstGraph', () => {
    it('passes a node-referencing call when the node exists', () => {
        const call: ToolCall = { tool: 'get_node_schema', args: { id: 'src1' } };
        expect(validateAgainstGraph(call, graph)).toEqual({ ok: true });
    });

    it('rejects a node-referencing call when the node is missing', () => {
        const call: ToolCall = { tool: 'delete_node', args: { id: 'ghost' } };
        const r = validateAgainstGraph(call, graph);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain('ghost');
    });

    it('rejects add_node when the id collides with an existing node', () => {
        const call: ToolCall = { tool: 'add_node', args: { id: 'src1', componentId: 'xf.map' } };
        const r = validateAgainstGraph(call, graph);
        expect(r.ok).toBe(false);
    });

    it('accepts add_node with a fresh id', () => {
        const call: ToolCall = { tool: 'add_node', args: { id: 'new1', componentId: 'xf.map' } };
        expect(validateAgainstGraph(call, graph)).toEqual({ ok: true });
    });

    it('rejects connect_nodes when an endpoint is missing', () => {
        const call: ToolCall = { tool: 'connect_nodes', args: { source: 'src1', target: 'ghost' } };
        expect(validateAgainstGraph(call, graph).ok).toBe(false);
    });

    it('rejects connect_nodes self-loop', () => {
        const call: ToolCall = { tool: 'connect_nodes', args: { source: 'src1', target: 'src1' } };
        expect(validateAgainstGraph(call, graph).ok).toBe(false);
    });

    it('accepts connect_nodes between two existing nodes', () => {
        const call: ToolCall = { tool: 'connect_nodes', args: { source: 'src1', target: 'flt1' } };
        expect(validateAgainstGraph(call, graph)).toEqual({ ok: true });
    });

    it('rejects create_chart with an unknown chart type', () => {
        const call: ToolCall = {
            tool: 'create_chart',
            args: { id: 'c1', chart: 'piechart3d', source: 'flt1' },
        };
        expect(validateAgainstGraph(call, graph).ok).toBe(false);
    });

    it('accepts create_chart with an allowlisted chart type + existing source', () => {
        const call: ToolCall = {
            tool: 'create_chart',
            args: { id: 'c1', chart: 'bar', source: 'flt1' },
        };
        expect(validateAgainstGraph(call, graph)).toEqual({ ok: true });
    });

    it('rejects create_chart when source node is missing', () => {
        const call: ToolCall = {
            tool: 'create_chart',
            args: { id: 'c1', chart: 'bar', source: 'ghost' },
        };
        expect(validateAgainstGraph(call, graph).ok).toBe(false);
    });

    it('passes non-graph skills through unchanged', () => {
        expect(validateAgainstGraph({ tool: 'list_nodes', args: {} }, graph)).toEqual({ ok: true });
    });

    it('exposes the chart-type allowlist', () => {
        expect(CHART_TYPES).toContain('bar');
        expect(CHART_TYPES).toContain('histogram');
    });
});

describe('isRepeatCall', () => {
    const a: ToolCall = { tool: 'get_node_schema', args: { id: 'src1' } };
    const b: ToolCall = { tool: 'get_node_schema', args: { id: 'flt1' } };

    it('detects an identical tool+args already seen', () => {
        expect(isRepeatCall([a], a)).toBe(true);
    });
    it('does not flag a different arg set', () => {
        expect(isRepeatCall([a], b)).toBe(false);
    });
    it('does not flag against an empty history', () => {
        expect(isRepeatCall([], a)).toBe(false);
    });
    it('is order-insensitive on arg keys', () => {
        const x: ToolCall = { tool: 'connect_nodes', args: { source: 's', target: 't' } };
        const y: ToolCall = { tool: 'connect_nodes', args: { target: 't', source: 's' } };
        expect(isRepeatCall([x], y)).toBe(true);
    });
});
