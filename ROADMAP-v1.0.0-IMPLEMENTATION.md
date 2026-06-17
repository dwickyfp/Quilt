# Quilt v1.0.0 — Implementation Plan

> Deep dive & implementation strategy for all 9 roadmap items.
> Generated: 2026-06-17 | Target: v1.0.0 release

---

## Overview & Phasing

9 features, organized into 4 phases based on dependencies and effort:

| Phase | Features | Effort | Dependencies |
|-------|----------|--------|-------------|
| **Phase 1** (Core Engine) | Python Scripting, Text Mining, Association Rules | ~4-5 weeks | None |
| **Phase 2** (ML Explainability) | SHAP / XAI Values | ~2-3 weeks | Existing ML models |
| **Phase 3** (Frontend) | More Charts, Interactive Widgets, PDF/HTML Reports | ~3-4 weeks | None |
| **Phase 4** (Advanced) | Streaming Execution, Components Sharing | ~3-4 weeks | Phase 1 complete |

---

## Phase 1: Core Engine Features

### 1.1 Python Scripting Node (`code.python`)

**Approach: Subprocess with Parquet IPC (like KNIME + dbt pattern)**

Why subprocess over PyO3:
- No Python linking at build time (avoids bundling CPython ~50-100MB)
- Crash isolation (segfault in numpy kills subprocess, not Tauri app)
- User gets their own Python with whatever packages they installed
- Follows existing `code.shell` and `xf.dbt` patterns

**Architecture:**
```
Engine (Rust)
  1. COPY upstream → /tmp/.../input.parquet
  2. Spawn: python3 runner.py --input input.parquet --output output.parquet --script user.py
  3. Read back output.parquet → CREATE TABLE
```

**User API:**
```python
# df = pandas DataFrame with upstream data
result = df[df['amount'] > 100]
result['tax'] = result['amount'] * 0.1
```

**Spec:**
```rust
pub struct PythonSpec {
    pub node_id: String,
    pub script: String,
    pub python_bin: Option<String>,  // default: QUILT_PYTHON_BIN / python3
    pub timeout_ms: Option<u64>,
    pub packages: Option<Vec<String>>,  // pip install before run
}
```

**Files (4-place pattern):**
1. `palette-data.ts` — add `code.python` entry
2. `manifest-synth.ts` — Monaco code editor field
3. `builders.rs` — build PythonSpec
4. `connectors.rs` — `run_python()` method (model after `run_shell()` + `run_dbt()`)
5. `specs.rs` — PythonSpec struct
6. Inline `runner.py` as `include_str!()`

**Effort: 5-7 days**
- Day 1-2: Spec + builder + runtime (Parquet in/out)
- Day 3-4: runner.py + error handling + timeout
- Day 5: Frontend (Monaco editor integration)
- Day 6-7: Testing + cross-platform (macOS/Linux/Windows)

---

### 1.2 Text Mining Suite

**Approach: DuckDB SQL for tokenize/TF-IDF, Rust crate for sentiment/NER**

| Node | Implementation | Crate/Method | Effort |
|------|---------------|-------------|--------|
| `tm.tokenize` | DuckDB SQL | `regexp_split_to_table()` + UNNEST + stopword anti-join | 1-2 days |
| `tm.tfidf` | DuckDB SQL | Multi-CTE pipeline (TF × IDF) | 2-3 days |
| `tm.sentiment` | Rust | `vader-sentimental` (pure Rust, VADER algorithm) | 3-4 days |
| `tm.langdetect` | Rust | `whatlang` (pure Rust, 70 languages) | 1 day |
| `tm.ner` | Rust (Phase 2) | Rule-based NER with dictionary matching | 5-7 days |

**Tokenize SQL pattern:**
```sql
-- Split text into tokens, remove stopwords
WITH tokens AS (
    SELECT id, UNNEST(regexp_split_to_table(text, '\s+')) AS token
    FROM input
),
filtered AS (
    SELECT t.id, LOWER(t.token) AS token
    FROM tokens t
    ANTI JOIN stopwords s ON LOWER(t.token) = s.word
    WHERE LENGTH(t.token) > 2
)
SELECT id, token FROM filtered
```

**TF-IDF SQL pattern:**
```sql
WITH tf AS (
    SELECT doc_id, token, COUNT(*)::DOUBLE / SUM(COUNT(*)) OVER (PARTITION BY doc_id) AS tf
    FROM tokens GROUP BY doc_id, token
),
idf AS (
    SELECT token, LN(COUNT(DISTINCT doc_id)::DOUBLE / COUNT(DISTINCT doc_id)) AS idf
    FROM tokens GROUP BY token
)
SELECT tf.doc_id, tf.token, tf.tf * idf.idf AS tfidf
FROM tf JOIN idf USING (token)
```

**New Rust deps:**
- `vader-sentimental = "0.1.3"` (VADER sentiment, pure Rust)
- `whatlang = "0.18.0"` (language detection, pure Rust)

**Effort: 8-10 days total**

---

### 1.3 Association Rules

**Approach: Rust crate `rust-rule-miner`**

