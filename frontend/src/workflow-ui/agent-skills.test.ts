import { describe, it, expect } from 'vitest';
import {
    AGENT_SKILLS,
    getSkill,
    skillsRequiringApproval,
    renderSkillsForPrompt,
    parseToolCall,
    validateToolCall,
    type ToolCall,
} from './agent-skills';

describe('AGENT_SKILLS registry', () => {
    it('has unique skill names', () => {
        const names = AGENT_SKILLS.map(s => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('every skill declares category, description, params and approval flag', () => {
        for (const s of AGENT_SKILLS) {
            expect(s.name).toMatch(/^[a-z_]+$/);
            expect(s.description.length).toBeGreaterThan(0);
            expect(s.category.length).toBeGreaterThan(0);
            expect(typeof s.requiresApproval).toBe('boolean');
            expect(Array.isArray(s.params)).toBe(true);
        }
    });

    it('read-only inspect skills do not require approval', () => {
        expect(getSkill('list_nodes')?.requiresApproval).toBe(false);
        expect(getSkill('get_node_schema')?.requiresApproval).toBe(false);
        expect(getSkill('get_profile_metrics')?.requiresApproval).toBe(false);
    });

    it('mutating skills require approval (HITL)', () => {
        expect(getSkill('add_node')?.requiresApproval).toBe(true);
        expect(getSkill('delete_node')?.requiresApproval).toBe(true);
        expect(getSkill('run_pipeline')?.requiresApproval).toBe(true);
        expect(getSkill('create_chart')?.requiresApproval).toBe(true);
    });
});

describe('getSkill', () => {
    it('returns a skill by name', () => {
        expect(getSkill('list_nodes')?.name).toBe('list_nodes');
    });
    it('returns undefined for unknown', () => {
        expect(getSkill('nope')).toBeUndefined();
    });
});

describe('skillsRequiringApproval', () => {
    it('returns only the HITL-gated skill names', () => {
        const gated = skillsRequiringApproval();
        expect(gated).toContain('add_node');
        expect(gated).not.toContain('list_nodes');
    });
});

describe('renderSkillsForPrompt', () => {
    it('produces a text block listing each skill name + description', () => {
        const text = renderSkillsForPrompt();
        expect(text).toContain('list_nodes');
        expect(text).toContain('add_node');
        // approval-gated skills are marked
        expect(text.toLowerCase()).toContain('approval');
    });
});

describe('parseToolCall', () => {
    it('extracts a fenced json tool call', () => {
        const reply = 'Let me inspect.\n```json\n{"tool":"list_nodes","args":{}}\n```';
        expect(parseToolCall(reply)).toEqual({ tool: 'list_nodes', args: {} });
    });

    it('extracts tool call with args', () => {
        const reply = '```json\n{"tool":"get_node_schema","args":{"id":"n1"}}\n```';
        expect(parseToolCall(reply)).toEqual({ tool: 'get_node_schema', args: { id: 'n1' } });
    });

    it('returns null when there is no fenced json', () => {
        expect(parseToolCall('just talking, no tool')).toBeNull();
    });

    it('returns null when json lacks a tool field', () => {
        expect(parseToolCall('```json\n{"foo":1}\n```')).toBeNull();
    });

    it('returns null on malformed json', () => {
        expect(parseToolCall('```json\n{not json}\n```')).toBeNull();
    });

    it('defaults args to empty object when omitted', () => {
        expect(parseToolCall('```json\n{"tool":"list_nodes"}\n```')).toEqual({ tool: 'list_nodes', args: {} });
    });
});

describe('validateToolCall', () => {
    it('accepts a known tool with required params present', () => {
        const call: ToolCall = { tool: 'get_node_schema', args: { id: 'n1' } };
        expect(validateToolCall(call)).toEqual({ ok: true });
    });

    it('rejects an unknown tool', () => {
        const call: ToolCall = { tool: 'frobnicate', args: {} };
        const r = validateToolCall(call);
        expect(r.ok).toBe(false);
    });

    it('rejects when a required param is missing', () => {
        const call: ToolCall = { tool: 'get_node_schema', args: {} };
        const r = validateToolCall(call);
        expect(r.ok).toBe(false);
    });

    it('accepts a no-arg skill with empty args', () => {
        expect(validateToolCall({ tool: 'list_nodes', args: {} })).toEqual({ ok: true });
    });
});
