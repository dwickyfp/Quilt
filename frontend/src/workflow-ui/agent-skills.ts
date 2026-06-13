// Agentic skill registry for the Qunnie graph-aware copilot (feature #4).
//
// Each skill is a tool the model can invoke via a fenced ```json
// {"tool": "...", "args": {...}} block (provider-agnostic protocol, the same
// approach as graph-patch). The ReAct loop parses one tool call per turn,
// runs it (gating mutating skills behind a human approve step — HITL), feeds
// the result back, and repeats until the model stops emitting tool calls.
//
// Skills are grouped by the existing feature they expose:
//   - inspect  : read-only graph/catalog/status (auto-run, no approval)
//   - edit     : graph mutations (reuse graph-patch ops, HITL-gated)
//   - execute  : run the pipeline / a node (HITL-gated)
//   - profile  : profiler metrics + EXPLAIN (read-only, feature A)
//   - visualize: create a chart node (HITL-gated, feature B)
//   - quality  : schema mismatch detection + fix suggestion (read-only)
//   - generate : NL -> full pipeline (HITL-gated, existing one-shot)

export type SkillParam = {
    name: string;
    required: boolean;
    description: string;
};

export type AgentSkill = {
    name: string;
    category: 'inspect' | 'edit' | 'execute' | 'profile' | 'visualize' | 'quality' | 'generate';
    description: string;
    params: SkillParam[];
    /** Mutating / side-effecting skills must be approved by the user first. */
    requiresApproval: boolean;
};

const p = (name: string, required: boolean, description: string): SkillParam => ({
    name,
    required,
    description,
});

export const AGENT_SKILLS: AgentSkill[] = [
    // ---- inspect (read-only, auto) ----
    {
        name: 'list_nodes',
        category: 'inspect',
        description: 'List every node currently on the canvas with its id, kind and component.',
        params: [],
        requiresApproval: false,
    },
    {
        name: 'get_node_schema',
        category: 'inspect',
        description: 'Return the output column schema (names + types) of one node.',
        params: [p('id', true, 'Node id to inspect')],
        requiresApproval: false,
    },
    {
        name: 'get_node_preview',
        category: 'inspect',
        description: 'Return a small sample of output rows for one node.',
        params: [p('id', true, 'Node id to preview')],
        requiresApproval: false,
    },
    {
        name: 'list_catalog',
        category: 'inspect',
        description: 'List the available component types that can be added to the pipeline.',
        params: [],
        requiresApproval: false,
    },
    {
        name: 'get_pipeline_status',
        category: 'inspect',
        description: 'Return the last run status of the whole pipeline.',
        params: [],
        requiresApproval: false,
    },
    // ---- edit (graph mutations, HITL) ----
    {
        name: 'add_node',
        category: 'edit',
        description: 'Add a new node. Args: id, componentId, kind, label, properties.',
        params: [
            p('id', true, 'Unique id for the new node'),
            p('componentId', true, 'Catalog component id, e.g. xf.filter'),
        ],
        requiresApproval: true,
    },
    {
        name: 'update_node',
        category: 'edit',
        description: 'Update an existing node configuration. Args: id, properties.',
        params: [p('id', true, 'Node id to update'), p('properties', true, 'New property values')],
        requiresApproval: true,
    },
    {
        name: 'delete_node',
        category: 'edit',
        description: 'Delete a node from the canvas. Args: id.',
        params: [p('id', true, 'Node id to delete')],
        requiresApproval: true,
    },
    {
        name: 'connect_nodes',
        category: 'edit',
        description: 'Connect two nodes with an edge. Args: source, target.',
        params: [p('source', true, 'Source node id'), p('target', true, 'Target node id')],
        requiresApproval: true,
    },
    {
        name: 'disconnect_nodes',
        category: 'edit',
        description: 'Remove the edge between two nodes. Args: source, target.',
        params: [p('source', true, 'Source node id'), p('target', true, 'Target node id')],
        requiresApproval: true,
    },
    // ---- execute (HITL) ----
    {
        name: 'run_pipeline',
        category: 'execute',
        description: 'Execute the whole pipeline and report the result.',
        params: [],
        requiresApproval: true,
    },
    {
        name: 'run_node',
        category: 'execute',
        description: 'Execute the pipeline up to and including one node. Args: id.',
        params: [p('id', true, 'Node id to run up to')],
        requiresApproval: true,
    },
    // ---- profile (read-only, feature A) ----
    {
        name: 'get_profile_metrics',
        category: 'profile',
        description: 'Return per-node execution metrics (duration, rows) from the last run.',
        params: [],
        requiresApproval: false,
    },
    {
        name: 'explain_node',
        category: 'profile',
        description: 'Return the captured EXPLAIN query plan for a View node. Args: id.',
        params: [p('id', true, 'Node id to explain')],
        requiresApproval: false,
    },
    // ---- visualize (HITL, feature B) ----
    {
        name: 'create_chart',
        category: 'visualize',
        description:
            'Add a chart node (bar/line/scatter/histogram). Args: id, chart, x, y, agg, source.',
        params: [
            p('id', true, 'Unique id for the chart node'),
            p('chart', true, 'Chart type: bar|line|scatter|histogram'),
            p('source', true, 'Upstream node id to chart'),
        ],
        requiresApproval: true,
    },
    // ---- quality (read-only, suggestion only) ----
    {
        name: 'detect_schema_mismatch',
        category: 'quality',
        description: 'Check the graph for columns a node references but its upstream does not produce.',
        params: [],
        requiresApproval: false,
    },
    {
        name: 'suggest_fix',
        category: 'quality',
        description: 'Suggest (not apply) a fix for a detected schema or wiring problem. Args: id.',
        params: [p('id', true, 'Node id the problem relates to')],
        requiresApproval: false,
    },
    // ---- generate (HITL) ----
    {
        name: 'generate_pipeline',
        category: 'generate',
        description: 'Generate a full pipeline from a natural-language description. Args: description.',
        params: [p('description', true, 'What the pipeline should do')],
        requiresApproval: true,
    },
];

