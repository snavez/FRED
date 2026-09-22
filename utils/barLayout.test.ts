import { describe, it, expect } from 'vitest';
import { layoutBarBand } from './barLayout';

describe('layoutBarBand', () => {
  it('fills the band exactly when there is no gap and bars are full width', () => {
    const band = layoutBarBand(0, 100, 4, 0, 100);
    expect(band.slotW).toBe(25);
    expect(band.barW).toBe(25);
    expect(band.barX(0)).toBe(0);
    expect(band.barX(3)).toBe(75);
    expect(band.barX(3) + band.barW).toBe(100);
  });

  it('makes neighbouring bars abut when the gap is zero', () => {
    const band = layoutBarBand(10, 90, 3, 0, 100);
    for (let i = 1; i < 3; i++) {
      expect(band.barX(i)).toBeCloseTo(band.barX(i - 1) + band.barW);
    }
  });

  it('takes the gaps out of the band rather than off the end', () => {
    const band = layoutBarBand(0, 100, 3, 5, 100);
    expect(band.slotW).toBeCloseTo(30);
    expect(band.barX(2) + band.barW).toBeCloseTo(100);
  });

  it('centres a narrowed bar in its slot', () => {
    const band = layoutBarBand(0, 100, 2, 0, 50);
    expect(band.slotW).toBe(50);
    expect(band.barW).toBe(25);
    expect(band.barX(0)).toBe(12.5);
    expect(band.barX(1)).toBe(62.5);
  });

  it('gives a single bar the whole band, ignoring the gap', () => {
    const band = layoutBarBand(0, 80, 1, 20, 100);
    expect(band.slotW).toBe(80);
    expect(band.barX(0)).toBe(0);
  });

  it('never yields a negative slot or bar width', () => {
    const wide = layoutBarBand(0, 100, 4, 999, 100);
    expect(wide.slotW).toBeGreaterThan(0);
    const none = layoutBarBand(0, 100, 0, 0, 100);
    expect(none.slotW).toBe(100);
  });

  it('clamps the width percentage to 0–100', () => {
    expect(layoutBarBand(0, 100, 2, 0, 400).barW).toBe(50);
    expect(layoutBarBand(0, 100, 2, 0, -50).barW).toBe(0);
  });
});
