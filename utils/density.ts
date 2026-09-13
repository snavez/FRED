import { quantile } from './plotRange';

/**
 * Smoothed distributions: a Gaussian kernel density estimate and the bandwidth to give it.
 *
 * A histogram counts what fell in each bin, so its shape depends on where the bins happen
 * to start and how wide they are. A kernel density estimate puts a small Gaussian on every
 * value and adds them up, which gives the shape without the binning. The one choice it
 * does need — how wide each Gaussian is — is the bandwidth.
 */

/** `count` evenly spaced values from `lo` to `hi`, both ends included. */
export const linspace = (lo: number, hi: number, count: number): number[] => {
  if (count <= 1) return count === 1 ? [lo] : [];
  return Array.from({ length: count }, (_, i) => lo + (hi - lo) * (i / (count - 1)));
};

/**
 * Silverman's rule of thumb, as R's `bw.nrd0` computes it: 0.9 · min(sd, IQR/1.34) · n^-1/5,
 * from the sample standard deviation and linearly interpolated quartiles. The IQR keeps a
 * long tail from inflating the width; the SD keeps a two-humped spread from doing the same.
 * When the smaller is zero it falls back to the SD, then to the size of the first value,
 * then to 1, so even identical values get a width.
 *
 * NaN for fewer than two finite values: one token has no spread to estimate a shape from.
 */
export const silvermanBandwidth = (values: number[]): number => {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  if (n < 2) return NaN;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  const sorted = [...xs].sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const spread = Math.min(sd, iqr / 1.34) || sd || Math.abs(xs[0]) || 1;
  return 0.9 * spread * Math.pow(n, -0.2);
};

/**
 * Kernels are summed only within this many bandwidths of each point. Past it a Gaussian is
 * below 1e-8 of its peak, and a long-tailed measure would otherwise pay for every token in
 * the tail at every point along the curve.
 */
const KERNEL_REACH = 6;

/** Index of the first value in an ascending array that is at least `target`. */
const firstAtLeast = (sorted: number[], target: number): number => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
};

/**
 * Gaussian kernel density of `values` at each grid point, integrating to 1 over the whole
 * line. Zeros when there is nothing to estimate from or the bandwidth is not positive.
 */
export const gaussianKde = (values: number[], grid: number[], bandwidth: number): number[] => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0 || !(bandwidth > 0) || !isFinite(bandwidth)) return grid.map(() => 0);
  const norm = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
  const reach = KERNEL_REACH * bandwidth;
  return grid.map(g => {
    let sum = 0;
    for (let i = firstAtLeast(xs, g - reach); i < n && xs[i] <= g + reach; i++) {
      const u = (g - xs[i]) / bandwidth;
      sum += Math.exp(-0.5 * u * u);
    }
    return sum * norm;
  });
};

export interface DensityBand {
  key: string;
  /** Where the band starts at each grid point: 0, or the top of the groups stacked below. */
  lower: number[];
  upper: number[];
  /** The bandwidth this group's curve was estimated with. */
  bandwidth: number;
}

export interface HistogramDensityOptions {
  /** Multiplies each group's Silverman bandwidth: 1 is the rule itself, higher is smoother. */
  bandwidthAdjust: number;
  /** The histogram's y axis: tokens per bin, or density over the whole sample. */
  yMode: 'count' | 'density';
  binWidth: number;
  /** Tokens in the whole histogram, across every group. */
  total: number;
  /** Stack each group on the ones before it, as stacked bars do. */
  stacked: boolean;
}

/**
 * One density curve per group, on the histogram's own y scale, ready to fill.
 *
 * A KDE integrates to 1, but a histogram's bars do not. In count mode a bar holds the tokens
 * that fell in its bin, so a group's curve is scaled by the group's size and the bin width.
 * In density mode each group's bars are divided by the whole sample — stacked groups add up
 * to the overall density — so its curve is scaled by its share of the sample. Either way a
 * curve lands on the same footing as the bars it overlays. A group with fewer than two
 * values has no curve.
 */
export const histogramDensityBands = (
  groups: { key: string; values: number[] }[], grid: number[], opts: HistogramDensityOptions,
): DensityBand[] => {
  let floor = grid.map(() => 0);
  return groups.flatMap(({ key, values }) => {
    const finite = values.filter(Number.isFinite);
    const bandwidth = silvermanBandwidth(finite) * opts.bandwidthAdjust;
    if (!(bandwidth > 0)) return [];
    const scale = finite.length * (opts.yMode === 'count' ? opts.binWidth : 1 / opts.total);
    const lower = opts.stacked ? floor : grid.map(() => 0);
    const upper = gaussianKde(finite, grid, bandwidth).map((d, i) => lower[i] + d * scale);
    if (opts.stacked) floor = upper;
    return [{ key, lower, upper, bandwidth }];
  });
};
