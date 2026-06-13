// Pure helpers for the profiler heat overlay (profiler feature A3).
// Kept free of React so they're trivially unit-testable.

/** Normalize a value into [0, 1] relative to max. Returns 0 when max <= 0. */
export function normalize(v: number, max: number): number {
    if (max <= 0) return 0;
    return Math.min(v / max, 1);
}

/**
 * Heat color for a metric value relative to the run's max.
 * Low = green (hue 120), high = red (hue 0). max<=0 -> green (no data).
 */
export function heatColor(v: number, max: number): string {
    const t = normalize(v, max);
    const hue = Math.round(120 * (1 - t));
    return `hsl(${hue}, 70%, 45%)`;
}

/** Human-readable byte size, capped at GB units. */
export function formatBytes(b: number): string {
    if (b < 1024) return `${b}B`;
    const units = ['KB', 'MB', 'GB'];
    let i = -1;
    let n = b;
    do {
        n /= 1024;
        i++;
    } while (n >= 1024 && i < units.length - 1);
    return `${n.toFixed(1)}${units[i]}`;
}
