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
- Engine: `cargo test -p quilt-duckdb-engine` (baseline 130 lib + 225 integration, 0 failed).
  Integration tests (`tests/execution.rs`) SOFT-SKIP unless `QUILT_DUCKDB_BIN` points to a
  DuckDB CLI. On macOS arm64 the repo bundles only Windows `duckdb.exe`, so download the mac
  CLI once into `.duckdb-cli-macos/` (gitignored) and `export QUILT_DUCKDB_BIN="$(pwd)/.duckdb-cli-macos/duckdb"`
  to make them actually run (~11s vs 0.04s skip). See the `quilt-engine-development` skill.
- Frontend: `cd frontend && npm run lint && npm run test && npm run build`

**Engine env vars** (set by the Tauri app's `set_workspace`, or ad-hoc in tests):
- `QUILT_DUCKDB_BIN` — path to the DuckDB CLI the engine shells out to.
- `QUILT_WORKSPACE` / `QUILT_LOG_DIR` — workspace root + NDJSON run-log dir.
- `QUILT_STAGE_CACHE_DIR` — opt-in incremental re-run cache (feature #1). Unset = no caching,
  exact legacy behavior. Set = content-addressed Parquet stage cache (`plan/stage_cache.rs` +
  the rewrite/write-back block in `execute_pipeline_with_events`). `QUILT_STAGE_CACHE_BUDGET_MB`
  caps it (default 2048, LRU by mtime). Cache write-back is atomic (tmp + rename) and best-effort.
- `QUILT_MEMORY_LIMIT` / `QUILT_THREADS` / `QUILT_TEMP_DIR` — DuckDB resource knobs.

**Pure-core + delegated-shell pattern** (proven, low-risk): extract logic into a DOM-free `.ts`
(or pure Rust) module with tests written FIRST (RED → GREEN), then wire the shell separately.

**Shipped features #1–#5** (all verified with real DuckDB execution):
- `xf.join.asof` — As-Of Join (builder + dispatch + exec test).
- `workflow-ui/lineage.ts` + `LineagePanel.tsx` — column lineage in the Schema tab.
- `qa.golden` — Golden Assert regression-test node (EXCEPT-both-ways vs a golden Parquet).
- `plan/stage_cache.rs` + executor wiring — incremental re-run (opt-in, see env var above).
- `workflow-ui/component-def.ts` + `component-expand.ts` + `run-resolve.ts` — #2 reusable
  components. Create-from-selection (node context menu, 2+ nodes) collapses a subgraph into a
  saved `cmp.*` instance; the run path (`expandComponentsForRun`) inlines instances back into a
  flat graph BEFORE the engine sees them (zero engine changes — verified by
  `expanded_component_namespaced_ids_run_correctly` exec test). Saved components show in the
  palette's "My Components" group, draggable as new instances. PARTIAL: per-instance param
  override has a tested core + run-path substitution, but `extractComponent` returns `params: []`
  and there's no UI yet to expose a param — so today's components are fixed subgraphs.
- STILL FOUNDATIONAL (tested core, NOT wired): `workflow-ui/pipeline-test.ts` (FE golden-diff
  core; the engine-side regression test shipped instead as `qa.golden`).

**Known trap:** the patch/write_file syntax checker mis-parses `crates/duckdb-engine/src/connectors.rs`
as edition 2015 and emits a wall of false-positive errors. Ignore them; trust only `cargo` output.
