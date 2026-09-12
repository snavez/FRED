import { describe, it, expect } from 'vitest';
import { axisFraction, axisPosition, panRange, zoomRange } from './zoomRange';
import { axisTicks } from './axisTicks';

describe('zoomRange', () => {
  it('zooming in keeps the value under the cursor still', () => {
    const zoomed = zoomRange([0, 100], 0.25, 2);
    expect(zoomed).toEqual([12.5, 62.5]);
    // 25 sat a quarter along before, and still does
    expect(zoomed[0] + 0.25 * (zoomed[1] - zoomed[0])).toBeCloseTo(25);
  });

  it('zooming out takes in more than was showing — where the outliers are', () => {
    const [lo, hi] = zoomRange([100, 200], 0.5, 0.5);
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(200);
    expect(hi - lo).toBeCloseTo(200);
  });

  it('anchors at either end without drifting', () => {
    expect(zoomRange([0, 100], 0, 2)).toEqual([0, 50]);
    expect(zoomRange([0, 100], 1, 2)).toEqual([50, 100]);
  });

  it('zoom in then out returns to where it started', () => {
    const start: [number, number] = [200, 800];
    const there = zoomRange(start, 0.3, 1.6);
    const back = zoomRange(there, 0.3, 1 / 1.6);
    expect(back[0]).toBeCloseTo(start[0]);
    expect(back[1]).toBeCloseTo(start[1]);
  });

  it('leaves a degenerate range alone rather than producing NaN', () => {
    expect(zoomRange([5, 5], 0.5, 2)).toEqual([5, 5]);
    expect(zoomRange([0, 100], 0.5, 0)).toEqual([0, 100]);
    expect(zoomRange([NaN, 10], 0.5, 2)).toEqual([NaN, 10]);
  });

  it('clamps an anchor that falls outside the frame', () => {
    expect(zoomRange([0, 100], 2, 2)).toEqual(zoomRange([0, 100], 1, 2));
    expect(zoomRange([0, 100], -1, 2)).toEqual(zoomRange([0, 100], 0, 2));
  });
});

describe('panRange', () => {
  it('slides by a fraction of the span, in both directions', () => {
    expect(panRange([0, 100], 0.1)).toEqual([10, 110]);
    expect(panRange([0, 100], -0.25)).toEqual([-25, 75]);
  });

  it('keeps the span exactly', () => {
    const [lo, hi] = panRange([120, 480], 0.37);
    expect(hi - lo).toBeCloseTo(360);
  });
});

describe('axisFraction', () => {
  it('measures position along the axis', () => {
    expect(axisFraction(50, 0, 100)).toBeCloseTo(0.5);
    expect(axisFraction(75, 50, 100)).toBeCloseTo(0.25);
  });

  it('reads a reversed axis from the other end', () => {
    expect(axisFraction(25, 0, 100, true)).toBeCloseTo(0.75);
  });

  it('is 0 for an axis with no length', () => {
    expect(axisFraction(10, 0, 0)).toBe(0);
  });
});

describe('axisPosition', () => {
  it('places values along the axis from its start', () => {
    expect(axisPosition(0, [0, 100], 88, 500)).toBe(88);
    expect(axisPosition(100, [0, 100], 88, 500)).toBe(588);
    expect(axisPosition(25, [0, 100], 88, 500)).toBe(213);
  });

  it('runs a reversed axis from the other end', () => {
    expect(axisPosition(0, [0, 100], 88, 500, true)).toBe(588);
    expect(axisPosition(100, [0, 100], 88, 500, true)).toBe(88);
    expect(axisPosition(25, [0, 100], 88, 500, true)).toBe(463);
  });

  it('is undone by axisFraction either way round, so drawing and zooming agree', () => {
    for (const invert of [false, true]) {
      const px = axisPosition(730, [200, 1200], 24, 400, invert);
      expect(200 + axisFraction(px, 24, 400, invert) * 1000).toBeCloseTo(730, 10);
    }
    // Mixing the flags is exactly the disagreement the pairing exists to prevent.
    const px = axisPosition(730, [200, 1200], 24, 400, true);
    expect(200 + axisFraction(px, 24, 400, false) * 1000).not.toBeCloseTo(730, 3);
  });

  it('lays reversed ticks out high-to-low and plain ones low-to-high', () => {
    const range: [number, number] = [0.02, 0.31];
    const { values } = axisTicks(range[0], range[1], 6);
    const place = (invert: boolean) => values.map(v => axisPosition(v, range, 88, 600, invert));
    const increasing = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
    expect(increasing(place(false))).toBe(true);
    expect(increasing(place(true))).toBe(false);
    expect(increasing(place(true).reverse())).toBe(true);
    // The leftmost tick on a reversed axis carries the highest value.
    const px = place(true);
    expect(values[px.indexOf(Math.min(...px))]).toBe(Math.max(...values));
  });

  it('puts every value in the middle of a range with no span', () => {
    expect(axisPosition(5, [5, 5], 0, 200)).toBe(100);
    expect(axisPosition(5, [5, 5], 0, 200, true)).toBe(100);
  });
});
