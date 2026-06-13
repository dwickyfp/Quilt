import { describe, it, expect } from 'vitest';
import { heatColor, formatBytes, normalize } from './profile-overlay';

describe('heatColor', () => {
    it('returns green for low values', () => {
        // t=0 -> hue 120 (green)
        expect(heatColor(0, 100)).toBe('hsl(120, 70%, 45%)');
    });
    it('returns red for the max value', () => {
        // t=1 -> hue 0 (red)
        expect(heatColor(100, 100)).toBe('hsl(0, 70%, 45%)');
    });
    it('returns mid hue for half', () => {
        // t=0.5 -> hue 60 (amber/yellow)
        expect(heatColor(50, 100)).toBe('hsl(60, 70%, 45%)');
    });
    it('is green when max is 0 (no data)', () => {
        expect(heatColor(0, 0)).toBe('hsl(120, 70%, 45%)');
    });
    it('clamps values above max to red', () => {
        expect(heatColor(200, 100)).toBe('hsl(0, 70%, 45%)');
    });
});

describe('formatBytes', () => {
    it('formats bytes under 1KB', () => {
        expect(formatBytes(512)).toBe('512B');
    });
    it('formats kilobytes', () => {
        expect(formatBytes(2048)).toBe('2.0KB');
    });
    it('formats megabytes', () => {
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB');
    });
    it('formats gigabytes', () => {
        expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0GB');
    });
    it('caps at GB for very large values', () => {
        // 2048 GB stays in GB units, not TB
        expect(formatBytes(2048 * 1024 * 1024 * 1024)).toBe('2048.0GB');
    });
});

describe('normalize', () => {
    it('returns 0 when max is 0', () => {
        expect(normalize(5, 0)).toBe(0);
    });
    it('returns ratio for normal values', () => {
        expect(normalize(25, 100)).toBe(0.25);
    });
    it('clamps to 1 for values over max', () => {
        expect(normalize(150, 100)).toBe(1);
    });
});
