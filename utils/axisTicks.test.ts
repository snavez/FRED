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

describe('axis labels are true whatever range the user sets', () => {
  /** Every axis a reader might set on a duration measured in seconds. */
  const ranges: [number, number][] = [
    [0, 0.12], [0, 0.37], [0.005, 0.09], [0, 13], [-0.5, 0.5],
    [0.02, 0.04], [1200, 8400], [0, 1], [0.001, 0.009],
  ];

  it('never labels a non-zero tick as zero — the reported 0.02 read as 0', () => {
    // The whole column must agree about how many decimals a duration has: formatting each
    // tick on its own dropped the trailing zeros, so 0.00 became 0 and 0.10 became 0.1
    // among neighbours reading 0.02 and 0.04.
    const { values, labels } = axisTicks(0, 0.12, 6);
    expect(labels).toEqual(['0.00', '0.02', '0.04', '0.06', '0.08', '0.10', '0.12']);
    values.forEach((v, i) => {
      if (v !== 0) expect(parseFloat(labels[i])).not.toBe(0);
    });
  });

  it('labels every tick with its own value, to the step it sits on', () => {
    for (const [lo, hi] of ranges) {
      const { values, labels, step } = axisTicks(lo, hi, 6);
      values.forEach((v, i) => {
        expect(parseFloat(labels[i])).toBeCloseTo(v, 10);
        expect(labels[i]).toBe(formatTickValue(v, step));
      });
    }
  });

  it('gives every tick on an axis the same number of decimals', () => {
    for (const [lo, hi] of ranges) {
      const { labels } = axisTicks(lo, hi, 6);
      const decimals = labels.map(l => (l.split('.')[1] || '').length);
      expect(new Set(decimals).size).toBeLessThanOrEqual(1);
    }
  });

  it('never repeats a label on one axis', () => {
    for (const [lo, hi] of ranges) {
      const { labels } = axisTicks(lo, hi, 6);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('keeps ticks inside the range the user asked for', () => {
    for (const [lo, hi] of ranges) {
      for (const v of axisTicks(lo, hi, 6).values) {
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it('is right for a sub-millisecond step, where rounding to whole numbers was not', () => {
    // The spectral timeline used to label its millisecond axis with Math.round, which
    // collapses a fractional step onto repeated whole numbers.
    const { values, labels } = axisTicks(0, 3, 6);
    expect(new Set(labels).size).toBe(labels.length);
    values.forEach((v, i) => expect(parseFloat(labels[i])).toBeCloseTo(v, 10));
  });
});

describe('the lowest tick keeps its value', () => {
  it('does not round the first label away when the axis starts above zero', () => {
    // Reported: a y axis stepping 0.02 read 0, 0.04, 0.06 … — the lowest tick drawn in
    // the right place but labelled 0. `values.map(formatMeasureValue)` handed the array
    // index to the formatter as its significant-digit count, so index 0 asked for none.
    const { values, labels } = axisTicks(0.01, 0.12, 6);
    expect(values[0]).toBeCloseTo(0.02, 10);
    expect(labels[0]).toBe('0.02');
    expect(labels).toEqual(['0.02', '0.04', '0.06', '0.08', '0.10', '0.12']);
  });

  it('labels the lowest tick correctly wherever the reader puts the minimum', () => {
    for (const min of [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.11]) {
      const { values, labels } = axisTicks(min, 0.12, 6);
      if (values.length === 0) continue;
      expect(parseFloat(labels[0])).toBeCloseTo(values[0], 10);
      if (values[0] !== 0) expect(parseFloat(labels[0])).not.toBe(0);
    }
  });

  it('gives every tick on an axis the same number of decimals', () => {
    for (const [lo, hi] of [[0, 0.12], [0.01, 0.12], [0, 0.37], [1200, 8400]] as [number, number][]) {
      const decimals = axisTicks(lo, hi, 6).labels.map(l => (l.split('.')[1] || '').length);
      expect(new Set(decimals).size).toBeLessThanOrEqual(1);
    }
  });

  it('never repeats a label on one axis', () => {
    for (const [lo, hi] of [[0, 0.12], [0.01, 0.12], [0, 3], [-0.5, 0.5]] as [number, number][]) {
      const { labels } = axisTicks(lo, hi, 6);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe('formatMeasureValue cannot be asked for no digits', () => {
  it('ignores a significant-digit count of zero rather than rounding to nothing', () => {
    // What `map` supplied as the index for the first element.
    expect(formatMeasureValue(0.02, 0)).not.toBe('0');
    expect(parseFloat(formatMeasureValue(0.02, 0))).toBeCloseTo(0.02, 10);
  });

  it('still honours a real digit count', () => {
    expect(formatMeasureValue(0.123456, 3)).toBe('0.123');
    expect(formatMeasureValue(0.123456, 5)).toBe('0.12346');
    // Digits govern the decimals only; the whole part is never rounded away.
    expect(formatMeasureValue(1234.5, 3)).toBe('1235');
  });

  it('leaves a true zero as zero', () => {
    expect(formatMeasureValue(0)).toBe('0');
  });
});
