import { describe, it, expect } from 'vitest';
import { fitRange, quantile } from './plotRange';

describe('quantile', () => {
  const data = [1, 2, 3, 4, 5];

  it('reads the ends and the middle', () => {
    expect(quantile(data, 0)).toBe(1);
    expect(quantile(data, 0.5)).toBe(3);
    expect(quantile(data, 1)).toBe(5);
  });

  it('interpolates between samples', () => {
    expect(quantile(data, 0.125)).toBeCloseTo(1.5);
  });

  it('clamps out-of-range probabilities and handles an empty array', () => {
    expect(quantile(data, -1)).toBe(1);
    expect(quantile(data, 2)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe('fitRange', () => {
  it('contains every must-see value, with padding', () => {
    const [lo, hi] = fitRange([10, 20], [], { pad: 0.1 });
    expect(lo).toBeCloseTo(9);
    expect(hi).toBeCloseTo(21);
  });

  it('is not dragged out by a lone extreme value in the tail', () => {
    // Means sit at 10–20; one token at 1000 must not rescale the plot around it
    const cloud = [...Array.from({ length: 99 }, (_, i) => 10 + i * 0.1), 1000];
    const [lo, hi] = fitRange([10, 20], cloud, { trim: 0.02, pad: 0 });
    expect(hi).toBeLessThan(30);
    expect(lo).toBeCloseTo(10);
    // The summary it exists to show still occupies most of the axis
    expect((20 - 10) / (hi - lo)).toBeGreaterThan(0.5);
  });

  it('widens to the tail when the cloud genuinely reaches further', () => {
    const cloud = Array.from({ length: 100 }, (_, i) => i); // 0…99, evenly spread
    const [lo, hi] = fitRange([40, 60], cloud, { trim: 0.02, pad: 0 });
    expect(lo).toBeCloseTo(1.98, 1);
    expect(hi).toBeCloseTo(97.02, 1);
  });

  it('fits a tail-only range when there is nothing that must be shown', () => {
    const [lo, hi] = fitRange([], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { trim: 0, pad: 0 });
    expect([lo, hi]).toEqual([0, 9]);
  });

  it('gives a usable range for degenerate input', () => {
    expect(fitRange([], [])).toEqual([0, 1]);
    expect(fitRange([NaN, Infinity])).toEqual([0, 1]);
    // A single value still gets a span around it rather than a zero-height axis
    const [lo, hi] = fitRange([5]);
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeLessThan(5);
    expect(hi).toBeGreaterThan(5);
  });

  it('ignores non-finite values instead of poisoning the range', () => {
    const [lo, hi] = fitRange([10, NaN, 20], [NaN, Infinity], { pad: 0 });
    expect([lo, hi]).toEqual([10, 20]);
  });
});