export function getSkill(name: string): AgentSkill | undefined {
    return AGENT_SKILLS.find(s => s.name === name);
}

export function skillsRequiringApproval(): string[] {
    return AGENT_SKILLS.filter(s => s.requiresApproval).map(s => s.name);
}

/** Render the skill catalog into a compact text block for the system prompt. */
export function renderSkillsForPrompt(): string {
    const lines = AGENT_SKILLS.map(s => {
        const args = s.params.map(pp => (pp.required ? pp.name : `${pp.name}?`)).join(', ');
        const gate = s.requiresApproval ? ' [requires approval]' : '';
        return `- ${s.name}(${args}) — ${s.description}${gate}`;
    });
    return [
        'Available tools (emit ONE as a fenced ```json {"tool":"<name>","args":{...}} block to call it):',
        ...lines,
        'Tools marked [requires approval] only run after the user approves.',
    ].join('\n');
}

export type ToolCall = { tool: string; args: Record<string, unknown> };

/** Parse a single fenced ```json {"tool":...,"args":...} block from a reply. */
export function parseToolCall(text: string): ToolCall | null {
    const fence = text.match(/```json\s*([\s\S]*?)```/i);
    if (!fence) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(fence[1].trim());
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.tool !== 'string') return null;
    const args =
        obj.args && typeof obj.args === 'object' ? (obj.args as Record<string, unknown>) : {};
    return { tool: obj.tool, args };
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Validate a tool call against the registry (known tool + required params). */
export function validateToolCall(call: ToolCall): ValidationResult {
    const skill = getSkill(call.tool);
    if (!skill) return { ok: false, error: `Unknown tool: ${call.tool}` };
    for (const param of skill.params) {
        if (param.required && !(param.name in call.args)) {
            return { ok: false, error: `Missing required arg "${param.name}" for ${call.tool}` };
        }
    }
    return { ok: true };
}
