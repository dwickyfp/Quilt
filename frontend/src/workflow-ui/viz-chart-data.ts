// Pure data-shaping helpers for VizChart. Kept DOM-free so they can be
// unit-tested without jsdom / a canvas. The engine emits NodePreview rows
// whose shape depends on the chart:
//   bar / line / histogram -> { x (label), y (number), series? (label) }
//   scatter                -> { x (number), y (number), series? (label) }
//   pie                    -> { x (label), y (number) }
//   box                    -> { x (label), min, q1, median, q3, max }
//   heatmap                -> { x (label), y (label), value (number) }
//   roc                    -> { fpr (number), tpr (number) }  (+ a meta AUC row)
//
// buildVizOption() returns a plain ECharts option object (no echarts runtime
// import) so it can be asserted in unit tests; VizChart.tsx owns the DOM
// lifecycle and feeds the option to an ECharts instance.

export type VizRow = Record<string, unknown>;

// Minimal structural type for what we build — avoids a hard echarts type dep
// in the pure module. VizChart casts this to echarts' EChartsOption.
export type VizOption = Record<string, unknown>;

const ACCENT = '#a371f7';
const ACCENT_FILL = 'rgba(163, 113, 247, 0.4)';
// Categorical palette for multi-series / pie slices (accent-led, color-safe).
const PALETTE = [
    '#a371f7', '#3fb950', '#f0883e', '#58a6ff', '#db61a2',
    '#e3b341', '#39c5cf', '#ff7b72', '#bc8cff', '#7ee787',
];

export function toNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}

export function toLabel(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
}

const BASE_GRID = { left: 48, right: 16, top: 24, bottom: 36 };

/**
 * Bar / line / histogram. The x column is categorical. When a `series` column
 * is present the rows are pivoted into one ECharts series per distinct series
 * value (grouped bars / multi-line); otherwise a single series is built.
 */
function buildCategorical(rows: VizRow[], chart: string): VizOption {
    const seriesType = chart === 'line' ? 'line' : 'bar';
    const hasSeries = rows.some(r => r.series !== undefined && r.series !== null);

    // Preserve first-seen order for both axis labels and series names.
    const labels: string[] = [];
    const labelIndex = new Map<string, number>();
    const pushLabel = (l: string) => {
        if (!labelIndex.has(l)) {
            labelIndex.set(l, labels.length);
            labels.push(l);
        }
        return labelIndex.get(l)!;
    };

    if (!hasSeries) {
        const values: number[] = [];
        for (const r of rows) {
            pushLabel(toLabel(r.x));
            values.push(toNumber(r.y));
        }
        return {
            grid: BASE_GRID,
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: labels },
            yAxis: { type: 'value' },
            series: [
                seriesType === 'bar'
                    ? {
                          type: 'bar',
                          data: values,
                          itemStyle: { color: ACCENT },
                      }
                    : {
                          type: 'line',
                          data: values,
                          lineStyle: { color: ACCENT, width: 2 },
                          itemStyle: { color: ACCENT },
                      },
            ],
        };
    }

    // Multi-series: pivot (x, series) -> value matrix.
    const seriesNames: string[] = [];
    const seriesIndex = new Map<string, number>();
    const matrix: number[][] = []; // matrix[seriesIdx][labelIdx]
    for (const r of rows) {
        const li = pushLabel(toLabel(r.x));
        const sName = toLabel(r.series);
        if (!seriesIndex.has(sName)) {
            seriesIndex.set(sName, seriesNames.length);
            seriesNames.push(sName);
            matrix.push([]);
        }
        const si = seriesIndex.get(sName)!;
        matrix[si][li] = toNumber(r.y);
    }
    const series = seriesNames.map((name, si) => ({
        name,
        type: seriesType,
        data: labels.map((_, li) => matrix[si][li] ?? 0),
        itemStyle: { color: PALETTE[si % PALETTE.length] },
        ...(seriesType === 'line'
            ? { lineStyle: { color: PALETTE[si % PALETTE.length], width: 2 } }
            : {}),
    }));
    return {
        grid: BASE_GRID,
        tooltip: { trigger: 'axis' },
        legend: { show: true, top: 0, textStyle: { color: '#8b949e' } },
        xAxis: { type: 'category', data: labels },
        yAxis: { type: 'value' },
        series,
    };
}

