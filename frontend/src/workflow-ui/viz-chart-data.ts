// Pure data-shaping helpers for VizChart. Kept DOM-free so they can be
// unit-tested without jsdom / a canvas. The engine emits NodePreview rows
// with `x` / `y` columns (bar/line/histogram) or raw `x` / `y` (scatter).

export type VizRow = Record<string, unknown>;

// uPlot expects data as [xValues, ySeries1, ySeries2, ...]; for our charts
// we only ever build a single y series.
export type UPlotData = [number[], number[]];

function toNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}

/**
 * Bar / line / histogram: the x column is categorical, so we plot against
 * row indices (0, 1, 2, …) and keep the original x values as labels for the
 * axis. Returns the numeric data uPlot needs plus the string labels.
 */
export function rowsToCategorical(rows: VizRow[]): { data: UPlotData; labels: string[] } {
    const labels: string[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    rows.forEach((r, i) => {
        labels.push(r.x === null || r.x === undefined ? '' : String(r.x));
        xs.push(i);
        ys.push(toNumber(r.y));
    });
    return { data: [xs, ys], labels };
}

/**
 * Scatter: both axes are numeric. Returns [xNums, yNums] directly.
 */
export function rowsToScatter(rows: VizRow[]): UPlotData {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of rows) {
        xs.push(toNumber(r.x));
        ys.push(toNumber(r.y));
    }
    return [xs, ys];
}

/**
 * Dispatch by chart type. Scatter shapes to numeric x/y; everything else
 * (bar / line / histogram) shapes to categorical indices + labels.
 */
export function rowsToSeries(
    rows: VizRow[],
    chart: string,
): { data: UPlotData; labels: string[] } {
    if (chart === 'scatter') {
        return { data: rowsToScatter(rows), labels: [] };
    }
    return rowsToCategorical(rows);
}
