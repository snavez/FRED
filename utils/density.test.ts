import { describe, it, expect } from 'vitest';
import { gaussianKde, histogramDensityBands, linspace, silvermanBandwidth } from './density';

// Reference values computed independently with numpy/scipy: R's bw.nrd0 (sample SD,
// type-7 quartiles) and a Gaussian KDE summed over every value.
const tailed = [2.1, 2.5, 2.7, 3.0, 3.2, 3.3, 3.9, 4.4, 5.0, 6.8];
const bimodal = [1, 1, 1, 1, 9, 9, 9, 9];

/** Trapezoid-rule area under ys sampled at xs. */
const area = (ys: number[], xs: number[]) =>
  ys.slice(1).reduce((a, y, i) => a + ((y + ys[i]) / 2) * (xs[i + 1] - xs[i]), 0);

describe('linspace', () => {
  it('spaces values evenly and includes both ends', () => {
    expect(linspace(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const grid = linspace(2, 7, 300);
    expect(grid).toHaveLength(300);
    expect(grid[0]).toBe(2);
    expect(grid[299]).toBe(7);
  });

  it('handles counts too small to span a range', () => {
    expect(linspace(3, 9, 1)).toEqual([3]);
    expect(linspace(3, 9, 0)).toEqual([]);
  });
});

describe('silvermanBandwidth', () => {
  it("matches R's bw.nrd0 when the IQR is the smaller spread", () => {
    expect(silvermanBandwidth(tailed)).toBeCloseTo(0.635665981379, 10);
  });

  it("matches R's bw.nrd0 when the SD is the smaller spread", () => {
    expect(silvermanBandwidth(bimodal)).toBeCloseTo(2.539103925214, 10);
  });

  it('still gives identical values a width, as bw.nrd0 does', () => {
    expect(silvermanBandwidth([4, 4, 4])).toBeCloseTo(2.889869622337, 10);
    expect(silvermanBandwidth([0, 0, 0])).toBeCloseTo(0.722467405584, 10);
  });

  it('ignores non-finite values and does not care about order', () => {
    expect(silvermanBandwidth([...tailed, NaN, Infinity])).toBe(silvermanBandwidth(tailed));
    expect(silvermanBandwidth([...tailed].reverse())).toBeCloseTo(silvermanBandwidth(tailed), 12);
  });

  it('narrows as the sample grows', () => {
    const many = Array.from({ length: 8 }, () => tailed).flat();
    expect(silvermanBandwidth(many)).toBeLessThan(silvermanBandwidth(tailed));
  });

  it('refuses fewer than two finite values', () => {
    expect(silvermanBandwidth([])).toBeNaN();
    expect(silvermanBandwidth([3])).toBeNaN();
    expect(silvermanBandwidth([3, NaN])).toBeNaN();
  });
});

describe('gaussianKde', () => {
  it("matches the reference at Silverman's bandwidth", () => {
    const d = gaussianKde(tailed, [1, 3, 4.5, 8], silvermanBandwidth(tailed));
    expect(d[0]).toBeCloseTo(0.020369714096, 8);
    expect(d[1]).toBeCloseTo(0.332906452884, 8);
    expect(d[2]).toBeCloseTo(0.172166609144, 8);
    expect(d[3]).toBeCloseTo(0.010564896756, 8);
  });

  it('matches the reference at a chosen bandwidth', () => {
    const d = gaussianKde(tailed, [1, 3, 4.5, 8], 0.5);
    expect(d[0]).toBeCloseTo(0.008261518757, 8);
    expect(d[1]).toBeCloseTo(0.368316389884, 8);
    expect(d[2]).toBeCloseTo(0.173673731145, 8);
    expect(d[3]).toBeCloseTo(0.004478907275, 8);
  });

  it('integrates to 1', () => {
    const grid = linspace(-10, 20, 3001);
    expect(area(gaussianKde(tailed, grid, 0.6), grid)).toBeCloseTo(1, 4);
  });

  it('gives the full-sum answer on a long tail, where most kernels are skipped', () => {
    const values = Array.from({ length: 500 }, (_, i) => (i ** 3) / 1e4);
    const grid = linspace(0, 12500, 50);
    const h = 40;
    const full = grid.map(g => values.reduce((s, v) => s + Math.exp(-0.5 * ((g - v) / h) ** 2), 0)
      / (values.length * h * Math.sqrt(2 * Math.PI)));
    const windowed = gaussianKde(values, grid, h);
    windowed.forEach((d, i) => expect(Math.abs(d - full[i])).toBeLessThanOrEqual(1e-8 * Math.max(...full)));
  });

  it('is flat zero with nothing to estimate from or no usable bandwidth', () => {
    expect(gaussianKde([], [0, 1], 1)).toEqual([0, 0]);
    expect(gaussianKde(tailed, [0, 1], 0)).toEqual([0, 0]);
    expect(gaussianKde(tailed, [0, 1], -1)).toEqual([0, 0]);
    expect(gaussianKde(tailed, [0, 1], NaN)).toEqual([0, 0]);
  });
});

describe('histogramDensityBands', () => {
  const grid = linspace(-15, 30, 4001);
  const groups = [{ key: 'a', values: tailed }, { key: 'b', values: bimodal }];
  const base = { bandwidthAdjust: 1, binWidth: 0.4, total: tailed.length + bimodal.length };

  it('scales a count-mode curve to tokens per bin, like the bars', () => {
    const [band] = histogramDensityBands([groups[0]], grid, { ...base, yMode: 'count', stacked: false });
    expect(area(band.upper, grid)).toBeCloseTo(tailed.length * 0.4, 3);
  });

  it("scales density-mode curves by each group's share of the whole sample", () => {
    const bands = histogramDensityBands(groups, grid, { ...base, yMode: 'density', stacked: false });
    expect(area(bands[0].upper, grid)).toBeCloseTo(tailed.length / base.total, 3);
    expect(area(bands[1].upper, grid)).toBeCloseTo(bimodal.length / base.total, 3);
  });

  it('stacks each group on the ones before it, as stacked bars do', () => {
    const [a, b] = histogramDensityBands(groups, grid, { ...base, yMode: 'density', stacked: true });
    expect(a.lower.every(v => v === 0)).toBe(true);
    expect(b.lower).toEqual(a.upper);
    // Stacked densities add up to the density of the whole sample.
    expect(area(b.upper, grid)).toBeCloseTo(1, 3);
  });

  it('starts every overlaid group from zero', () => {
    const bands = histogramDensityBands(groups, grid, { ...base, yMode: 'density', stacked: false });
    expect(bands.every(band => band.lower.every(v => v === 0))).toBe(true);
  });

  it("multiplies each group's own Silverman bandwidth, smoothing as it grows", () => {
    const at = (adjust: number) => histogramDensityBands(groups, grid, { ...base, bandwidthAdjust: adjust, yMode: 'count', stacked: false });
    const [a1, b1] = at(1), [a2] = at(2), [aHalf] = at(0.5);
    expect(a1.bandwidth).toBeCloseTo(silvermanBandwidth(tailed), 12);
    expect(b1.bandwidth).toBeCloseTo(silvermanBandwidth(bimodal), 12);
    expect(a2.bandwidth).toBeCloseTo(2 * a1.bandwidth, 12);
    const peak = (band: { upper: number[] }) => Math.max(...band.upper);
    expect(peak(aHalf)).toBeGreaterThan(peak(a1));
    expect(peak(a2)).toBeLessThan(peak(a1));
  });

  it('draws no curve for a group too small to estimate, or with no usable multiplier', () => {
    const withTiny = [...groups, { key: 'one', values: [5] }];
    expect(histogramDensityBands(withTiny, grid, { ...base, yMode: 'count', stacked: false }).map(b => b.key)).toEqual(['a', 'b']);
    expect(histogramDensityBands(groups, grid, { ...base, bandwidthAdjust: 0, yMode: 'count', stacked: false })).toEqual([]);
  });
});
