import { describe, it, expect } from 'vitest';
import {
    buildAgentPrompt,
    formatObservation,
    canContinue,
    MAX_AGENT_ITERATIONS,
    type ToolResult,
} from './agent-loop';

describe('buildAgentPrompt', () => {
    it('includes the skills catalog and the graph context', () => {
        const prompt = buildAgentPrompt('GRAPH_JSON_HERE');
        expect(prompt).toContain('GRAPH_JSON_HERE');
        // skills catalog is embedded
        expect(prompt).toContain('list_nodes');
        expect(prompt).toContain('add_node');
        // instructs the ReAct protocol
        expect(prompt.toLowerCase()).toContain('tool');
    });

    it('tells the model how to finish (stop emitting tool calls)', () => {
        const prompt = buildAgentPrompt('{}');
        expect(prompt.toLowerCase()).toMatch(/final|finish|done|no more/);
    });
});

describe('formatObservation', () => {
    it('wraps a successful tool result as an observation message', () => {
        const r: ToolResult = { ok: true, output: '3 nodes: a, b, c' };
        const msg = formatObservation('list_nodes', r);
        expect(msg).toContain('list_nodes');
        expect(msg).toContain('3 nodes: a, b, c');
        expect(msg.toLowerCase()).toContain('observation');
    });

    it('wraps an error result clearly', () => {
        const r: ToolResult = { ok: false, output: 'Unknown node n9' };
        const msg = formatObservation('get_node_schema', r);
        expect(msg).toContain('get_node_schema');
        expect(msg.toLowerCase()).toContain('error');
        expect(msg).toContain('Unknown node n9');
    });
});

describe('canContinue', () => {
    it('allows iterations below the max', () => {
        expect(canContinue(0)).toBe(true);
        expect(canContinue(MAX_AGENT_ITERATIONS - 1)).toBe(true);
    });
    it('stops at the max to prevent infinite loops', () => {
        expect(canContinue(MAX_AGENT_ITERATIONS)).toBe(false);
        expect(canContinue(MAX_AGENT_ITERATIONS + 1)).toBe(false);
    });
});
