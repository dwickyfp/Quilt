import { describe, it, expect } from 'vitest';
import { diffRows, type Row } from './pipeline-test';

const rows = (...rs: Row[]): Row[] => rs;

describe('diffRows', () => {
    it('reports no changes for identical row sets', () => {
        const a = rows({ id: 1, name: 'a' }, { id: 2, name: 'b' });
        const b = rows({ id: 1, name: 'a' }, { id: 2, name: 'b' });
        const d = diffRows(a, b);
        expect(d.added).toEqual([]);
        expect(d.removed).toEqual([]);
        expect(d.changed).toEqual([]);
        expect(d.equal).toBe(true);
    });

    it('is insensitive to row order', () => {
        const actual = rows({ id: 2, name: 'b' }, { id: 1, name: 'a' });
        const golden = rows({ id: 1, name: 'a' }, { id: 2, name: 'b' });
        expect(diffRows(actual, golden).equal).toBe(true);
    });

    it('is insensitive to column order within a row', () => {
        const actual = rows({ name: 'a', id: 1 });
        const golden = rows({ id: 1, name: 'a' });
        expect(diffRows(actual, golden).equal).toBe(true);
    });

    it('detects an added row (in actual, not golden)', () => {
        const actual = rows({ id: 1 }, { id: 2 });
        const golden = rows({ id: 1 });
        const d = diffRows(actual, golden);
        expect(d.added).toEqual([{ id: 2 }]);
        expect(d.removed).toEqual([]);
        expect(d.equal).toBe(false);
    });

    it('detects a removed row (in golden, not actual)', () => {
        const actual = rows({ id: 1 });
        const golden = rows({ id: 1 }, { id: 2 });
        const d = diffRows(actual, golden);
        expect(d.removed).toEqual([{ id: 2 }]);
        expect(d.added).toEqual([]);
        expect(d.equal).toBe(false);
    });

    it('counts a value change as one added + one removed (cell-level pairing by row identity)', () => {
        // Without a key, a changed value looks like one row gone and one new.
        const actual = rows({ id: 1, total: 99 });
        const golden = rows({ id: 1, total: 50 });
        const d = diffRows(actual, golden);
        expect(d.equal).toBe(false);
        expect(d.added).toEqual([{ id: 1, total: 99 }]);
        expect(d.removed).toEqual([{ id: 1, total: 50 }]);
    });

    it('pairs by key column to surface field-level changes', () => {
        const actual = rows({ id: 1, total: 99 }, { id: 2, total: 7 });
        const golden = rows({ id: 1, total: 50 }, { id: 2, total: 7 });
        const d = diffRows(actual, golden, { keyColumns: ['id'] });
        expect(d.equal).toBe(false);
        expect(d.changed).toEqual([
            { key: { id: 1 }, fields: { total: { actual: 99, golden: 50 } } },
        ]);
        expect(d.added).toEqual([]);
        expect(d.removed).toEqual([]);
    });

    it('with a key, reports added/removed when keys differ', () => {
        const actual = rows({ id: 1 }, { id: 3 });
        const golden = rows({ id: 1 }, { id: 2 });
        const d = diffRows(actual, golden, { keyColumns: ['id'] });
        expect(d.added).toEqual([{ id: 3 }]);
        expect(d.removed).toEqual([{ id: 2 }]);
        expect(d.changed).toEqual([]);
    });
});
