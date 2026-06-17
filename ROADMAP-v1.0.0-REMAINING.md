# v1.0.0 Remaining Features — Implementation Plan

## Overview
5 remaining features to reach v1.0.0. PostgreSQL test data available at `localhost:5432/quilt_test` (user: postgres, pass: postgres, table: sales).

## Phase 3: More Chart Types
**Goal**: Add sunburst + parallel coordinates (heatmap/roc/pr/splom already exist)

### 3a. `viz.sunburst` — Sunburst / Treemap
- **Engine**: Pure SQL — hierarchical GROUP BY with rollup. Output: `{name, value, parent}`.
- **Frontend**: ECharts sunburst series. Map `name→label`, `value→value`, `parent→parent`.
- **Files**: `mod.rs` (SQL), `palette-data.ts`, `manifest-synth.ts`, `viz-chart-data.ts`, `VizChart.tsx`
- **Props**: `categoryColumn` (hierarchy), `measureColumn`, `agg` (default sum)

### 3b. `viz.parallel` — Parallel Coordinates
- **Engine**: Pure SQL — SELECT numeric columns. Output: `{col1, col2, ..., series?}`.
- **Frontend**: ECharts parallel series. Map columns to parallel axes.
- **Files**: Same as above.
- **Props**: `columns` (numeric columns list), `series` (optional group)

## Phase 4: Interactive Widgets
**Goal**: Add slider, dropdown, file upload for data apps

### 4a. `widget.slider` — Numeric Slider
- **Engine**: RuntimeSpec — outputs single-row single-column with slider value.
- **Frontend**: React Slider component in PropertiesPanel.
- **Props**: `min`, `max`, `step`, `defaultValue`, `outputColumn`

### 4b. `widget.dropdown` — Dropdown Selector
- **Engine**: RuntimeSpec — outputs selected value, joins with upstream filter.
- **Frontend**: React Select component.
- **Props**: `options` (static list or upstream column), `outputColumn`

### 4c. `widget.fileupload` — File Upload
- **Engine**: RuntimeSpec — reads uploaded file as DataFrame.
- **Frontend**: React file input component.
- **Props**: `accept` (file types), `outputColumn`

## Phase 5: PDF/HTML Report Generation
**Goal**: Export pipeline results to PDF/HTML reports

### `report.generate` — Report Generator
- **Engine**: RuntimeSpec — renders HTML template with pipeline data, optionally converts to PDF.
- **Implementation**: Use handlebars/tera for templating, wkhtmltopdf for PDF conversion.
- **Props**: `template` (HTML template), `format` (pdf/html), `outputPath`
- **Fallback**: HTML-only first (no external deps), PDF later.

## Phase 6: Streaming Execution
**Goal**: Chunk-based processing for large datasets

### Design
- Modify executor to process data in chunks (default 10,000 rows)
- Each stage processes chunks sequentially, streaming results downstream
- Backpressure: if downstream is slow, upstream pauses
- **Files**: `lib.rs` (executor), `ml.rs` (handlers)

### Implementation Order
1. Add `StreamingConfig` to specs
2. Modify `execute_pipeline` to support chunk mode
3. Add chunk-aware versions of key handlers (src.*, xf.*, snk.*)

## Phase 7: Components / Reusable Subgraph Sharing
**Goal**: Save and reuse pipeline fragments

### Design
- Serialize subgraph (selected nodes + edges) to JSON
- Import: deserialize and merge into current pipeline
- **Files**: New `components.ts` (frontend), `components.rs` (engine metadata)

### Implementation
1. Add `Export Component` button (serializes selected nodes)
2. Add `Import Component` dialog
3. Component registry (local JSON files)

## Integration Testing with PostgreSQL

All phases will be tested with PostgreSQL data:
- Connection: `host=localhost port=5432 dbname=quilt_test user=postgres password=postgres`
- Table: `sales` (id, product, category, region, amount, quantity, sale_date)
- Test: src.postgres → various nodes → snk.postgres or viz.*

## Execution Order
1. Phase 3 (More Charts) — 2-3 hours, pure frontend + SQL
2. Phase 4 (Widgets) — 3-4 hours, new RuntimeSpec + React
3. Phase 5 (Reports) — 2-3 hours, HTML template engine
4. Phase 6 (Streaming) — 4-6 hours, executor refactor
5. Phase 7 (Components) — 2-3 hours, serialization
