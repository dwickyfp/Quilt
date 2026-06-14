import { describe, it, expect } from 'vitest';
import { buildVizOption, toNumber, toLabel, type VizOption } from './viz-chart-data';

// Helpers to dig into the option without echarts' heavy types.
const series0 = (o: VizOption) => (o.series as Record<string, unknown>[])[0];

describe('toNumber / toLabel', () => {
    it('coerces strings to numbers, non-numeric to NaN', () => {
        expect(toNumber('42')).toBe(42);
        expect(toNumber(7)).toBe(7);
        expect(Number.isNaN(toNumber('abc'))).toBe(true);
    });
    it('labels null/undefined as empty string', () => {
        expect(toLabel(null)).toBe('');
        expect(toLabel(undefined)).toBe('');
        expect(toLabel('A')).toBe('A');
    });
});

describe('buildVizOption — bar / line / histogram (categorical)', () => {
    it('single-series bar maps labels + values', () => {
        const o = buildVizOption([{ x: 'A', y: 10 }, { x: 'B', y: 20 }], 'bar');
        expect((o.xAxis as { data: string[] }).data).toEqual(['A', 'B']);
        expect(series0(o).type).toBe('bar');
        expect(series0(o).data).toEqual([10, 20]);
    });

    it('line chart uses line series type', () => {
        const o = buildVizOption([{ x: 'A', y: 1 }], 'line');
        expect(series0(o).type).toBe('line');
    });

    it('coerces string y values to numbers', () => {
        const o = buildVizOption([{ x: 'A', y: '42' }], 'bar');
        expect(series0(o).data).toEqual([42]);
    });

    it('pivots a series column into one series per distinct value', () => {
        const o = buildVizOption(
            [
                { x: 'Q1', y: 10, series: 'East' },
                { x: 'Q1', y: 5, series: 'West' },
                { x: 'Q2', y: 20, series: 'East' },
            ],
            'bar',
        );
        const s = o.series as Record<string, unknown>[];
        expect(s).toHaveLength(2);
        expect(s.map(x => x.name)).toEqual(['East', 'West']);
        expect((o.xAxis as { data: string[] }).data).toEqual(['Q1', 'Q2']);
        // East has Q1=10, Q2=20; West has Q1=5, Q2 missing -> 0.
        expect(s[0].data).toEqual([10, 20]);
        expect(s[1].data).toEqual([5, 0]);
    });

    it('handles empty rows without throwing', () => {
        const o = buildVizOption([], 'bar');
        expect((o.xAxis as { data: string[] }).data).toEqual([]);
        expect(series0(o).data).toEqual([]);
    });
});

describe('buildVizOption — scatter', () => {
    it('maps numeric x/y to point pairs', () => {
        const o = buildVizOption([{ x: 1, y: 2 }, { x: 3, y: 4 }], 'scatter');
        expect(series0(o).type).toBe('scatter');
        expect(series0(o).data).toEqual([[1, 2], [3, 4]]);
    });

    it('splits into colored groups when series present', () => {
        const o = buildVizOption(
            [{ x: 1, y: 2, series: 'a' }, { x: 3, y: 4, series: 'b' }],
            'scatter',
        );
        const s = o.series as Record<string, unknown>[];
        expect(s).toHaveLength(2);
        expect(s[0].data).toEqual([[1, 2]]);
    });
});

describe('buildVizOption — pie / donut', () => {
    it('builds one slice per row with name + value', () => {
        const o = buildVizOption([{ x: 'A', y: 30 }, { x: 'B', y: 70 }], 'pie');
        expect(series0(o).type).toBe('pie');
        const data = series0(o).data as Record<string, unknown>[];
        expect(data.map(d => d.name)).toEqual(['A', 'B']);
        expect(data.map(d => d.value)).toEqual([30, 70]);
    });
});

