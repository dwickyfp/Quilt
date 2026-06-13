# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project notes — Quilt

Local-first visual ETL: Rust DuckDB engine (`crates/duckdb-engine`, crate `quilt-duckdb-engine`)
compiles a node graph to staged DuckDB SQL; React 19 + Vite + Tauri 2 frontend (`frontend/`).

**4-place node pattern** (adding/editing a pipeline node — mirror an existing node):
1. Catalog: `frontend/src/workflow-ui/palette-data.ts`
2. Form: `frontend/src/workflow-ui/fields/manifest-synth.ts` (ports + field synth)
3. Builder: `crates/duckdb-engine/src/plan/builders.rs` (`match component_id` dispatch + `build_*` fn)
4. Runtime: `crates/duckdb-engine/src/lib.rs` (only if a new `RuntimeSpec` variant is needed)

**Verify after every change:**
- Engine: `cargo test -p quilt-duckdb-engine` (baseline 116 lib + 216 integration, 0 failed)
- Frontend: `cd frontend && npm run lint && npm run test && npm run build`

**Pure-core + delegated-shell pattern** (proven, low-risk for FE features): extract all logic
into a DOM-free `.ts` module with vitest tests written FIRST (RED → GREEN), then wire the React
shell separately. Established cores:
- `workflow-ui/lineage.ts` — column-level lineage (`buildLineage`, `traceColumn`).
- `workflow-ui/stage-cache.ts` — incremental re-run keys (`computeCacheKeys`, `invalidatedNodes`, `staleNodes`).
- `workflow-ui/pipeline-test.ts` — golden-dataset diff (`diffRows`, key + multiset modes).
- `workflow-ui/component-def.ts` — reusable subgraph (`extractComponent`, `instantiateComponent`).

These four cores are TESTED LOGIC, not yet wired to the engine/UI — do not claim them as
shipped features in the README until their execution path + React shell land. `xf.join.asof`
(As-Of Join) IS shipped end-to-end (builder + dispatch + tests + palette/manifest).

**Known trap:** the patch/write_file syntax checker mis-parses `crates/duckdb-engine/src/connectors.rs`
as edition 2015 and emits a wall of false-positive errors. Ignore them; trust only `cargo` output.
