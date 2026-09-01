import { quantile } from './plotRange';

/**
 * Mean contours over absolute time.
 *
 * Every group is resampled over its **own** span, from its own tokens: a contour is the
 * same line whoever else is on the plot. Sharing one grid across groups made each line's
 * shape and length depend on the longest group present, so adding a category silently
 * redrew the ones already there.
 *
 * The span runs to the group's median duration. Past that fewer than half its tokens are
 * still sounding, and a mean over the few longest tokens describes them rather than the
 * group — so contour length is readable as the group's median duration, and two contours
 * can be compared by eye.
 */

export interface ContourPoint {
  /** Mean over the tokens still sounding at this time; NaN where too few remain. */
  mean: number;
  sd: number;
}

export interface ContourSeries {
  /** Times sampled, from 0 to `span`. */
  xs: number[];
  cells: ContourPoint[];
  /** How far the contour reaches: the group's median duration. */
  span: number;
}

export interface ContourOptions<T> {
  /** The token's duration in the plot's time unit; 0 when it has none. */
  durationMs: (token: T) => number;
  /** The token's value at an absolute time, or NaN when it has ended or has no value. */
  valueAtMs: (token: T, ms: number) => number;
  /** Samples across the span. */
  samples?: number;
  /** Fewest tokens a mean may be taken over. */
  minTokens?: number;
}

/** The span a group's contour covers: its median duration, 0 when it has none. */
export const contourSpan = <T>(tokens: T[], durationMs: (token: T) => number): number => {
  const durations = tokens.map(durationMs).filter(d => d > 0).sort((a, b) => a - b);
  return durations.length ? quantile(durations, 0.5) : 0;
};

/** Resample one group's tokens onto its own time grid. */
export const resampleContour = <T>(tokens: T[], opts: ContourOptions<T>): ContourSeries => {
  const { durationMs, valueAtMs, samples = 40, minTokens = 2 } = opts;
  const span = contourSpan(tokens, durationMs);
  if (!(span > 0) || samples < 2) return { xs: [], cells: [], span: 0 };
  const xs = Array.from({ length: samples }, (_, j) => (j / (samples - 1)) * span);
  const cells = xs.map(x => {
    const values = tokens.map(t => valueAtMs(t, x)).filter(v => !isNaN(v));
    if (values.length < minTokens) return { mean: NaN, sd: NaN };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    return { mean, sd };
  });
  return { xs, cells, span };
};
