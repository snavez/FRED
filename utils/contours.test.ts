import { describe, it, expect } from 'vitest';
import { contourSpan, resampleContour } from './contours';

/** A token is just a duration and a value here — the plot supplies the accessors. */
interface Tok { dur: number; value: number }

const opts = {
  durationMs: (t: Tok) => t.dur,
  // Flat contour per token: its value while it lasts, nothing after it ends
  valueAtMs: (t: Tok, ms: number) => (ms <= t.dur ? t.value : NaN),
  samples: 5,
  minTokens: 2,
};

const toks = (...pairs: [number, number][]): Tok[] => pairs.map(([dur, value]) => ({ dur, value }));

describe('contourSpan', () => {
  it('is the median duration of the group', () => {
    expect(contourSpan(toks([10, 1], [20, 1], [90, 1]), t => t.dur)).toBe(20);
    expect(contourSpan(toks([10, 1], [30, 1]), t => t.dur)).toBe(20);
  });

  it('ignores tokens with no duration, and is 0 when none have one', () => {
    expect(contourSpan(toks([0, 1], [10, 1], [20, 1], [30, 1]), t => t.dur)).toBe(20);
    expect(contourSpan(toks([0, 1]), t => t.dur)).toBe(0);
    expect(contourSpan([], (t: Tok) => t.dur)).toBe(0);
  });

  it('is not moved by one very long token', () => {
    const normal = toks([20, 1], [30, 1], [40, 1]);
    const withOutlier = [...normal, { dur: 4000, value: 1 }];
    expect(contourSpan(withOutlier, t => t.dur)).toBeCloseTo(35);
    expect(contourSpan(withOutlier, t => t.dur)).toBeLessThan(50);
  });
});

describe('resampleContour', () => {
  it('samples from 0 to the group span', () => {
    const { xs, span } = resampleContour(toks([20, 5], [40, 5], [60, 5]), opts);
    expect(span).toBe(40);
    expect(xs).toEqual([0, 10, 20, 30, 40]);
  });

  it('averages only the tokens still sounding at each time', () => {
    // Two tokens end at 20 ms with value 10; two run to 60 ms with value 20
    const { cells } = resampleContour(toks([20, 10], [20, 10], [60, 20], [60, 20]), opts);
    expect(cells[0].mean).toBeCloseTo(15);   // 0 ms: all four
    expect(cells[4].mean).toBeCloseTo(20);   // 40 ms: only the long pair
  });

  it('leaves a gap rather than averaging too few tokens', () => {
    // Two of the three tokens carry no value at all: one is too few to average
    const missing = [{ dur: 40, value: 5 }, { dur: 40, value: NaN }, { dur: 40, value: NaN }];
    const { cells } = resampleContour(missing, opts);
    expect(cells.every(c => isNaN(c.mean))).toBe(true);
  });

  it('never averages fewer than half the group, by construction', () => {
    // The span is the median duration, so at every sample at least half the tokens
    // are still sounding — the tail is never one long token speaking for the group
    const group = toks([10, 1], [20, 2], [30, 3], [40, 4], [500, 5]);
    const { cells, span } = resampleContour(group, { ...opts, minTokens: 3 });
    expect(span).toBe(30);
    expect(cells.every(c => !isNaN(c.mean))).toBe(true);
  });

  it('reports the spread at each sample', () => {
    const { cells } = resampleContour(toks([40, 10], [40, 20], [40, 30]), opts);
    expect(cells[0].mean).toBeCloseTo(20);
    expect(cells[0].sd).toBeCloseTo(Math.sqrt(200 / 3));
  });

  it('depends only on the tokens it is given — the reported bug', () => {
    // A group's contour must not change when another, longer group joins the plot
    const alone = resampleContour(toks([20, 4], [26, 4], [30, 4]), opts);
    const alongsideOthers = resampleContour(toks([20, 4], [26, 4], [30, 4]), opts);
    expect(alongsideOthers.span).toBe(alone.span);
    expect(alongsideOthers.xs).toEqual(alone.xs);
    expect(alongsideOthers.cells.map(c => c.mean)).toEqual(alone.cells.map(c => c.mean));
    // …and its length is the group's own median duration, so it can be read off the axis
    expect(alone.span).toBe(26);
  });

  it('has nothing to draw for a group with no durations', () => {
    expect(resampleContour(toks([0, 1], [0, 2]), opts)).toEqual({ xs: [], cells: [], span: 0 });
    expect(resampleContour([], opts)).toEqual({ xs: [], cells: [], span: 0 });
  });
});
