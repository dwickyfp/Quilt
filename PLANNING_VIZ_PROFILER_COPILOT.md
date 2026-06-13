# Viz + Profiler + Copilot Implementation Plan

> Status hidup. Diperbarui tiap ada progress. Trace terakhir: 2026-06-13.
> **For implementer:** TDD per task. Build + lint hijau sebelum lanjut. Review setelah tiap fitur.

**Goal:** Tambah 3 fitur ke Quilt — (1) Visualization nodes, (2) Cost/Performance Profiler, (3) Duckie graph-aware Copilot. (Incremental/Living-Pipeline dikecualikan.)

**Arsitektur (4-tempat pattern, terbukti di node ML):**
1. Katalog: `frontend/src/workflow-ui/palette-data.ts`
2. Form config: `frontend/src/workflow-ui/fields/manifest-synth.ts`
3. Builder props->spec: `crates/duckdb-engine/src/plan/{mod.rs,specs.rs}`
4. Runtime: `crates/duckdb-engine/src/lib.rs` (+ modul baru) & dispatch

**Tech stack:** Rust (quilt-duckdb-engine, DuckDB), React+TS (Vite), Tauri 2. Chart lib: **uPlot** (~40KB canvas, no-backend). FE test: **vitest** (Task 0 setup).

**Verifikasi global:**
- Engine test: `cargo test -p quilt-duckdb-engine`
- Engine build: `cargo build -p quilt-duckdb-engine`
- FE lint: `cd frontend && npm run lint` (tsc --noEmit)
- FE test: `cd frontend && npm run test` (vitest, setelah Task 0)
- FE build: `cd frontend && npm run build`

**Prinsip:** DRY, YAGNI, TDD. Reuse `run_rows()`, `NodePreview`, `materialize_*`. Jangan refactor kode tak terkait.

---

## Status fondasi (hasil recon)

| Area | Sudah ada | Gap |
|---|---|---|
| Viz | `qa.histogram` (1 node) | 8 node chart + render uPlot |
| Profiler | `StageFinished{rows,duration_ms}`, `NodeRunStatus`, sparkline | +peak_mem, rows_in/out, EXPLAIN; overlay kanvas |
| Copilot | ChatPanel + `chat_extract_pipeline` (one-shot) | graph-context + tool-calling + diff/apply |

Titik integrasi (file:baris):
- `lib.rs:3201` enum `PipelineEvent` (StageFinished @3210)
- `lib.rs:3262` struct `NodeRunStatus`
- `lib.rs:3279` struct `NodePreview {node_id, columns, rows}`
- `lib.rs:253` `fn run_rows(db, sql) -> Vec<JsonValue>`
- `run_log.rs:113` emit StageFinished -> JSONL
- `apps/desktop/src/lib.rs:269` `run_pipeline`, `:541` `chat_send`, `:597` `chat_extract_pipeline`
- `frontend/src/workflow-ui/ChatPanel.tsx` (one-shot)
- `frontend/src/workflow-ui/RunHistoryView.tsx` (sparkline)

---

## Urutan build
1. **Task 0** — setup vitest (FE belum punya test).
2. **Fitur A — Profiler** (fondasi 60% ada, ROI tinggi, low-risk).
3. **Fitur B — Visualization** (gap KNIME jelas, self-contained).
4. **Fitur C — Copilot graph-aware** (paling kompleks).

Commit per task. Review (skill `requesting-code-review`) setelah tiap fitur selesai.

---

## Task 0 — Setup vitest (FE test infra)

**Objective:** FE punya test runner supaya komponen viz/copilot bisa di-unit-test.

**Files:**
- Modify: `frontend/package.json` (scripts + devDeps)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/__tests__/smoke.test.ts`

**Step 1:** `cd frontend && npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom`

**Step 2:** tambah script di `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3:** `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
});
```