describe('buildVizOption — box plot', () => {
    it('maps five-number summaries to [min,q1,median,q3,max]', () => {
        const o = buildVizOption(
            [{ x: 'G1', min: 1, q1: 2, median: 3, q3: 4, max: 5 }],
            'box',
        );
        expect(series0(o).type).toBe('boxplot');
        expect(series0(o).data).toEqual([[1, 2, 3, 4, 5]]);
        expect((o.xAxis as { data: string[] }).data).toEqual(['G1']);
    });
});

describe('buildVizOption — heatmap', () => {
    it('builds category axes + [xIdx,yIdx,value] triples', () => {
        const o = buildVizOption(
            [
                { x: 'c1', y: 'r1', value: 5 },
                { x: 'c2', y: 'r1', value: 8 },
                { x: 'c1', y: 'r2', value: 2 },
            ],
            'heatmap',
        );
        expect((o.xAxis as { data: string[] }).data).toEqual(['c1', 'c2']);
        expect((o.yAxis as { data: string[] }).data).toEqual(['r1', 'r2']);
        expect(series0(o).type).toBe('heatmap');
        expect(series0(o).data).toEqual([[0, 0, 5], [1, 0, 8], [0, 1, 2]]);
        // visualMap range reflects min/max of values.
        expect((o.visualMap as { min: number; max: number }).min).toBe(2);
        expect((o.visualMap as { min: number; max: number }).max).toBe(8);
    });
});

describe('buildVizOption — ROC / PR', () => {
    it('ROC plots fpr/tpr and adds a diagonal reference line', () => {
        const o = buildVizOption(
            [{ fpr: 0, tpr: 0 }, { fpr: 0.2, tpr: 0.8 }, { fpr: 1, tpr: 1 }],
            'roc',
        );
        const s = o.series as Record<string, unknown>[];
        expect(s[0].data).toEqual([[0, 0], [0.2, 0.8], [1, 1]]);
        // diagonal reference
        expect(s[1].data).toEqual([[0, 0], [1, 1]]);
    });

    it('PR plots recall/precision with no diagonal', () => {
        const o = buildVizOption(
            [{ recall: 0.5, precision: 0.9 }, { recall: 1, precision: 0.6 }],
            'pr',
        );
        const s = o.series as Record<string, unknown>[];
        expect(s).toHaveLength(1);
        expect(s[0].data).toEqual([[0.5, 0.9], [1, 0.6]]);
    });
});

describe('buildVizOption — scatter matrix (splom)', () => {
    it('builds an N x N grid from the column keys', () => {
        const rows = [
            { a: 1, b: 2, c: 3 },
            { a: 4, b: 5, c: 6 },
        ];
        const o = buildVizOption(rows, 'splom');
        // 3 columns -> 9 grid cells, 9 axes each, 9 scatter series (no group).
        expect((o.grid as unknown[]).length).toBe(9);
        expect((o.xAxis as unknown[]).length).toBe(9);
        expect((o.series as unknown[]).length).toBe(9);
    });

    it('first cell maps col0-on-x, col0-on-y point pairs', () => {
        const rows = [{ a: 1, b: 10 }, { a: 2, b: 20 }];
        const o = buildVizOption(rows, 'splom');
        const s = o.series as Record<string, unknown>[];
        // 2 cols -> 4 cells. Cell 0 = (a,a): both axes are column a.
        expect(s[0].data).toEqual([[1, 1], [2, 2]]);
        // Cell 1 = (b on x, a on y).
        expect(s[1].data).toEqual([[10, 1], [20, 2]]);
    });

    it('splits into one series per group per cell when series present', () => {
        const rows = [
            { a: 1, b: 2, series: 'x' },
            { a: 3, b: 4, series: 'y' },
        ];
        const o = buildVizOption(rows, 'splom');
        // 2 data cols (a,b) -> 4 cells x 2 groups = 8 series.
        expect((o.series as unknown[]).length).toBe(8);
    });

    it('returns empty structure when fewer than 2 columns', () => {
        const o = buildVizOption([{ a: 1 }], 'splom');
        expect((o.series as unknown[]).length).toBe(0);
    });
});