/**
 * Scatter: both axes numeric. Optional `series` column splits points into
 * colored groups.
 */
function buildScatter(rows: VizRow[]): VizOption {
    const hasSeries = rows.some(r => r.series !== undefined && r.series !== null);
    if (!hasSeries) {
        const points = rows.map(r => [toNumber(r.x), toNumber(r.y)]);
        return {
            grid: BASE_GRID,
            tooltip: { trigger: 'item' },
            xAxis: { type: 'value' },
            yAxis: { type: 'value' },
            series: [{ type: 'scatter', symbolSize: 8, data: points, itemStyle: { color: ACCENT } }],
        };
    }
    const groups = new Map<string, number[][]>();
    for (const r of rows) {
        const name = toLabel(r.series);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name)!.push([toNumber(r.x), toNumber(r.y)]);
    }
    const series = [...groups.entries()].map(([name, data], i) => ({
        name,
        type: 'scatter',
        symbolSize: 8,
        data,
        itemStyle: { color: PALETTE[i % PALETTE.length] },
    }));
    return {
        grid: BASE_GRID,
        tooltip: { trigger: 'item' },
        legend: { show: true, top: 0, textStyle: { color: '#8b949e' } },
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series,
    };
}

/**
 * Pie / donut: one slice per row, name = x, value = y.
 */
function buildPie(rows: VizRow[]): VizOption {
    const data = rows.map((r, i) => ({
        name: toLabel(r.x),
        value: toNumber(r.y),
        itemStyle: { color: PALETTE[i % PALETTE.length] },
    }));
    return {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { show: true, bottom: 0, textStyle: { color: '#8b949e' } },
        series: [
            {
                type: 'pie',
                radius: ['40%', '70%'], // donut; set ['0','70%'] for full pie
                center: ['50%', '45%'],
                data,
                label: { color: '#c9d1d9' },
            },
        ],
    };
}

/**
 * Box plot: the engine emits per-category five-number summaries
 * (min / q1 / median / q3 / max). ECharts boxplot wants
 * [min, Q1, median, Q3, max] arrays aligned to a category axis.
 */
function buildBox(rows: VizRow[]): VizOption {
    const labels: string[] = [];
    const boxes: number[][] = [];
    for (const r of rows) {
        labels.push(toLabel(r.x));
        boxes.push([
            toNumber(r.min),
            toNumber(r.q1),
            toNumber(r.median),
            toNumber(r.q3),
            toNumber(r.max),
        ]);
    }
    return {
        grid: BASE_GRID,
        tooltip: { trigger: 'item' },
        xAxis: { type: 'category', data: labels },
        yAxis: { type: 'value' },
        series: [
            {
                type: 'boxplot',
                data: boxes,
                itemStyle: { color: ACCENT_FILL, borderColor: ACCENT },
            },
        ],
    };
}

/**
 * Heatmap: rows carry x (col label), y (row label), value. Build two category
 * axes and [xIdx, yIdx, value] triples.
 */
function buildHeatmap(rows: VizRow[]): VizOption {
    const xLabels: string[] = [];
    const yLabels: string[] = [];
    const xi = new Map<string, number>();
    const yi = new Map<string, number>();
    const idx = (l: string, labels: string[], map: Map<string, number>) => {
        if (!map.has(l)) { map.set(l, labels.length); labels.push(l); }
        return map.get(l)!;
    };
    const data: number[][] = [];
    let min = Infinity, max = -Infinity;
    for (const r of rows) {
        const x = idx(toLabel(r.x), xLabels, xi);
        const y = idx(toLabel(r.y), yLabels, yi);
        const v = toNumber(r.value);
        if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
        data.push([x, y, v]);
    }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    return {
        grid: { left: 60, right: 16, top: 24, bottom: 60 },
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: xLabels, splitArea: { show: true } },
        yAxis: { type: 'category', data: yLabels, splitArea: { show: true } },
        visualMap: {
            min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
            inRange: { color: ['#0d1117', '#3b2d6b', '#a371f7', '#e3b341'] },
            textStyle: { color: '#8b949e' },
        },
        series: [{ type: 'heatmap', data, label: { show: false } }],
    };
}