| Node | Algorithm | Output | Effort |
|------|-----------|--------|--------|
| `tm.apriori` | Apriori | Rules with support/confidence/lift/conviction | 3 days |
| `tm.fpgrowth` | FP-Growth | Same output format | 3 days |

**Spec:**
```rust
pub struct AssociationRulesSpec {
    pub node_id: String,
    pub algorithm: String,  // "apriori" or "fpgrowth"
    pub min_support: f64,   // default 0.01
    pub min_confidence: f64, // default 0.5
    pub min_lift: f64,      // default 1.0
    pub item_column: String, // column with item IDs
    pub transaction_column: String, // column with transaction IDs
}
```

**Output format (per rule):**
```json
{"antecedent": ["A","B"], "consequent": ["C"], "support": 0.05, "confidence": 0.8, "lift": 2.3, "conviction": 1.5}
```

**New Rust dep:** `rust-rule-miner = "0.2.2"` (pure Rust, Apriori + FP-Growth)

**Effort: 6-8 days total**

---

## Phase 2: ML Explainability (SHAP / XAI)

### 2.1 Architecture Decision: Native Rust TreeSHAP

Why NOT use existing crates:
- `sklears-tree` — too heavy (pulls in full sklearn-compatible framework)
- `treeshap-rs` — only XGBoost/LightGBM parsers, not Quilt's JSON format
- Quilt already owns the tree structure in JSON — direct implementation is ~200 LOC

### 2.2 Phased XAI Rollout

| Phase | Models | Method | Complexity | Effort |
|-------|--------|--------|-----------|--------|
| **Phase 2a** | Linear (LogReg, LinReg, Ridge, Lasso, ElasticNet) | Exact SHAP: `coeff_i × (x_i - mean_i)` | O(1) per feature | 1-2 days |
| **Phase 2b** | Tree/Forest/Gbm | TreeSHAP (recursive tree traversal) | O(TLD²) per sample | 1-2 weeks |
| **Phase 2c** | IsoForest | DIFFI path-length decomposition | O(T×depth) | 2-3 days |
| **Phase 2d** | Svc/Svr/MLP/XgbMulti | KernelSHAP (model-agnostic) | O(n_coalitions × n_samples) | 1 week |

### 2.3 TreeSHAP Algorithm (for Phase 2b)

