/**
 * Axis ranges that show what a plot actually draws.
 *
 * Spectral and formant measures are long-tailed: a handful of tokens can sit several
 * times further from the centre than everything else. Ranging on the raw extent then
 * squeezes the summary the plot exists to show — group means, boxes — into a sliver at
 * one edge. These helpers separate the two roles a value can play: values that *must*
 * be visible, and the surrounding cloud that may widen the range only so far.
 */

/** Value at a quantile of an ascending array, interpolating between samples. */
export const quantile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos), hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export interface FitRangeOptions {
  /** Quantile trimmed from each end of `tail` (0.02 = ignore the outer 2%). */
  trim?: number;
  /** Fraction of the span added as breathing room at each end. */
  pad?: number;
}

/**
 * A range containing every `must` value, widened towards the `tail` cloud but no further
 * than its trimmed quantiles. Anything past the edge is left to the plot's clip region,
 * so one extreme token cannot rescale the whole picture.
 *
 * Returns [0, 1] when there is nothing finite to fit.
 */
export const fitRange = (
  must: number[], tail: number[] = [], { trim = 0.02, pad = 0.06 }: FitRangeOptions = {},
): [number, number] => {
  const ascending = (a: number[]) => a.filter(v => isFinite(v)).sort((x, y) => x - y);
  const m = ascending(must), t = ascending(tail);
  let lo = m.length ? m[0] : NaN;
  let hi = m.length ? m[m.length - 1] : NaN;
  if (t.length) {
    const tLo = quantile(t, trim), tHi = quantile(t, 1 - trim);
    lo = isFinite(lo) ? Math.min(lo, tLo) : tLo;
    hi = isFinite(hi) ? Math.max(hi, tHi) : tHi;
  }
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  // A single value has no span to take a fraction of, so give it one either way — an
  // axis of zero height would divide by zero when mapping.
  const span = hi > lo ? (hi - lo) * pad : (Math.abs(hi) * (pad || 0.06) || 1);
  return [lo - span, hi + span];
};
