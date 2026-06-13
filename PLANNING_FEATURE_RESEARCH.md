# PLANNING_FEATURE_RESEARCH.md — What to build next in Quilt

> Deep-research synthesis. Trace: 2026-06-13.
> Method: 4 parallel research streams (visual-ETL incumbents · modern data stack ·
> AI-native tooling · DuckDB superpowers), then **every candidate verified against
> the actual codebase** so nothing here already exists. Ideas that turned out to be
> shipped were dropped (see "Rejected" at the bottom).

## How to read this

Each idea is scored on three axes:
- **Edge** — is this a genuine differentiator, or table-stakes everyone has?
- **Fit** — how well it exploits Quilt's identity (local-first · DuckDB · git-JSON · single binary).
- **Effort** — low / med / high relative to the existing 4-place node pattern + engine.

Verdict legend: ⭐ = build this, it compounds · ✅ = solid, clear win · 🔹 = cheap, ship when convenient.

---

## Tier 1 — The compounding differentiators (build these)

### 1. ⭐ Smart incremental re-run (node-output cache)
**What:** Cache each node's materialized output. When you edit node N, recompute only
N and everything downstream — never the whole graph. A node shows fresh / stale / cached.
**Why it matters:** This is the single biggest inner-loop time-saver in visual ETL. Today
every tweak re-runs upstream work that didn't change. EasyMorph's per-action recalc is the
feature people cite most. On a 30-node pipeline pulling from Snowflake, this turns a 2-minute
iteration into 2 seconds.
**Quilt fit:** Perfect — DuckDB temp tables / materialized intermediates are the natural cache.
The engine already stages SQL per node; add a content-hash (node props + upstream hashes) →
skip stages whose hash is unchanged.
**Edge:** High · **Fit:** High · **Effort:** Med-High.

### 2. ⭐ Reusable Component node (encapsulated, parameterized subgraph)
**What:** Select a subgraph → collapse into a single node with declared input/output ports,
its own config dialog (exposed parameters), and an isolated variable scope. Save it to the
workspace; drop it into other pipelines like any built-in node.
**Why it matters:** This is how KNIME Components and EasyMorph modules turn one-off flows into
a personal/team library. `run-job` already lets you call a child pipeline, but it isn't a
*first-class parameterized building block* with its own UI — that's the gap.
**Quilt fit:** Strong — components serialize to the same plain-JSON workspace files, so they're
git-shareable and diffable. A "component marketplace" becomes possible later.
**Edge:** High · **Fit:** High · **Effort:** Med-High.

### 3. ⭐ Column-level lineage (free byproduct of graph→SQL compilation)
**What:** Trace any output column back through every node that touched it to its source
column(s). Interactive overlay: "what feeds `revenue` / what breaks if I drop `customer_id`."
**Why it matters:** Impact analysis is the #1 thing senior data engineers miss in visual tools.
It answers the "if I change this, what downstream explodes?" question before you hit Run.
**Quilt fit:** Quilt *already compiles the node graph to SQL* — column lineage falls out of
parsing that SQL (a Rust SQL parser / sqlglot-style pass over the staged statements). No external
metadata server, no manual tagging. This is a differentiator precisely because it's a free
side effect of the architecture nobody else has locally.
**Edge:** High · **Fit:** High · **Effort:** Med.

### 4. ⭐ Pipeline unit tests + golden datasets
**What:** Capture a node's expected output as a golden table. A test run asserts
`output == golden`, supports mock/swap inputs and node bypass, and emits a pass/fail report.
CI-runnable headless.
**Why it matters:** Validators check *data*; this checks the *pipeline logic* against
regressions when a dependency, source schema, or your own edit changes behavior. Apache Hop
unit tests + KNIME Table Difference Checker prove the demand.
**Quilt fit:** Ideal — golden tables are plain files in the git workspace; the diff is a DuckDB
`EXCEPT` / anti-join. Pairs with the existing headless runner for CI.
**Edge:** High · **Fit:** High · **Effort:** Med.

---

## Tier 2 — High-value, quicker, or narrower

### 5. ✅ ASOF JOIN node ("As-Of Merge")
**What:** A time-series join node — match each left row to the nearest-prior (or nearest-next)
right row within a tolerance window, no exact key required. Compiles to DuckDB `ASOF JOIN`.
**Why it matters:** DuckDB-unique superpower. Aligning quotes↔trades, sensor↔event, price↔order
by irregular timestamps is painful everywhere else (pandas users hand-roll it). Given your
DeFi / market-data background this is directly in your wheelhouse.
**Edge:** High · **Fit:** High (DuckDB-native) · **Effort:** Med.

### 6. ✅ Inline column profiling on the preview tab
**What:** Overlay per-column stats *directly on every preview*: null/blank %, distinct count,
min/max/mean, a tiny distribution sparkline, a data-quality bar. Always-on, not a separate node.
**Why it matters:** The Column Profile *node* already exists (SUMMARIZE), but Alteryx's most-loved
feature is that the stats are *right there on the browse output* — "bugs spring to sight" without
adding a node and re-running. This is a UX surfacing of capability you already have.
**Edge:** Med · **Fit:** High · **Effort:** Low-Med.

