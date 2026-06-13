import { describe, it, expect } from 'vitest';
import { rowsToCategorical, rowsToScatter, rowsToSeries } from './viz-chart-data';

describe('rowsToCategorical', () => {
    it('maps bar rows to [indices, yValues] with x labels', () => {
        const rows = [
            { x: 'A', y: 10 },
            { x: 'B', y: 20 },
            { x: 'C', y: 5 },
        ];
        const { data, labels } = rowsToCategorical(rows);
        expect(data[0]).toEqual([0, 1, 2]);
        expect(data[1]).toEqual([10, 20, 5]);
        expect(labels).toEqual(['A', 'B', 'C']);
    });

    it('coerces string y values to numbers', () => {
        const { data } = rowsToCategorical([{ x: 'A', y: '42' }]);
        expect(data[1]).toEqual([42]);
    });

    it('handles empty rows safely', () => {
        const { data, labels } = rowsToCategorical([]);
        expect(data).toEqual([[], []]);
        expect(labels).toEqual([]);
    });
});

describe('rowsToScatter', () => {
    it('maps scatter rows to [xNums, yNums]', () => {
        const rows = [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
        ];
        expect(rowsToScatter(rows)).toEqual([
            [1, 3],
            [2, 4],
        ]);
    });

    it('handles empty rows safely', () => {
        expect(rowsToScatter([])).toEqual([[], []]);
    });
});

describe('rowsToSeries', () => {
    it('dispatches scatter to numeric x/y with no labels', () => {
        const { data, labels } = rowsToSeries([{ x: 1, y: 2 }], 'scatter');
        expect(data).toEqual([[1], [2]]);
        expect(labels).toEqual([]);
    });

    it('dispatches bar to categorical indices + labels', () => {
        const { data, labels } = rowsToSeries([{ x: 'A', y: 9 }], 'bar');
        expect(data).toEqual([[0], [9]]);
        expect(labels).toEqual(['A']);
    });

    it('treats histogram like categorical', () => {
        const { data, labels } = rowsToSeries([{ x: 'lo', y: 3 }], 'histogram');
        expect(data).toEqual([[0], [3]]);
        expect(labels).toEqual(['lo']);
    });
});
