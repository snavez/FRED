/**
 * Zooming and panning by moving the axis, not the picture.
 *
 * Scaling the whole canvas shrinks the frame along with the data, so zooming out to look
 * for a stray token just makes everything smaller inside a smaller box, and anything past
 * the old limits stays hidden. Instead the frame stays where it is and the *range* it
 * shows changes: zoom out and the axis numbers grow to take in more data, zoom in and they
 * close around what is left. The Min/Max boxes then always say what is on screen.
 */

export type Range = [number, number];

/**
 * Zoom a range about an anchor given as a fraction along the axis (0 = the low end of
 * the range, 1 = the high end). `factor` above 1 zooms in — the span shrinks — and the
 * value under the anchor stays put.
 */
export const zoomRange = (range: Range, anchorFraction: number, factor: number): Range => {
  const [lo, hi] = range;
  const span = hi - lo;
  if (!isFinite(span) || span === 0 || !isFinite(factor) || factor <= 0) return range;
  const f = Math.min(1, Math.max(0, anchorFraction));
  const anchor = lo + f * span;
  const nextSpan = span / factor;
  return [anchor - f * nextSpan, anchor + (1 - f) * nextSpan];
};

/** Slide a range along by a fraction of its own span. */
export const panRange = (range: Range, fraction: number): Range => {
  const [lo, hi] = range;
  const shift = (hi - lo) * fraction;
  return isFinite(shift) ? [lo + shift, hi + shift] : range;
};

/**
 * Where a value sits along an axis as a 0..1 fraction, honouring a reversed axis (F1 and
 * F2 both run high-to-low in a vowel plot).
 */
export const axisFraction = (position: number, start: number, length: number, invert = false): number => {
  if (length === 0) return 0;
  const f = (position - start) / length;
  return invert ? 1 - f : f;
};
