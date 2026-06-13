# PLANNING_IMPLEMENTATION.md — 5-feature build

> Status hidup. Trace: 2026-06-13. TDD per task; build+lint hijau sebelum lanjut.
> Baseline: `cargo test -p quilt-duckdb-engine` = **216 passed, 0 failed** (+112 lib).
> Order: #5 ASOF → #3 lineage → #1 incremental → #4 unit-test → #2 component.
> Engine-heavy edits delegated to subagents (connectors.rs lint spam); FE done directly.

## 4-place node pattern (reference)
1. Catalog: `frontend/src/workflow-ui/palette-data.ts`
2. Form: `frontend/src/workflow-ui/fields/manifest-synth.ts` (ports @ ~L380, synth @ ~L2734)
3. Builder: `crates/duckdb-engine/src/plan/builders.rs` (dispatch match @ ~L125-210; `build_join` @ L2606)
4. Runtime: `crates/duckdb-engine/src/lib.rs` (only if new RuntimeSpec needed)

Verify: `cargo test -p quilt-duckdb-engine` · `cargo build -p quilt-duckdb-engine` · `cd frontend && npm run lint && npm run test && npm run build`

---

## #5 — ASOF JOIN node (DuckDB-native time-series merge)

**Goal:** new node `xf.join.asof` — match each left row to nearest-prior (or nearest-next) right row on a time/ordered column, optional equality keys, optional tolerance.

**Places:**
1. palette: add `xf('join.asof', 'As-Of Join', 'available', '...')` in the `xf.join` group.
2. manifest: ports — reuse the `xf.join.` prefix branch (already covers `xf.join.*`). Form synth — add an asof-specific branch in `synthJoinTransform` (or before it) with fields: `leftTime`, `rightTime`, `direction` (backward/forward), `matchKeys` (equality keys, optional), `inequality` (>=/<=, derived from direction).
3. builder: dispatch arm `"xf.join.asof" => build_asof_join(...)`; new `build_asof_join` fn → `SELECT * FROM left ASOF JOIN right [USING/ON ...]`. Use `quote_ident`. Validate required time cols → `Err` on missing.
4. runtime: none (plain View stage).

**SQL shape:**
`SELECT * FROM {l} m ASOF JOIN {r} r ON m.{eqkeys}=r.{eqkeys} AND m.{lt} >= r.{rt}` (backward), `<=` for forward. No eq keys → just the inequality.

**Tests (plan/tests.rs):** `asof_backward_uses_geq`, `asof_forward_uses_leq`, `asof_with_equality_keys`, `asof_missing_time_col_errors`.

---

## #3 — Column-level lineage (free from compiled SQL)

**Goal:** for each stage, expose which upstream column(s) feed each output column. Surface as an FE overlay ("trace column origin").

**Approach (pure core, low-risk):** a DOM-free TS module `lineage.ts` that walks the compiled pipeline graph + per-node column lists (already in NodePreview / schema) and builds node→node column edges using the node's known transform semantics (project/rename/map/join pass-through). Start coarse (node-level + rename/map/join column mapping), not a full SQL parser — YAGNI. Engine optionally annotates rename/map/join specs with `{out_col: [in_cols]}` if cheap.

**Places:**
- FE pure core `frontend/src/workflow-ui/lineage.ts` (vitest first): `buildLineage(graph, schemas) -> Map<nodeId, Map<outCol, SourceRef[]>>`; `traceColumn(lineage, nodeId, col) -> trace path`.
- FE shell: overlay panel / highlight on PropertiesPanel column hover (delegated).

**Tests (vitest):** rename remaps origin; map/project carries source; join unions both sides; passthrough transform keeps origin; drop removes col.

---

## #1 — Smart incremental re-run (node-output cache)

**Goal:** skip re-executing a stage whose inputs+config are unchanged since last run; reuse its materialized table.

**Approach:** content-hash per stage = hash(component_id + props + upstream stage hashes + engine version). Persist `{node_id: {hash, table_name}}` in workspace run-state. On run, if a stage's hash matches and its cached table still exists in the DuckDB session/attached cache → reuse (skip SQL exec, point downstream at cached table). Editing node N changes its hash → invalidates N + all downstream (transitive).

**Places (engine, delegated):**
- `plan/graph.rs` or `mod.rs`: compute stable per-stage hash during compile (`stage.cache_key`).
- `lib.rs` executor: before running a stage, check cache map; persist after success. Cache lives in run-state file + a DuckDB schema (e.g. `quilt_cache`).
- FE: node badge fresh/stale/cached; "clear cache" action.

**Tests:** hash stable across recompile w/ same input; hash changes when props change; downstream invalidation cascade; cache hit skips exec (integration, env-gated duckdb).

**Risk:** correctness of invalidation. Conservative default: cache opt-in per run ("reuse cache" toggle) until proven.

---

## #4 — Pipeline unit tests + golden datasets

**Goal:** capture a node's output as a golden snapshot; a test-run asserts `output == golden`; support mock inputs + node bypass; pass/fail report; headless/CI.

**Places:**
- FE pure core `frontend/src/workflow-ui/pipeline-test.ts` (vitest first): test-spec shape `{nodeId, goldenRef, mocks?}`, `diffResult(actual, golden) -> {added, removed, changed}` (pure, array-of-rows in/out).
- Engine: a "run in test mode" path that (a) swaps mocked source nodes for inline data, (b) after target stage, compares to golden via DuckDB `EXCEPT`/anti-join, emits a TestReport event. Golden tables persist as files in workspace (`tests/<name>.golden.parquet`).
- FE shell: Test panel (list specs, run, green/red). Delegated.

**Tests (vitest):** diff detects added/removed/changed rows; identical → pass; column-order-insensitive compare.

---

## #2 — Reusable Component node (encapsulated subgraph)

**Goal:** select subgraph → collapse into one node w/ declared in/out ports + exposed params + isolated var scope. Save to workspace; drop into other pipelines.

**Approach:** a Component is a saved sub-pipeline JSON + a manifest declaring `inputs[]`, `outputs[]`, `params[]` (which inner node props are exposed). At compile, a `component` node inlines its sub-pipeline (like existing `ctl.runpipeline`/`run-job` inlining) with param substitution + namespaced node ids to avoid collisions.

**Places:**
- FE pure core `frontend/src/workflow-ui/component-def.ts` (vitest first): `extractComponent(selectedNodes, edges) -> ComponentDef` (derive boundary ports from cut edges); `instantiateComponent(def, params) -> {nodes, edges}` (namespace ids, substitute params).
- Engine: compile-time inline of component nodes (reuse runpipeline inlining + namespacing); param→prop substitution.
- FE shell: "Create component from selection", component palette section, config dialog. Delegated.

**Tests (vitest):** boundary ports derived from cut edges; instantiate namespaces ids (no collision); param substitution into inner props; round-trip extract→instantiate preserves topology.

---

## Global verification gate (before commit)
1. `cargo test -p quilt-duckdb-engine` ≥ 216 + new (0 failed).
2. `cargo build -p quilt-duckdb-engine` + `--features onnx` check.
3. `cd frontend && npm run lint && npm run test && npm run build` all green.
4. Code review (skill `requesting-code-review`).
5. Docs: CLAUDE.md + README capability tables + TOC.
6. Commit (feature batch + docs together).