/**
 * ROC / PR curve: rows carry fpr/tpr (ROC) or recall/precision (PR). A diagonal
 * reference line is added for ROC. AUC, if present on rows, is surfaced in the
 * title by VizChart (not here, to keep this pure).
 */
function buildRoc(rows: VizRow[], chart: string): VizOption {
    const isPr = chart === 'pr';
    const xKey = isPr ? 'recall' : 'fpr';
    const yKey = isPr ? 'precision' : 'tpr';
    const points = rows
        .filter(r => r[xKey] !== undefined && r[yKey] !== undefined)
        .map(r => [toNumber(r[xKey]), toNumber(r[yKey])]);
    const series: Record<string, unknown>[] = [
        {
            type: 'line',
            data: points,
            showSymbol: false,
            lineStyle: { color: ACCENT, width: 2 },
            areaStyle: { color: ACCENT_FILL },
        },
    ];
    if (!isPr) {
        series.push({
            type: 'line',
            data: [[0, 0], [1, 1]],
            showSymbol: false,
            lineStyle: { color: '#6e7681', type: 'dashed', width: 1 },
        });
    }
    return {
        grid: BASE_GRID,
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'value', min: 0, max: 1, name: isPr ? 'Recall' : 'FPR' },
        yAxis: { type: 'value', min: 0, max: 1, name: isPr ? 'Precision' : 'TPR' },
        series,
    };
}

/**
 * Scatter-plot matrix (SPLOM). The engine emits the raw selected columns (plus
 * an optional `series` label). We build an N x N grid of ECharts grids, one
 * scatter series per (col_i on x, col_j on y) cell. Diagonal cells (i === j)
 * are left as axis references showing the variable name.
 */
function buildSplom(rows: VizRow[]): VizOption {
    // Column keys = every key in the first row except the reserved series label.
    const first = rows[0] ?? {};
    const cols = Object.keys(first).filter(k => k !== 'series');
    const n = cols.length;
    if (n < 2) {
        return { series: [], grid: [], xAxis: [], yAxis: [] };
    }
    const hasSeries = rows.some(r => r.series !== undefined && r.series !== null);
    const seriesNames = hasSeries
        ? [...new Set(rows.map(r => toLabel(r.series)))]
        : [''];

    const grids: Record<string, unknown>[] = [];
    const xAxes: Record<string, unknown>[] = [];
    const yAxes: Record<string, unknown>[] = [];
    const series: Record<string, unknown>[] = [];

    // Layout: equal cells with small gaps, leaving a margin for axis labels.
    const margin = 6; // percent
    const cell = (100 - margin * 2) / n;

    let gridIdx = 0;
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            const left = margin + col * cell;
            const top = margin + row * cell;
            grids.push({
                left: `${left + 1}%`,
                top: `${top + 1}%`,
                width: `${cell - 2}%`,
                height: `${cell - 2}%`,
            });
            // Bottom row shows x label; left column shows y label.
            xAxes.push({
                gridIndex: gridIdx,
                type: 'value',
                scale: true,
                name: row === n - 1 ? cols[col] : '',
                nameLocation: 'middle',
                nameGap: 18,
                axisLabel: { show: row === n - 1, fontSize: 9 },
                splitLine: { show: false },
            });
            yAxes.push({
                gridIndex: gridIdx,
                type: 'value',
                scale: true,
                name: col === 0 ? cols[row] : '',
                nameLocation: 'middle',
                nameGap: 28,
                axisLabel: { show: col === 0, fontSize: 9 },
                splitLine: { show: false },
            });

            const xKey = cols[col];
            const yKey = cols[row];
            // One scatter series per group (or a single series when no group).
            seriesNames.forEach((sName, si) => {
                const data = rows
                    .filter(r => !hasSeries || toLabel(r.series) === sName)
                    .map(r => [toNumber(r[xKey]), toNumber(r[yKey])]);
                series.push({
                    type: 'scatter',
                    xAxisIndex: gridIdx,
                    yAxisIndex: gridIdx,
                    symbolSize: 4,
                    data,
                    itemStyle: { color: PALETTE[si % PALETTE.length], opacity: 0.6 },
                });
            });
            gridIdx++;
        }
    }
    return {
        tooltip: { trigger: 'item' },
        legend: hasSeries ? { show: true, top: 0, data: seriesNames, textStyle: { color: '#8b949e' } } : { show: false },
        grid: grids,
        xAxis: xAxes,
        yAxis: yAxes,
        series,
    };
}

