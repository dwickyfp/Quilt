// Pure pipeline-test core: compare a node's actual output rows against a saved
// "golden" snapshot. DOM-free and side-effect-free for trivial unit testing.
// The engine captures golden rows once (a snapshot of a node's output) and on a
// later test run diffs the fresh output against it - this is the comparison.
//
// Two modes:
//  - No key: order-insensitive multiset compare. A changed value shows up as one
//    added + one removed row (you can't know which field moved without a key).
//  - With keyColumns: rows are paired by key, surfacing field-level changes and
//    only flagging rows whose key is genuinely added/removed.

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export type FieldChange = { actual: Cell; golden: Cell };
export type RowChange = { key: Row; fields: Record<string, FieldChange> };

export type DiffResult = {
    equal: boolean;
    added: Row[]; // in actual, not in golden
    removed: Row[]; // in golden, not in actual
    changed: RowChange[]; // same key, differing fields (key mode only)
};

export type DiffOptions = { keyColumns?: string[] };

// Stable, column-order-insensitive canonical string for a row.
function canon(row: Row): string {
    const keys = Object.keys(row).sort();
    return JSON.stringify(keys.map(k => [k, row[k]]));
}

function keyOf(row: Row, keyColumns: string[]): string {
    return JSON.stringify(keyColumns.map(k => row[k] ?? null));
}

function pickKey(row: Row, keyColumns: string[]): Row {
    const out: Row = {};
    for (const k of keyColumns) out[k] = row[k] ?? null;
    return out;
}

/** Multiset diff with no row identity: order-insensitive add/remove only. */
function diffNoKey(actual: Row[], golden: Row[]): DiffResult {
    const goldenCounts = new Map<string, number>();
    for (const r of golden) goldenCounts.set(canon(r), (goldenCounts.get(canon(r)) ?? 0) + 1);
    const actualCounts = new Map<string, number>();
    for (const r of actual) actualCounts.set(canon(r), (actualCounts.get(canon(r)) ?? 0) + 1);

    const added: Row[] = [];
    const removed: Row[] = [];
    for (const r of actual) {
        const c = canon(r);
        const g = goldenCounts.get(c) ?? 0;
        if (g > 0) goldenCounts.set(c, g - 1);
        else added.push(r);
    }
    for (const r of golden) {
        const c = canon(r);
        const a = actualCounts.get(c) ?? 0;
        if (a > 0) actualCounts.set(c, a - 1);
        else removed.push(r);
    }
    return { equal: added.length === 0 && removed.length === 0, added, removed, changed: [] };
}

/** Key-based diff: pair rows by key, surface field-level changes. */
function diffByKey(actual: Row[], golden: Row[], keyColumns: string[]): DiffResult {
    const goldenByKey = new Map<string, Row>();
    for (const r of golden) goldenByKey.set(keyOf(r, keyColumns), r);
    const actualByKey = new Map<string, Row>();
    for (const r of actual) actualByKey.set(keyOf(r, keyColumns), r);

    const added: Row[] = [];
    const removed: Row[] = [];
    const changed: RowChange[] = [];

    for (const [k, aRow] of actualByKey) {
        const gRow = goldenByKey.get(k);
        if (!gRow) {
            added.push(aRow);
            continue;
        }
        const fields: Record<string, FieldChange> = {};
        const cols = new Set([...Object.keys(aRow), ...Object.keys(gRow)]);
        for (const col of cols) {
            if (keyColumns.includes(col)) continue;
            const av = aRow[col] ?? null;
            const gv = gRow[col] ?? null;
            if (av !== gv) fields[col] = { actual: av, golden: gv };
        }
        if (Object.keys(fields).length > 0) {
            changed.push({ key: pickKey(aRow, keyColumns), fields });
        }
    }
    for (const [k, gRow] of goldenByKey) {
        if (!actualByKey.has(k)) removed.push(gRow);
    }
    return {
        equal: added.length === 0 && removed.length === 0 && changed.length === 0,
        added,
        removed,
        changed,
    };
}

/** Diff actual output rows against a golden snapshot. */
export function diffRows(actual: Row[], golden: Row[], opts: DiffOptions = {}): DiffResult {
    if (opts.keyColumns && opts.keyColumns.length > 0) {
        return diffByKey(actual, golden, opts.keyColumns);
    }
    return diffNoKey(actual, golden);
}
