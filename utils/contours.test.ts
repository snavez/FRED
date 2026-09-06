import { describe, it, expect } from 'vitest';
import { contourSeries, contourSpan, hasContour, summarise, SummaryOptions } from './contours';

/** A token is a duration and a value at each normalised position. */
interface Tok { dur: number; values: number[] }

const MEAN_SD: SummaryOptions = { centre: 'mean', band: 'sd' };
const MEDIAN_Q: SummaryOptions = { centre: 'median', band: 'quantile' };

/** Flat tokens: one value held across all five positions. */
const flat = (...pairs: [number, number][]): Tok[] =>
  pairs.map(([dur, value]) => ({ dur, values: [value, value, value, value, value] }));

const POSITIONS = [0, 1, 2, 3, 4];
const opts = (summary: SummaryOptions, absolute = true) => ({
  positions: POSITIONS,
  valueAt: (t: Tok, i: number) => t.values[i],
  summary,
  ...(absolute ? { durationMs: (t: Tok) => t.dur } : {}),
});

describe('summarise', () => {
  it('takes the mean and the population SD around it', () => {
    const s = summarise([10, 20, 30], MEAN_SD);
    expect(s.centre).toBeCloseTo(20);
    expect(s.hi - s.centre).toBeCloseTo(Math.sqrt(200 / 3));
    expect(s.centre - s.lo).toBeCloseTo(Math.sqrt(200 / 3));
    expect(s.n).toBe(3);
  });

  it('takes the median and the 16th/84th percentiles', () => {
    const s = summarise([1, 2, 3, 4, 100], MEDIAN_Q);
    expect(s.centre).toBe(3);
    expect(s.lo).toBeCloseTo(1.64);
    expect(s.hi).toBeCloseTo(38.56);
  });

  it('describes a right-skewed group better as median and quantiles', () => {
    // The reported case: mean ± SD claims a lower bound the data does not support,
    // and puts the centre well above where half the tokens actually sit.
    const skewed = [1400, 1500, 1700, 2000, 2350, 2800, 3600, 4200, 6000];
    const bySd = summarise(skewed, MEAN_SD);
    const byQuantile = summarise(skewed, MEDIAN_Q);
    expect(byQuantile.centre).toBeLessThan(bySd.centre);
    expect(byQuantile.lo).toBeGreaterThan(bySd.lo);
    expect(byQuantile.hi - byQuantile.centre).toBeGreaterThan(byQuantile.centre - byQuantile.lo);
  });

  it('reports no band when none was asked for', () => {
    const s = summarise([10, 20], { centre: 'mean', band: 'none' });
    expect(s.centre).toBeCloseTo(15);
    expect(isNaN(s.lo) && isNaN(s.hi)).toBe(true);
  });

  it('ignores missing values but still summarises what remains', () => {
    expect(summarise([10, NaN, 20], MEAN_SD).n).toBe(2);
    expect(summarise([10, NaN, 20], MEAN_SD).centre).toBeCloseTo(15);
  });

  it('is empty when nothing was measured', () => {
    expect(summarise([NaN, NaN], MEAN_SD)).toEqual({ centre: NaN, lo: NaN, hi: NaN, n: 0 });
    expect(summarise([], MEAN_SD).n).toBe(0);
  });
});

describe('contourSpan', () => {
  it('is the median duration of the group', () => {
    expect(contourSpan(flat([10, 1], [20, 1], [90, 1]), t => t.dur)).toBe(20);
    expect(contourSpan(flat([10, 1], [30, 1]), t => t.dur)).toBe(20);
  });

  it('ignores tokens with no duration, and is 0 when none have one', () => {
    expect(contourSpan(flat([0, 1], [10, 1], [20, 1], [30, 1]), t => t.dur)).toBe(20);
    expect(contourSpan(flat([0, 1]), t => t.dur)).toBe(0);
    expect(contourSpan([], (t: Tok) => t.dur)).toBe(0);
  });

  it('is not moved by one very long token', () => {
    const withOutlier = [...flat([20, 1], [30, 1], [40, 1]), { dur: 4000, values: [1, 1, 1, 1, 1] }];
    expect(contourSpan(withOutlier, t => t.dur)).toBeCloseTo(35);
  });
});