Core idea: for each sample, traverse each tree. Track "hot" fraction (probability of reaching current node via the sample's path) and "cold" fraction (probability via the alternative path). The difference in expected prediction between hot and cold paths gives the SHAP value for each feature.

```rust
fn tree_shap(tree: &Tree, x: &[f64]) -> Vec<f64> {
    let mut phi = vec![0.0; x.len()]; // SHAP values per feature
    let root = 0;
    let p_hot = 1.0;  // probability of reaching via sample's path
    let p_cold = 1.0; // probability of reaching via alternative path
    recursive_shap(tree, x, root, p_hot, p_cold, &mut phi);
    phi
}
```

**Parallelism:** Use Rayon to compute SHAP values across samples in parallel.

### 2.4 Frontend Visualization

Recommended: **Custom React components** (not shapjs — it's React 15 only).

| Chart | Purpose | Implementation |
|-------|---------|---------------|
| **Beeswarm plot** | SHAP values per feature, colored by feature value | Horizontal dot plot (d3-scale) |
| **Waterfall plot** | Cumulative feature contributions per prediction | Stacked bar chart |
| **Summary bar** | Mean \|SHAP\| per feature | Simple bar chart |
| **Dependence plot** | SHAP value vs feature value | Scatter plot with trend |

**Data format from backend:**
```json
{
  "shap_values": [[0.1, -0.3, 0.5], ...],
  "base_value": 0.42,
  "feature_names": ["age", "income", "score"],
  "feature_values": [[25, 50000, 0.8], ...]
}
```

**New node:** `ml.shap.explain` — takes a trained model + data, outputs SHAP values table.

**Effort: 2-3 weeks total**

---

## Phase 3: Frontend Features

### 3.1 More Chart Types

| Chart | Library | Implementation | Effort |
|-------|---------|---------------|--------|
| Heatmap | Custom SVG + d3-scale | Grid of colored cells with value labels | 2 days |
| Sunburst | d3-hierarchy | Nested arc chart for hierarchical data | 3 days |
| Parallel Coordinates | d3 + SVG | Multi-axis line chart for high-dimensional data | 3 days |
| ROC Curve | Custom SVG | TPR vs FPR with AUC annotation | 2 days |

**Integration:** Add to existing `frontend/src/workflow-ui/charts/` directory. Each chart is a standalone React component that takes a data table as input.

**Effort: 10 days**

### 3.2 Interactive Widgets

For building data apps / dashboards from pipelines:

| Widget | Input | Output | Effort |
|--------|-------|--------|--------|
| Slider | min/max/step | Filter condition (e.g. `value >= X`) | 2 days |
| Dropdown | options list | Filter condition | 2 days |
| File Upload | file picker | Data table (CSV/Parquet/Excel) | 3 days |
| Date Picker | date range | Filter condition | 2 days |

**Architecture:** Widgets are special nodes that emit filter parameters. When a pipeline is "published" as a data app, widgets become interactive controls in a dashboard view.

**New concept:** `app.mode` — when a pipeline is run in app mode, widget nodes render as interactive controls instead of executing once.

**Effort: 9-10 days**

### 3.3 PDF / HTML Report Generation

**Approach: HTML template → PDF via headless browser (or direct HTML export)**

| Method | Pros | Cons |
|--------|------|------|
| **HTML + print to PDF** | No native deps, full CSS support | Needs headless browser or user action |
| **Rust `printpdf` crate** | Native PDF generation | Limited layout, no CSS |
| **`wkhtmltopdf` subprocess** | Good PDF quality | External binary dependency |

**Recommended: HTML-first approach**
1. Generate a self-contained HTML report with embedded CSS + inline SVG charts
2. Optional: use Tauri's `webview.print_to_pdf()` for PDF export (built-in, no extra deps)
3. Report template uses Jinja2-like syntax (or JSX-like in Rust with `maud` crate)

**Report components:**
- Pipeline metadata (name, author, date, description)
- Data summary (row count, column stats)
- Chart snapshots (static SVG renders of pipeline charts)
- Table previews (first N rows)
- Model metrics (accuracy, RMSE, etc.)
- Node execution log

**New node:** `snk.report` — takes pipeline output + template, generates HTML/PDF.

**Effort: 7-10 days**

---

## Phase 4: Advanced Features

### 4.1 Streaming Execution

**Concept:** Process data in chunks instead of loading entire tables into memory.

**Approach:**
1. Add `QUILT_CHUNK_SIZE` env var (default: 100,000 rows)
2. Source nodes emit chunks instead of full tables
3. Transform nodes process each chunk independently
4. Sink nodes append/write incrementally

**Implementation:**
- Modify `execute_pipeline_with_events()` to support chunked mode
- Each stage's SQL wraps in `LIMIT/OFFSET` loops (like `ctl.loop.chunk` but automatic)
- Memory-bound nodes (sort, join, aggregate) either:
  - (a) Buffer all chunks then process (current behavior)
  - (b) Use streaming DuckDB operators (if available)
  - (c) Use external merge-sort for ORDER BY

**Complexity:** High — affects the core executor. Need careful testing.

**Effort: 2-3 weeks**

### 4.2 Components / Reusable Subgraph Sharing

**Current state:** Components work locally (create from selection, expand before run). No sharing.

**Phase 4 additions:**
1. **Export/import `.quilt` component files** (JSON format with subgraph definition)
2. **Component marketplace** (local directory or Git-backed)
3. **Versioned components** (semver, dependency tracking)
4. **Parameterized components** (override inputs per instance)

**Implementation:**
- Extend `extractComponent()` to serialize to `.quilt` file
- Add `Import Component` button in palette
- Component registry: `~/.quilt/components/` directory
- Version tracking: hash-based diffing of subgraph structure

**Effort: 2 weeks**

---

## Dependency Summary

### New Rust Crates
| Crate | Version | Purpose | Phase |
|-------|---------|---------|-------|
| `vader-sentimental` | 0.1.3 | VADER sentiment analysis | 1 |
| `whatlang` | 0.18.0 | Language detection | 1 |
| `rust-rule-miner` | 0.2.2 | Apriori + FP-Growth | 1 |

### New npm Packages
| Package | Purpose | Phase |
|---------|---------|-------|
| `monaco-editor` | Python code editor | 1 |
| `d3-scale` | Chart color scales | 3 |

### External Dependencies (user's machine)
| Dependency | Required By | Detection |
|------------|------------|-----------|
| Python 3.8+ | `code.python` node | `QUILT_PYTHON_BIN` → `python3` → `python` |
| pandas + pyarrow | `code.python` node | Auto-check in runner.py |

---

## Effort Summary

| Phase | Features | Effort | Cumulative |
|-------|----------|--------|-----------|
| Phase 1 | Python + Text Mining + Association Rules | ~4-5 weeks | 4-5 weeks |
| Phase 2 | SHAP / XAI | ~2-3 weeks | 6-8 weeks |
| Phase 3 | Charts + Widgets + Reports | ~3-4 weeks | 9-12 weeks |
| Phase 4 | Streaming + Components | ~3-4 weeks | 12-16 weeks |

**Total: ~12-16 weeks (3-4 months) for full v1.0.0**

---

## Recommended Implementation Order (within Phase 1)

1. **`tm.tokenize`** (DuckDB SQL, 1-2 days) — quick win, no new deps
2. **`tm.tfidf`** (DuckDB SQL, 2-3 days) — builds on tokenize
3. **`tm.sentiment`** (Rust + vader-sentimental, 3-4 days) — first Rust NLP node
4. **`tm.apriori`** + **`tm.fpgrowth`** (Rust + rust-rule-miner, 5-6 days)
5. **`tm.langdetect`** (Rust + whatlang, 1 day) — trivial addition
6. **`code.python`** (5-7 days) — most complex, save for last in Phase 1

This order maximizes shipping velocity (2 quick DuckDB-only nodes first) while building toward the harder features.
