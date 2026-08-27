import { describe, it, expect } from 'vitest';
import { niceStep, tickDecimals, formatTickValue, axisTicks, formatMeasureValue } from './axisTicks';

describe('niceStep', () => {
  it('rounds to the nearest 1/2/5 × 10^k', () => {
    expect(niceStep(0.0178)).toBeCloseTo(0.02, 10);
    expect(niceStep(0.0214)).toBeCloseTo(0.02, 10);
    expect(niceStep(1.1)).toBeCloseTo(1, 10);
    expect(niceStep(3.4)).toBeCloseTo(5, 10);
    expect(niceStep(230)).toBeCloseTo(200, 10);
  });

  it('falls back to 1 for a step that is not a positive number', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });
});

describe('tickDecimals', () => {
  it('gives a step exactly the decimals it needs', () => {
    expect(tickDecimals(0.02)).toBe(2);
    expect(tickDecimals(0.05)).toBe(2);
    expect(tickDecimals(0.1)).toBe(1);
    expect(tickDecimals(0.5)).toBe(1);
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(20)).toBe(0);
  });
});

describe('formatTickValue', () => {
  it('formats every tick to the step decimals, so a column shares one shape', () => {
    const step = 0.02;
    expect([0, 0.02, 0.04, 0.06, 0.08].map(v => formatTickValue(v, step)))
      .toEqual(['0.00', '0.02', '0.04', '0.06', '0.08']);
  });

  it('cleans up the float dust left by repeated addition', () => {
    // 0.02 + 0.02 + 0.02 in binary floating point.
    expect(formatTickValue(0.020000000000000004 * 3, 0.02)).toBe('0.06');
    expect(formatTickValue(0.1 + 0.2, 0.1)).toBe('0.3');
  });

  it('never renders a negative zero', () => {
    expect(formatTickValue(-0, 0.02)).toBe('0.00');
    expect(formatTickValue(-0.0001, 0.02)).toBe('0.00');
  });

  it('keeps a real negative', () => {
    expect(formatTickValue(-0.04, 0.02)).toBe('-0.04');
    expect(formatTickValue(-40, 10)).toBe('-40');
  });

  it('has nothing to say about a non-finite value', () => {
    expect(formatTickValue(NaN, 1)).toBe('');
    expect(formatTickValue(Infinity, 1)).toBe('');
  });
});

describe('axisTicks', () => {
  it('steps evenly and labels truthfully over a duration range', () => {
    // The reported bug: 0..0.089 s stepped by (max-min)/5 and printed with toFixed(2)
    // read 0, .02, .04, .05, .07, .09 — an uneven sequence with a value the step never
    // visits. Nice steps give an even sequence whose labels are the values drawn.
    const ticks = axisTicks(0, 0.089, 5);
    expect(ticks.step).toBeCloseTo(0.02, 10);
    expect(ticks.values).toEqual([0, 0.02, 0.04, 0.06, 0.08]);
    expect(ticks.labels).toEqual(['0.00', '0.02', '0.04', '0.06', '0.08']);
  });

  it('keeps every tick a whole multiple of the step', () => {
    const ticks = axisTicks(0, 0.107, 5);
    ticks.values.forEach(v => expect(Math.abs(v / ticks.step - Math.round(v / ticks.step))).toBeLessThan(1e-9));
  });

  it('stays inside the range it is given', () => {
    const ticks = axisTicks(12, 87, 5);
    expect(Math.min(...ticks.values)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ticks.values)).toBeLessThanOrEqual(87);
  });

  it('spans a signed range through zero', () => {
    const ticks = axisTicks(-40, 25, 6);
    expect(ticks.values).toContain(0);
    expect(ticks.labels).toContain('0');
  });

  it('yields the single value of a degenerate range', () => {
    expect(axisTicks(5, 5).values).toEqual([5]);
    expect(axisTicks(5, 1).values).toEqual([5]);
  });

  it('yields no ticks for a non-finite range', () => {
    expect(axisTicks(NaN, 10).values).toEqual([]);
    expect(axisTicks(0, Infinity).values).toEqual([]);
  });
});

describe('formatMeasureValue', () => {
  it('carries significant digits and drops silent zeros', () => {
    expect(formatMeasureValue(0.0891)).toBe('0.0891');
    expect(formatMeasureValue(1234.5)).toBe('1235');
    expect(formatMeasureValue(-12.345)).toBe('-12.3');
    expect(formatMeasureValue(2)).toBe('2');
    expect(formatMeasureValue(0)).toBe('0');
  });

  it('has nothing to say about a non-finite value', () => {
    expect(formatMeasureValue(NaN)).toBe('');
  });
});