/**
 * Dispatch by chart type. Returns a plain ECharts option object.
 */
export function buildVizOption(rows: VizRow[], chart: string): VizOption {
    switch (chart) {
        case 'scatter':
            return buildScatter(rows);
        case 'pie':
        case 'donut':
            return buildPie(rows);
        case 'box':
            return buildBox(rows);
        case 'heatmap':
            return buildHeatmap(rows);
        case 'roc':
        case 'pr':
            return buildRoc(rows, chart);
        case 'splom':
            return buildSplom(rows);
        case 'sunburst':
            return buildSunburst(rows);
        case 'parallel':
            return buildParallel(rows);
        default:
            // bar / line / histogram
            return buildCategorical(rows, chart);
    }
}

// ─── Sunburst ──────────────────────────────────────────────────────

function buildSunburst(rows: VizRow[]): VizOption {
    // Rows: { name, value, parent, depth }
    // Build tree structure for ECharts sunburst
    const data = rows
        .filter(r => r.depth === -1) // root
        .map(r => ({
            name: String(r.name ?? 'Total'),
            value: Number(r.value ?? 0),
            children: buildSunburstChildren(rows, String(r.name ?? 'Total')),
        }));
    // If no root, use all top-level items
    const treeData = data.length > 0 ? data : rows.filter(r => r.depth === 0).map(r => ({
        name: String(r.name ?? ''),
        value: Number(r.value ?? 0),
        children: buildSunburstChildren(rows, String(r.name ?? '')),
    }));
    return {
        tooltip: { trigger: 'item', formatter: '{b}: {c}' },
        series: [{ type: 'sunburst', data: treeData, radius: ['10%', '90%'], sort: undefined, emphasis: { focus: 'ancestor' } }],
    };
}

function buildSunburstChildren(rows: VizRow[], parentName: string): any[] {
    return rows
        .filter(r => r.parent === parentName && r.depth !== -1)
        .map(r => ({
            name: String(r.name ?? ''),
            value: Number(r.value ?? 0),
            children: buildSunburstChildren(rows, String(r.name ?? '')),
        }));
}

// ─── Parallel Coordinates ──────────────────────────────────────────

function buildParallel(rows: VizRow[]): VizOption {
    if (rows.length === 0) return { series: [] };
    // Columns = all keys except 'series'
    const cols = Object.keys(rows[0]).filter(k => k !== 'series');
    // Parallel axis definitions
    const parallelAxis = cols.map(col => ({ name: col, dim: cols.indexOf(col) }));
    // Group by series if present
    const hasSeries = 'series' in rows[0];
    let series: any[];
    if (hasSeries) {
        const groups = new Map<string, number[][]>();
        for (const r of rows) {
            const key = String(r.series ?? '');
            if (!groups.has(key)) groups.set(key, []);
            groups.set(key, [...(groups.get(key) ?? []), cols.map(c => Number(r[c] ?? 0))]);
        }
        series = [...groups.entries()].map(([name, data]) => ({
            name, type: 'parallel', data,
        }));
    } else {
        series = [{ type: 'parallel', data: rows.map(r => cols.map(c => Number(r[c] ?? 0))) }];
    }
    return {
        parallelAxis,
        parallel: { left: 60, right: 80 },
        tooltip: { trigger: 'item' },
        series,
    };
}
