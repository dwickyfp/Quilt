// Pure helpers for the Qunnie ReAct agent loop (feature #4).
//
// The effectful loop (repeated chatSend + skill execution + HITL gating) lives
// in ChatPanel; this module holds the DOM-free, unit-testable pieces: the
// agentic system prompt, observation formatting fed back to the model, and the
// iteration guard that prevents runaway loops.

import { renderSkillsForPrompt } from './agent-skills';

/** Hard cap on agent turns so a confused model can't loop forever. */
export const MAX_AGENT_ITERATIONS = 8;

export type ToolResult = { ok: boolean; output: string };

/**
 * Build the agentic system prompt: embeds the live graph context and the skill
 * catalog, and explains the ReAct protocol (one tool call per turn, observe,
 * repeat, then a final plain-text answer with no tool call to finish).
 */
export function buildAgentPrompt(graphJson: string): string {
    return [
        'You are Qunnie, an agentic assistant embedded in the Quilt pipeline editor.',
        'You operate in a ReAct loop: think, optionally call ONE tool, read the',
        'observation, then repeat. When you are done, reply with a final plain-text',
        'answer and DO NOT emit any tool call — that ends the loop.',
        '',
        'Current pipeline graph (JSON):',
        graphJson,
        '',
        renderSkillsForPrompt(),
        '',
        'Rules:',
        '- Emit at most ONE tool call per message, as a single fenced ```json block.',
        '- Prefer read-only inspect/profile tools before proposing mutations.',
        '- Tools marked [requires approval] pause for the user to approve or reject.',
        '- To build a brand-new pipeline from scratch, you may instead put the full',
        '  pipeline JSON in your final answer — it will be offered for one-click insert.',
        '- To FINISH, write your final answer as plain text with no ```json tool block.',
    ].join('\n');
}

/** Format a tool result as an observation message fed back to the model. */
export function formatObservation(tool: string, result: ToolResult): string {
    const status = result.ok ? 'OK' : 'ERROR';
    return `Observation [${tool}] ${status}:\n${result.output}`;
}

/** Whether the loop may run another iteration. */
export function canContinue(iteration: number): boolean {
    return iteration < MAX_AGENT_ITERATIONS;
}