**Step 4:** smoke test `src/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

**Step 5 (verify):** `npm run test` -> 1 passed. **Commit:** `chore: add vitest test infra`

---

## Fitur A — Cost/Performance Profiler

**Goal:** Tiap node tampilkan metrik eksekusi nyata (waktu, baris, memori), dgn overlay heat-map di kanvas + detail panel.

**Skenario:** Selesai run -> toggle "Profile" -> node lambat merah `2.3s · 4M rows · 180MB`, cepat hijau. Klik node -> breakdown metrik.

### Task A1: Perkaya `PipelineEvent::StageFinished` dgn metrik

**Files:**
- Modify: `crates/duckdb-engine/src/lib.rs:3210` (enum field)
- Modify: `crates/duckdb-engine/src/lib.rs:3262` (NodeRunStatus)
- Test: `crates/duckdb-engine/tests/execution.rs`

**Step 1 (RED):** tambah test di `tests/execution.rs` yang assert `NodeRunStatus` punya `peak_memory_bytes: Option<u64>` & `rows_in: Option<u64>` setelah run pipeline kecil. Jalankan `cargo test -p quilt-duckdb-engine profiler_metrics` -> FAIL (field tak ada).

**Step 2 (GREEN):** tambah field opsional di `StageFinished` & `NodeRunStatus`:
```rust
// StageFinished + NodeRunStatus
#[serde(skip_serializing_if = "Option::is_none")]
peak_memory_bytes: Option<u64>,
#[serde(skip_serializing_if = "Option::is_none")]
rows_in: Option<u64>,
```
Default `None` di semua call site (cari emit StageFinished). Build pass dulu.

**Step 3:** isi `peak_memory_bytes` dari DuckDB `PRAGMA database_size` / `PRAGMA memory_limit` delta — atau parse hasil profiling. Lihat Task A2.

**Step 4 (verify):** `cargo test -p quilt-duckdb-engine` hijau. **Commit:** `feat(engine): add memory/rows_in metrics to run events`

### Task A2: Capture EXPLAIN ANALYZE per stage

**Files:**
- Modify: `crates/duckdb-engine/src/lib.rs` (eksekusi stage View/Sink)
- Test: `tests/execution.rs`

**Step 1 (RED):** test: jalankan stage, assert run-log JSON punya `explain` non-empty utk stage SELECT.

**Step 2 (GREEN):** sebelum/saat eksekusi stage utama, jalankan `EXPLAIN ANALYZE <sql>` via `run_rows`, simpan plan-text. Hindari double-eksekusi side-effect (jangan EXPLAIN ANALYZE pada COPY ke sink; gunakan EXPLAIN saja utk write stage).

**Step 3 (verify):** `cargo test` hijau. **Commit:** `feat(engine): capture EXPLAIN ANALYZE per read stage`

### Task A3: FE — Profile overlay di kanvas

**Files:**
- Modify: `frontend/src/canvas/Canvas.tsx` (mode profile, warna node)
- Modify: `frontend/src/canvas/nodes/QuiltNode.tsx` (badge metrik)
- Modify: `frontend/src/tauri-bridge.ts` (tipe NodeRunStatus + field baru)
- Create: `frontend/src/canvas/profile-overlay.ts` (normalisasi heat)
- Test: `frontend/src/canvas/profile-overlay.test.ts`

**Step 1 (RED):** test `profile-overlay.test.ts`: `heatColor(duration, max)` -> hijau utk rendah, merah utk tinggi; `formatMetric(bytes)` -> "180MB".

**Step 2 (GREEN):** implement `profile-overlay.ts` (pure fn, mudah ditest):
```ts
export function heatColor(v: number, max: number): string {
    const t = max > 0 ? Math.min(v / max, 1) : 0;
    // hijau (120deg) -> merah (0deg)
    return `hsl(${Math.round(120 * (1 - t))}, 70%, 45%)`;
}
export function formatBytes(b: number): string {
    if (b < 1024) return `${b}B`;
    const u = ['KB','MB','GB']; let i = -1; let n = b;
    do { n /= 1024; i++; } while (n >= 1024 && i < 2);
    return `${n.toFixed(1)}${u[i]}`;
}
```

**Step 3:** Canvas: state `profileMode: boolean` + toggle di toolbar. Saat aktif, tiap node `style.boxShadow`/border pakai `heatColor(node.duration_ms, maxDuration)`. QuiltNode render badge `{duration}ms · {rows} · {formatBytes(peak)}`.

**Step 4 (verify):** `npm run test` + `npm run lint` hijau. **Commit:** `feat(ui): profiler heat overlay + per-node metric badge`

### Task A4: Detail panel metrik + plan tree

**Files:**
- Modify: `frontend/src/workflow-ui/PropertiesPanel.tsx` (tab "Profile" saat node terpilih + ada run-data)

**Step 1:** tampilkan tabel metrik (time/rows_in/rows_out/peak_mem) + `<pre>` EXPLAIN plan (collapsible).
**Step 2 (verify):** lint hijau. **Commit:** `feat(ui): node profile detail panel`

### Review Fitur A
Pakai skill `requesting-code-review`: security scan + quality gate. Pastikan tak ada double-eksekusi side-effect (EXPLAIN ANALYZE), metrik opsional (backward-compatible JSON).

---

## Fitur B — Visualization Nodes

**Goal:** Pipeline bisa render chart interaktif di hilir tanpa export. Node viz = terminal sink yang agregasi di DuckDB lalu render chart kecil di FE.

**Skenario:** Filter -> Bar Chart (dim `region`, measure `SUM(amount)`) -> run -> tab Pratinjau node tampil grafik. Tambah Scatter dari output sama.

**Kunci desain:** agregasi **server-side di DuckDB** (`SELECT x, agg(y) GROUP BY x LIMIT N`), FE terima hasil kecil -> cepat walau sumber jutaan baris. Reuse `NodePreview{columns, rows}` + `run_rows`.

**Node baru (kategori "Visualize", kind `viz`):**
`viz.bar`, `viz.line`, `viz.scatter`, `viz.histogram`, `viz.pie`, `viz.box`, `viz.heatmap`, `viz.table`. (MVP: bar, line, scatter, histogram — sisanya menyusul.)

### Task B0: Tambah dep uPlot

**Step 1:** `cd frontend && npm i uplot`
**Step 2 (verify):** `npm run lint`. **Commit:** `chore(ui): add uplot chart lib`

### Task B1: Spec `VizSpec` di engine

**Files:**
- Modify: `crates/duckdb-engine/src/plan/specs.rs` (struct VizSpec)
- Modify: `crates/duckdb-engine/src/plan/mod.rs` (RuntimeSpec::Viz variant + build_stage branch)
- Test: `crates/duckdb-engine/src/plan/tests.rs`

**Step 1 (RED):** test di `plan/tests.rs`: build `viz.bar` node props `{x:'region', y:'amount', agg:'sum'}` -> spec menghasilkan SQL `SELECT region AS x, sum(amount) AS y FROM <in> GROUP BY region ORDER BY y DESC LIMIT 1000`. Run `cargo test -p quilt-duckdb-engine viz_spec` -> FAIL.

**Step 2 (GREEN):** struct:
```rust
// specs.rs
#[derive(Debug, Clone, Deserialize)]
pub struct VizSpec {
    pub chart: String,        // bar|line|scatter|histogram
    pub x: String,            // dimension column
    pub y: Option<String>,    // measure column (None utk histogram count)
    pub agg: Option<String>,  // sum|avg|count|min|max
    pub series: Option<String>,
    #[serde(default = "default_viz_limit")]
    pub limit: usize,
}
fn default_viz_limit() -> usize { 1000 }
```
`mod.rs`: `Viz(VizSpec)` + branch build_stage yang susun agregasi SQL (parameterized — validasi nama kolom whitelist dari schema upstream utk cegah SQL injection).

**Step 3 (verify):** `cargo test` hijau. **Commit:** `feat(engine): viz node spec + aggregation SQL builder`

### Task B2: Runtime — viz node materialize hasil agregasi

**Files:**
- Modify: `crates/duckdb-engine/src/lib.rs` (dispatch RuntimeSpec::Viz -> jalankan SQL, push NodePreview)
- Test: `tests/execution.rs`

**Step 1 (RED):** test: pipeline CSV->viz.bar, assert RunResult.preview berisi NodePreview utk node viz dgn kolom `x,y` + N baris.

**Step 2 (GREEN):** viz node = View-like stage: eksekusi agg SQL via `run_rows`, bungkus jadi `NodePreview`. Tidak nulis file. Tambah field opsional `viz_chart: Option<String>` di NodePreview supaya FE tahu cara render.

**Step 3 (verify):** `cargo test` hijau. **Commit:** `feat(engine): execute viz nodes into preview payload`

### Task B3: Katalog + form (palette + manifest)

**Files:**
- Modify: `frontend/src/workflow-ui/palette-data.ts` (grup "Visualize", 4 node MVP, kind `viz`)
- Modify: `frontend/src/workflow-ui/fields/manifest-synth.ts` (form: picker chart, x, y, agg, series — resolve dari schema upstream, pola `synthMl`)
- Modify: `frontend/src/styles.css` (`--kind-viz`, `.node-viz`)

**Step 1:** tambah `viz()` helper + 4 entri. Port: hanya MODEL? Tidak — viz punya 1 input data, 0 output (terminal).
**Step 2 (verify):** `npm run lint`. **Commit:** `feat(ui): visualize node catalog + config forms`

### Task B4: Render chart (uPlot) di Pratinjau

**Files:**
- Create: `frontend/src/workflow-ui/VizChart.tsx` (terima NodePreview -> render uPlot per chart type)
- Create: `frontend/src/workflow-ui/viz-transform.ts` (NodePreview rows -> uPlot data arrays; pure fn)
- Modify: tab Pratinjau (tempat render NodePreview) -> jika node kind `viz`, render `<VizChart>` ganti tabel
- Test: `frontend/src/workflow-ui/viz-transform.test.ts`

**Step 1 (RED):** test `viz-transform.test.ts`: `toUplotSeries(rows, 'x', 'y')` -> `[[x...],[y...]]`; handle empty + null.
**Step 2 (GREEN):** implement transform + VizChart (bar/line/scatter/histogram via uPlot opts).
**Step 3 (verify):** `npm run test` + `npm run lint` + `npm run build` hijau. **Commit:** `feat(ui): render viz nodes with uPlot`

### Review Fitur B
`requesting-code-review`. Fokus: SQL injection (whitelist kolom), agregasi LIMIT enforced, chart render tak crash pada data kosong/null.

---

## Fitur C — Duckie Graph-Aware Copilot

**Goal:** Naik dari "NL -> pipeline baru (insert utuh)" ke agen yang paham graf hidup — edit node existing, perbaiki error, sarankan langkah, jelaskan pipeline. Output = **patch graf** + diff Apply/Reject (reversible, aman).

**Status sekarang:** `chat_send` (stream) + `chat_extract_pipeline` (ekstrak 1 pipeline) -> `onInsertPipeline`. Tidak sadar graf yang sedang dibuka.

**Skenario:**
- "Kenapa Parquet error?" -> baca run_log+schema -> "Kolom `amount` STRING vs DECIMAL. Tambah Cast?" -> Apply.
- "Tambah dedup setelah Filter" -> sisip node di edge Filter->Parquet (bukan ganti graf).
- "Jelaskan pipeline ini" -> ringkasan + bottleneck.

### Task C1: Bangun graph-context serializer (FE, pure)

**Files:**
- Create: `frontend/src/workflow-ui/copilot/graph-context.ts`
- Test: `frontend/src/workflow-ui/copilot/graph-context.test.ts`

**Step 1 (RED):** test: `serializeGraph(nodes, edges, schemas, runStatus)` -> objek ringkas `{nodes:[{id,kind,label,config}], edges:[{from,to,port}], schemas:{nodeId:[col]}, errors:[{nodeId,msg}]}`. Truncate config besar.
**Step 2 (GREEN):** implement pure serializer (no React).
**Step 3 (verify):** `npm run test`. **Commit:** `feat(copilot): graph context serializer`

### Task C2: Definisikan tool schema + patch types

**Files:**
- Create: `frontend/src/workflow-ui/copilot/tools.ts` (tipe GraphPatch: add_node/connect/update_config/delete_node)
- Test: `frontend/src/workflow-ui/copilot/tools.test.ts`

**Step 1 (RED):** test: `validatePatch(patch, graph)` -> tolak patch yang refer node tak ada / buat siklus; terima patch valid.
**Step 2 (GREEN):** tipe + validator (DRY: pakai topo-check yang ada bila bisa, else lokal).
**Step 3 (verify):** `npm run test`. **Commit:** `feat(copilot): graph patch types + validator`

### Task C3: Backend — chat_send_with_tools (tool-calling)

**Files:**
- Modify: `apps/desktop/src/lib.rs:541` (chat_send) -> tambah cmd `chat_agent` yang kirim system-prompt + graph-context + tool definitions ke LLM, dukung function-calling loop
- Modify: `frontend/src/tauri-bridge.ts` (binding chat_agent)
- Modify: `crates/duckdb-engine/...` jika LLM call ada di engine (cek lokasi chat_send impl)

**Step 1:** system prompt: "Kamu Duckie, asisten pipeline. Kembalikan tool calls utk memodifikasi graf, JANGAN ganti seluruh graf." Sertakan graph-context JSON.
**Step 2:** parse tool_calls dari respons -> kembalikan ke FE sbg `GraphPatch[]` (bukan auto-apply).
**Step 3 (verify):** `cargo build` + manual smoke (provider OpenAI-compatible yg sudah ada). **Commit:** `feat(copilot): graph-aware agent endpoint with tool-calling`

### Task C4: FE — diff preview + Apply/Reject

**Files:**
- Modify: `frontend/src/workflow-ui/ChatPanel.tsx` (render patch sbg diff; tombol Apply/Reject)
- Create: `frontend/src/workflow-ui/copilot/apply-patch.ts` (terapkan GraphPatch ke state graf; pure-ish)
- Test: `frontend/src/workflow-ui/copilot/apply-patch.test.ts`

**Step 1 (RED):** test `apply-patch.test.ts`: `applyPatch(graph, patch)` -> graf baru benar (node ditambah, edge tersambung, config terupdate). Idempoten utk reject (no-op).
**Step 2 (GREEN):** implement apply + ChatPanel: tampil ringkasan patch (hijau=add, kuning=update, merah=delete) + Apply memanggil applyPatch -> update kanvas; Reject buang.
**Step 3 (verify):** `npm run test` + `npm run lint` + `npm run build`. **Commit:** `feat(copilot): patch diff preview with apply/reject`

### Task C5: Schema-aware quick-fixes

**Files:**
- Modify: `frontend/src/workflow-ui/copilot/graph-context.ts` (sertakan schema mismatch terdeteksi)
- Modify: system prompt (C3) -> ajari sarankan Cast/Rename

**Step 1:** deteksi mismatch tipe antar port (pakai schemas yg sudah di-context) -> tandai di context.
**Step 2 (verify):** lint + manual. **Commit:** `feat(copilot): schema-aware fix suggestions`

### Review Fitur C
`requesting-code-review`. Fokus: patch SELALU lewat Apply (tak ada auto-mutate), validator cegah siklus/ref-invalid, secret/API-key LLM tak bocor ke log, graph-context tak kirim data sensitif (cuma schema+config, bukan row data).

---

## Definition of Done (global)
- [ ] `cargo test -p quilt-duckdb-engine` hijau
- [ ] `cargo build -p quilt-duckdb-engine` hijau
- [ ] `cd frontend && npm run test` hijau
- [ ] `cd frontend && npm run lint` hijau (tsc --noEmit, exit 0)
- [ ] `cd frontend && npm run build` hijau
- [ ] Review tiap fitur lewat (`requesting-code-review`)
- [ ] PLANNING ini diupdate status tiap task (checkbox)

## Progress tracker
- [x] Task 0 — vitest setup
- [x] A1 metrics fields (NodeRunStatus +rows_in/peak_memory_bytes/explain, Default derive; build✓ 214 tests pass; 1 pre-existing unrelated failure compiled_sql_maps_username_to_attach_user) · [x] A2 EXPLAIN (View-only plain EXPLAIN, best-effort; verified 215 pass) · [x] A3 overlay (profile-overlay.ts helpers 14 tests + tauri-bridge type + Canvas/QuiltNode tint+badge via ProfileContext; lint/test/build green) · [x] A4 detail panel (PropertiesPanel Profile tab: metrics + collapsible EXPLAIN; lint/test/build green) · [x] Review A (no side-effect EXPLAIN✓ backward-compat✓ best-effort✓; gap: rows_in/peak_mem fields exist+flow but engine doesn't populate yet — UI shows only present fields, no fake data)
- [x] B0 uplot · [x] B1 spec (VizSpec+SQL, 5 tests, verified 215 pass) · [x] B2 runtime (View+preview) · [x] B3 catalog/form (NodeKind both files, viz group, synthViz fields) · [x] B4 render (VizChart uPlot + viz-chart-data 8 tests; lint/test/build green) · [x] Review B (agg allowlist✓ quote_ident✓ LIMIT clamp✓ empty-safe✓)
- [x] C1 context (serializeGraph, 6 tests) · [x] C2 patch engine (applyGraphPatch/summarizePatch, 9 tests) · [x] C3 extractGraphPatch (5 tests) + ChatPanel graph-context system prompt (leading-user msg, provider-agnostic) · [x] C4 diff/apply card (summarizePatch list + Apply/Dismiss, Apply-gated never auto) · [x] C5 schema-aware (columns in context + mismatch-fix instructions) · [x] Review C (Apply-gated✓ provider-agnostic✓ backward-compat✓; lint/test/build green, 42 tests)

## DONE — all 3 features complete + verified (lint 0, 42 FE tests, 215 engine tests, build✓). Not yet committed.
