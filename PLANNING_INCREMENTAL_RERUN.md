# PLANNING — Smart Incremental Re-run (Stage Cache)

Feature #1. Reuse the materialized output of pipeline stages whose inputs
haven't changed since the last successful run, so editing one node only
re-executes that node and its downstream — not the whole graph.

## Execution model (verified, June 2026)

Read from `crates/duckdb-engine/src/lib.rs` + `src/plan/mod.rs`:

1. **Temp DB per run, deleted at end.** `execute_pipeline_with_events` creates
   `temp_dir()/quilt_run_<pid>_<nanos>_<seq>.duckdb`; `TempDbGuard::drop`
   removes the file + WAL when the run returns (lib.rs:406-412, 1613-1618).
   → Stage outputs do NOT survive across runs today. This is the whole reason
   the cache must be an EXTERNAL on-disk store, not "keep the table around".

2. **Stages compile to VIEW or TABLE** (`build_stage`, mod.rs:~3300-3440):
   - 1 consumer → `CREATE OR REPLACE VIEW {node_id}` (inlined into consumer:
     predicate/projection pushdown, no intermediate write).
   - 2+ consumers → `CREATE OR REPLACE TABLE {node_id}` (materialize once).
   - attach-backed sources (postgres/mysql/…), dynamic-pivot, and some reject
     splits are FORCED to TABLE.
   - `StageKind::{View,Table,Sink,…}` records which.

3. **Pure-SQL fast path** (lib.rs:438-490): if every stage `is_pure_sql()`
   (no `RuntimeSpec`), the executor concatenates ALL stage SQL into ONE
   `duckdb` CLI spawn, with file-based stage-boundary markers for progress.
   This is the common case and the one the cache must integrate with.

4. **Per-stage path**: stages with a `RuntimeSpec` (drivers, HTTP/AI, control
   flow) each get their own CLI spawn with Rust-side pre/post hooks.

## Cache key

A stage's cache key must fold in EVERYTHING that can change its output:

```
key(stage) = blake3(
    component_id ||
    canonical(properties) ||           // order-insensitive (mirrors stage-cache.ts)
    sorted(key(parent) for parent in upstream) ||   // cascades downstream
    external_fingerprint(stage)        // see below
)
```

**External fingerprint** — the part the FE `stage-cache.ts` core cannot know
and the #1 correctness trap. For source stages that read a local path
(`src.csv`, `src.parquet`, `src.json`, …), fold in `(mtime_ns, size_bytes)` of
the file. If the file on disk changes without the graph changing, the key MUST
change. Sources we cannot cheaply fingerprint (network DBs, HTTP, AI, anything
with a `RuntimeSpec`) are NON-CACHEABLE and also taint everything downstream of
them (their key includes a per-run nonce, so they never hit).

## Cacheability filter (conservative — correctness over coverage)

A stage is cacheable ONLY if:
- `is_pure_sql()` (no `RuntimeSpec`), AND
- it is not a sink (sinks have side effects — always run), AND
- every upstream stage is cacheable, AND
- if it is a source, it reads a local file we can stat.

Anything else → non-cacheable, and taints downstream. This deliberately
under-caches rather than risk serving stale data. We can widen later.

## On-disk layout

```
<workspace>/.quilt-cache/
  manifest.json          # { key -> {path, bytes, last_used_unix, rows} }
  <key>.parquet          # one checkpoint per cached stage output
```

Workspace-scoped (not temp_dir) so it survives across runs. LRU eviction by
`last_used_unix` against a byte budget (default e.g. 2 GiB), pruned after each
run.

## Execution integration

Plan-rewrite step, AFTER `compile_plan`, BEFORE execution:

1. Compute `key(stage)` for every stage (topological).
2. `hit(stage)` = stage cacheable AND `<key>.parquet` exists in manifest.
3. For each hit stage: replace its SQL with
   `CREATE OR REPLACE VIEW {node_id} AS SELECT * FROM read_parquet('<cache>/<key>.parquet')`
   and set `runtime=None`, `kind=View`.
4. **Upstream prune**: a stage may be DROPPED from the plan iff ALL of its
   consumers are cache-hits (its output is no longer needed). Compute by
   walking consumers; never drop a stage that still feeds a miss or a sink.
5. For each cacheable MISS that materialized successfully: after the run,
   `COPY {node_id} TO '<cache>/<key>.parquet' (FORMAT parquet)` and record in
   manifest. (Only on overall-run success, mirroring how `pending_watermarks`
   defers until the whole run is OK — a downstream failure must not poison the
   cache with a half-built upstream.)

**Fast-path interaction**: checkpoint COPYs are extra pure-SQL statements, so
they compose with the batched single-spawn path. A pruned upstream simply isn't
emitted. A hit's `read_parquet` view is pure SQL. So the fast path still
applies — no architectural conflict, just more/fewer SQL statements.

## Correctness invariants (the tests that MUST pass)

1. **Hit serves identical data**: run pipeline, edit nothing, re-run → cached
   stage's downstream output byte-identical to a cold run.
2. **Config change invalidates**: edit a stage prop → that stage + all
   downstream recompute (key changes cascade).
3. **Upstream change invalidates**: edit an upstream prop → downstream key
   changes even though downstream config is untouched.
4. **External file change invalidates**: rewrite the source CSV on disk (graph
   unchanged) → key changes via fingerprint → fresh data served, NOT stale.
5. **Prune never serves stale**: a pruned upstream's absence never changes a
   downstream result vs. cold run.
6. **Non-cacheable taint**: a pipeline with an AI/HTTP stage never caches it or
   anything downstream of it.

All six verified with REAL DuckDB execution (`QUILT_DUCKDB_BIN` set), not just
SQL-gen. #4 is the one most likely to be got wrong and is the reason foyer (a
KV cache) was rejected — the hard part is fingerprinting, not storage.

## Build order

1. Rust module `plan/stage_cache.rs`: key computation + cacheability filter +
   prune, pure functions, unit-tested (mirror FE `stage-cache.ts` semantics).
2. Manifest + Parquet read/write + LRU in the engine.
3. Plan-rewrite hook in `execute_pipeline_with_events`.
4. Six execution tests above.
5. (Optional) FE per-node fresh/cached badge using the existing FE core.

## Out of scope (v1)

- Caching `RuntimeSpec` stages (drivers/HTTP/AI).
- Cross-machine / shared cache.
- Partial-table incremental (row-level) — this is whole-stage memoization.
