/**
 * Axis ticks and the text that labels them.
 *
 * A tick label has to survive two hazards. Walking an axis in `(max - min) / n` steps
 * accumulates float error, so a tick that should read 0.06 arrives as
 * 0.060000000000000005; and formatting an arbitrary step to a fixed number of decimals
 * rounds neighbouring ticks onto the same text, or onto a value the step never visits —
 * a 0.0178 step formatted with `toFixed(2)` reads 0, .02, .04, .05, .07, .09, which is
 * neither evenly spaced nor true. Both are cured the same way: choose a *nice* step
 * first, snap every tick onto it, and format to the decimals that step actually needs.
 */

/** Multiples of a power of ten that read fluently on an axis. */
const NICE_MULTIPLES = [1, 2, 5, 10];

/**
 * The nice step closest to `rawStep`, as a ratio — 1, 2 or 5 × 10^k. Closest in ratio
 * rather than in difference, so the choice does not depend on the axis's magnitude.
 */
export const niceStep = (rawStep: number): number => {
  if (!isFinite(rawStep) || rawStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const distance = (m: number) => Math.abs(Math.log(norm / m));
  return NICE_MULTIPLES.reduce((best, m) => distance(m) < distance(best) ? m : best) * mag;
};

/**
 * Decimal places a step needs. Enough that consecutive ticks never round onto the same
 * text, and no more — a 0.02 step wants two decimals, a step of 5 wants none.
 */
export const tickDecimals = (step: number): number => {
  if (!isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.min(20, Math.ceil(-Math.log10(step) - 1e-9)));
};

/** Drop the float dust left by `i * step` without changing the value a reader sees. */
const snap = (value: number): number => parseFloat(value.toPrecision(12));

/**
 * Tick text for a value on a given step. Formatted to the step's decimals, so a column
 * of labels shares one shape, and never rendered as a negative zero.
 */
export const formatTickValue = (value: number, step: number): string => {
  if (!isFinite(value)) return '';
  const decimals = tickDecimals(step);
  const text = snap(value).toFixed(decimals);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
};

export interface AxisTicks {
  /** Tick positions, ascending, every one a multiple of `step` inside the range. */
  values: number[];
  /** The nice step the ticks sit on; also what `formatTickValue` formats against. */
  step: number;
  /** `values` as display text, index-aligned. */
  labels: string[];
}

/**
 * Ticks on a nice step within [min, max]. `target` is the tick count aimed for, not
 * promised: the step is chosen for readability first, so the range decides how many of
 * them fall inside it. A degenerate range yields the single value it contains.
 */
export const axisTicks = (min: number, max: number, target = 5): AxisTicks => {
  const label = (values: number[], step: number): AxisTicks =>
    ({ values, step, labels: values.map(v => formatTickValue(v, step)) });
  if (!isFinite(min) || !isFinite(max)) return label([], 1);
  if (max <= min) return label([snap(min)], niceStep(Math.abs(min) / 10 || 1));

  const step = niceStep((max - min) / Math.max(1, target));
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  const values: number[] = [];
  for (let i = first; i <= last; i++) values.push(snap(i * step));
  return label(values, step);
};

/**
 * Text for a measured value shown beside the data — a box's centre, a tooltip figure.
 * Unlike a tick it stands alone, so it carries significant digits rather than a shared
 * number of decimals, and drops trailing zeros that say nothing.
 */
export const formatMeasureValue = (value: number, significant = 3): string => {
  if (!isFinite(value)) return '';
  if (value === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, Math.min(20, significant - 1 - magnitude));
  return parseFloat(value.toFixed(decimals)).toString();
};
