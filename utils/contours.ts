import { quantile } from './plotRange';

/**
 * Group summaries over time, for every plot that draws a mean trajectory.
 *
 * Tokens are sampled in **normalised time**: each token's track is measured at the same
 * set of positions through its own segment, whatever that segment's real duration. A
 * group summary is therefore taken across tokens position by position — every token
 * contributes to every point, and every point averages the same phase of the gesture.
 *
 * Putting that summary on a millisecond axis is a matter of *placement*, not of
 * re-averaging: the positions are laid out across the group's **median duration**, so
 * `t` ends at 29 ms and `tˢ` at 67 ms and the two shapes stay comparable. Sampling each
 * token at fixed real times instead would mix phases — at 30 ms a 30 ms token is
 * finishing while a 100 ms token is barely started — and would drop short tokens out of
 * the tail, leaving the right-hand end of every curve describing the longest tokens
 * rather than the group. Neither happens here: `n` is the same at every point.
 *
 * What the axis then cannot show is the spread of durations *within* a group; the faded
 * per-token lines, drawn at their own real durations, are what carry that.
 */

/** Where the line goes, and what the band around it means. */
export interface SummaryOptions {
  /** The line itself: the mean, or the median for a skewed distribution. */
  centre: 'mean' | 'median';
  /** The ribbon: none, mean ± 1 SD, or the 16th–84th percentiles. */
  band: 'none' | 'sd' | 'quantile';
}

/** One position's summary across a group's tokens. */
export interface SummaryPoint {
  /** The centre line's value; NaN when no token carried a value here. */
  centre: number;
  /** Band bounds, NaN when no band was asked for or none could be computed. */
  lo: number;
  hi: number;
  /** How many tokens were summarised. Constant across a series, by construction. */
  n: number;
}

const EMPTY: SummaryPoint = { centre: NaN, lo: NaN, hi: NaN, n: 0 };

/**
 * Summarise one position's values.
 *
 * The SD band is always `mean ± sd`, even when the centre line is the median: a median
 * plus a standard deviation is not a quantity. On a skewed distribution the two will not
 * be concentric, which is the honest reading — pair a median with the quantile band.
 */
export const summarise = (values: number[], opts: SummaryOptions): SummaryPoint => {
  const v = values.filter(x => !isNaN(x));
  if (v.length === 0) return EMPTY;
  const sorted = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const centre = opts.centre === 'median' ? quantile(sorted, 0.5) : mean;
  if (opts.band === 'sd') {
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    return { centre, lo: mean - sd, hi: mean + sd, n: v.length };
  }
  if (opts.band === 'quantile') {
    return { centre, lo: quantile(sorted, 0.16), hi: quantile(sorted, 0.84), n: v.length };
  }
  return { centre, lo: NaN, hi: NaN, n: v.length };
};

export interface ContourSeries {
  /** Where each sample sits on the axis: normalised positions, or milliseconds. */
  xs: number[];
  cells: SummaryPoint[];
  /** How far the contour reaches in milliseconds: the group's median duration. 0 in
   *  normalised time, where the contour spans the positions it was given. */
  span: number;
}

export interface ContourOptions<T> {
  /** The normalised positions the tokens are sampled at, in order. */
  positions: number[];
  /** A token's value at `positions[i]`, or NaN where it has none. */
  valueAt: (token: T, index: number) => number;
  /** Where the line goes and what the band shows. */
  summary: SummaryOptions;
  /**
   * Supply to place the summary on a millisecond axis: the token's duration in the
   * plot's time unit, 0 when it has none. Omit to keep the normalised positions.
   */
  durationMs?: (token: T) => number;
}

/** The span a group's contour covers: its median duration, 0 when it has none. */
export const contourSpan = <T>(tokens: T[], durationMs: (token: T) => number): number => {
  const durations = tokens.map(durationMs).filter(d => d > 0).sort((a, b) => a - b);
  return durations.length ? quantile(durations, 0.5) : 0;
};

/**
 * Whether a summarised group has anything to draw. A group can be in the legend and still
 * have no contour: none of its tokens carry the measurement, or none carry a duration.
 */
export const hasContour = (series: ContourSeries): boolean =>
  series.cells.some(c => !isNaN(c.centre));

/**
 * Summarise one group across the positions its tokens share, and lay the result out on
 * whichever axis was asked for.
 *
 * With `durationMs`, positions keep their relative spacing but are stretched across the
 * group's median duration — a group is summarised from its own tokens alone, so a contour
 * is the same line whoever else is on the plot.
 */
export const contourSeries = <T>(tokens: T[], opts: ContourOptions<T>): ContourSeries => {
  const { positions, valueAt, summary, durationMs } = opts;
  if (positions.length === 0) return { xs: [], cells: [], span: 0 };

  const cells = positions.map((_, i) => summarise(tokens.map(t => valueAt(t, i)), summary));

  if (!durationMs) return { xs: positions, cells, span: 0 };

  const span = contourSpan(tokens, durationMs);
  if (!(span > 0)) return { xs: [], cells: [], span: 0 };
  const first = positions[0], last = positions[positions.length - 1];
  const reach = last - first;
  const xs = positions.map(p => (reach > 0 ? (p - first) / reach : 0) * span);
  return { xs, cells, span };
};