### 7. ✅ Run-to-run data diff (snapshot → edit → compare)
**What:** Snapshot a node's output, change the pipeline, then compare new vs old at row/cell
level ("3 rows changed, 1 added, `total` shifted on 12 rows").
**Why it matters:** Confidence that a refactor didn't silently change results. Distinct from the
CDC Diff Detect transform (which compares two *data inputs*) — this compares two *runs of the
same node over time*.
**Edge:** Med · **Fit:** High · **Effort:** Med.

### 8. ✅ Data contracts (ODCS) — author, bind, enforce
**What:** Author or import an Open Data Contract Standard YAML; bind it to a source/sink node;
fail the run on schema / quality / freshness breach. Schema-evolution diff classifies changes
as breaking vs safe.
**Why it matters:** Producer/consumer schema drift breaks pipelines silently. Contracts make the
expectation explicit and git-tracked alongside the pipeline JSON.
**Edge:** Med-High (for serious DEs) · **Fit:** High · **Effort:** Med.

---

## Tier 3 — Cheap wins / good citizenship

### 9. 🔹 Canvas annotations + auto-generated pipeline docs
Sticky annotation regions, per-node descriptions, one-click export to Markdown/HTML.
Table-stakes (KNIME has it) but currently absent and cheap. Ship it; don't market it.
**Edge:** Low · **Fit:** Med · **Effort:** Low.

### 10. 🔹 OpenLineage event emission
Emit OpenLineage run/job/dataset events per stage to any OL endpoint (Marquez / DataHub /
Datadog). Makes Quilt a citizen of an enterprise lineage backend instead of a silo. You already
have run history — it's a JSON POST per stage.
**Edge:** Low (table-stakes for enterprise) · **Fit:** Med · **Effort:** Low.

---

## AI tier — additive on top of Qunnie (don't rebuild what exists)

Qunnie already does NL→pipeline, agentic ReAct, graph edits w/ HITL, and the AI transforms
(LLM/classify/embed/chunk/PII/semantic-dedupe) ship. The genuinely *additive* next steps:

### A1. ⭐ Execution-grounded self-correcting SQL + deterministic AST repair
Run generated SQL in DuckDB; on error, feed the message back (≤3 loops) **and** run a SQLGlot-style
AST pass that rewrites wrong `table.column` refs against the real schema. Kills the two most common
LLM-SQL failures deterministically instead of by prompt-begging. **Effort:** Low-Med (the loop exists).

### A2. ✅ Profiling-grounded DQ rule generation, execution-pruned
LLM drafts quality checks from column stats + your intent → runs each against real data →
**drops rules that always pass** (no signal) → emits the survivors as assertion nodes. Solves the
"arbitrary threshold / noisy test" problem reviewers hate. Best non-obvious AI idea found. **Effort:** Low-Med.

### A3. ✅ AI data profiling → auto-documentation
Background-profile each column, then one LLM pass writes column/node descriptions + semantic types
(id / date / currency / measure / category). Feeds #6 and better SQL. **Effort:** Low.

### A4. 🔹 Joinability discovery + AI auto-join
Column-overlap (Jaccard/containment, cheap in DuckDB) + embedding similarity → candidate joins,
LLM reranks, surfaced as suggested connect-node edits behind the existing Approve gate.
Auto-join messy CSVs with no declared FKs. **Effort:** Med.

---

## My honest recommendation (if I had to pick 5)

Build, in order: **#1 incremental re-run**, **#3 column-level lineage**, **#5 ASOF join**,
**#4 pipeline unit tests**, **#2 reusable components**. Reasoning:
- **#1 + #3** transform the everyday experience and both exploit the architecture you already have
  (staged SQL → cache; compiled SQL → lineage). Highest leverage per line of code.
- **#5** is a fast, self-contained DuckDB-unique win that markets itself and fits your market-data domain.
- **#4 + #2** are what turn Quilt from "a nice tool" into "a tool a team standardizes on" — testing
  and reuse are the difference between a toy and infrastructure.

Sprinkle **A1 + A2** into Qunnie alongside — they make the assistant trustworthy rather than flashy,
which matches the honest-over-hype stance the README already takes.

---

## Rejected (already shipped — verified in code, do NOT re-propose)

| Idea from research | Why rejected |
|---|---|
| SUMMARIZE profiling *node* | Exists — `builders.rs:1717` Column Profile (the *inline overlay* #6 is still a gap) |
| USING SAMPLE / sample mode | Exists — `builders.rs:375` + Random/Reservoir/Bernoulli in manifest |
| DuckLake snapshots / time-travel / `table_changes` | Exists — CDC change-feed reader uses it (`specs.rs`) |
| UNNEST / flatten / explode | Exists — Array transforms |
| Fuzzy match / dedup / record match | Exists — Data quality (Fuzzy Deduplicate, Record Match) |
| Top-N per group (QUALIFY) | Exists — Rows transform "Top N per Group" |
| Basic NL→pipeline, per-row LLM, embeddings, chunk, regex PII, vector search | All ship today |
| Distributed engine · hosted SaaS · deep time-travel debugger | Explicit non-goals |