describe('contourSeries', () => {
  it('keeps the normalised positions when no duration is given', () => {
    const { xs, span } = contourSeries(flat([20, 5], [40, 5]), opts(MEAN_SD, false));
    expect(xs).toEqual(POSITIONS);
    expect(span).toBe(0);
  });

  it('stretches the positions across the group median duration', () => {
    const { xs, span } = contourSeries(flat([20, 5], [40, 5], [60, 5]), opts(MEAN_SD));
    expect(span).toBe(40);
    expect(xs).toEqual([0, 10, 20, 30, 40]);
  });

  it('preserves uneven position spacing when placed on a time axis', () => {
    const uneven = { ...opts(MEAN_SD), positions: [0, 25, 50, 100] };
    const toks = [{ dur: 80, values: [1, 1, 1, 1] }, { dur: 80, values: [1, 1, 1, 1] }];
    expect(contourSeries(toks, uneven).xs).toEqual([0, 20, 40, 80]);
  });

  it('summarises every token at every point — no survivorship', () => {
    // Two short tokens at 10 and two long ones at 20. Every point is the mean of all
    // four, including the last: a short token does not drop out of the tail.
    const group = flat([20, 10], [20, 10], [60, 20], [60, 20]);
    const { cells } = contourSeries(group, opts(MEAN_SD));
    expect(cells.every(c => c.n === 4)).toBe(true);
    expect(cells.every(c => c.centre === 15)).toBe(true);
  });

  it('averages the same phase at every point — no phase mixing', () => {
    // Both tokens rise 0 → 4 across their own release; one lasts 20 ms, one 60 ms.
    // Every point averages the same phase, so the contour is the shared shape.
    const rising = [{ dur: 20, values: [0, 1, 2, 3, 4] }, { dur: 60, values: [0, 1, 2, 3, 4] }];
    const { cells, span } = contourSeries(rising, opts(MEAN_SD));
    expect(cells.map(c => c.centre)).toEqual([0, 1, 2, 3, 4]);
    expect(span).toBe(40);
  });

  it('keeps a group independent of the others on the plot', () => {
    const group = flat([20, 4], [26, 4], [30, 4]);
    const alone = contourSeries(group, opts(MEAN_SD));
    const alongsideOthers = contourSeries(group, opts(MEAN_SD));
    expect(alongsideOthers.span).toBe(alone.span);
    expect(alongsideOthers.xs).toEqual(alone.xs);
    // …and its length reads off the axis as the group's own median duration
    expect(alone.span).toBe(26);
  });

  it('leaves a gap where a position was never measured', () => {
    const partial = [
      { dur: 40, values: [5, NaN, 5, 5, 5] },
      { dur: 40, values: [7, NaN, 7, 7, 7] },
    ];
    const { cells } = contourSeries(partial, opts(MEAN_SD));
    expect(isNaN(cells[1].centre)).toBe(true);
    expect(cells[0].centre).toBeCloseTo(6);
  });

  it('has nothing to place on a time axis without durations', () => {
    expect(contourSeries(flat([0, 1], [0, 2]), opts(MEAN_SD))).toEqual({ xs: [], cells: [], span: 0 });
    expect(contourSeries([], opts(MEAN_SD))).toEqual({ xs: [], cells: [], span: 0 });
  });
});

describe('hasContour', () => {
  it('is true when any position was summarised', () => {
    expect(hasContour(contourSeries(flat([40, 10], [40, 20]), opts(MEAN_SD)))).toBe(true);
  });

  it('is false for a group whose tokens carry no values — the reported /d/ case', () => {
    const noValues = [{ dur: 40, values: [NaN, NaN, NaN, NaN, NaN] }];
    expect(hasContour(contourSeries(noValues, opts(MEAN_SD)))).toBe(false);
  });

  it('is false for a group with no durations to draw across', () => {
    expect(hasContour(contourSeries(flat([0, 1], [0, 2]), opts(MEAN_SD)))).toBe(false);
    expect(hasContour(contourSeries([], opts(MEAN_SD)))).toBe(false);
  });
});
