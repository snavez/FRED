/**
 * Geometry for a row of bars sharing one horizontal band.
 *
 * The band is divided into equal slots once the inter-bar gaps have been taken
 * out, and each bar is drawn centred in its slot at `widthPct` of the slot's
 * width. A gap of 0 at full width therefore makes neighbouring bars abut
 * exactly, and the outermost bars sit flush against the edges of the band.
 */
export interface BarBand {
  /** Width of one slot, excluding the gap that follows it. */
  slotW: number;
  /** Width of the bar drawn inside a slot. */
  barW: number;
  /** Left edge of slot `i`. */
  slotX: (i: number) => number;
  /** Left edge of the bar drawn in slot `i`. */
  barX: (i: number) => number;
}

/**
 * Lay out `count` bars across `width` pixels starting at `x`, separated by
 * `gap` pixels and occupying `widthPct` (0–100) of the space left for each.
 */
export function layoutBarBand(
  x: number,
  width: number,
  count: number,
  gap: number,
  widthPct: number,
): BarBand {
  const n = Math.max(1, Math.floor(count));
  const g = n > 1 ? Math.max(0, Math.min(gap, width / n)) : 0;
  const slotW = Math.max(0, (width - (n - 1) * g) / n);
  const barW = (slotW * Math.max(0, Math.min(widthPct, 100))) / 100;
  const slotX = (i: number) => x + i * (slotW + g);
  return { slotW, barW, slotX, barX: (i: number) => slotX(i) + (slotW - barW) / 2 };
}
