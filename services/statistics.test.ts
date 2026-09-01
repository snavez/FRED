import { describe, it, expect } from 'vitest';
import {
  pairedTTest, wilcoxonSignedRank, rmOneWayAnova, friedmanTest,
  pairedPostHoc, runRepeatedAnalysis, detectDesign, runAnalysis,
  applicableRepeatedTests,
  linearFit,
} from './statistics';

// ─── Paired t-test ────────────────────────────────────────────────
describe('pairedTTest', () => {
  it('matches the textbook value for constant-shift differences', () => {
    // d = [1,2,3,4,5]: mean 3, sd 1.5811 → t = 4.2426, df 4, p = 0.0132 (R: t.test)
    const a = [11, 12, 13, 14, 15];
    const b = [10, 10, 10, 10, 10];
    const r = pairedTTest(a, b);
    expect(r.t).toBeCloseTo(4.2426, 3);
    expect(r.df).toBe(4);
    expect(r.pValue).toBeCloseTo(0.0132, 3);
    expect(r.dz).toBeCloseTo(3 / 1.5811, 3);
  });

  it('is symmetric in sign', () => {
    const a = [1, 2, 3, 4, 5, 6];
    const b = [2, 4, 3, 6, 5, 8];
    const r1 = pairedTTest(a, b);
    const r2 = pairedTTest(b, a);
    expect(r1.t).toBeCloseTo(-r2.t, 10);
    expect(r1.pValue).toBeCloseTo(r2.pValue, 10);
  });

  it('does not reject when there is no effect', () => {
    const a = [5, 6, 7, 8, 9, 10, 11, 12];
    const b = [6, 5, 8, 7, 10, 9, 12, 11];
    expect(pairedTTest(a, b).pValue).toBeGreaterThan(0.5);
  });
});

// ─── Wilcoxon signed-rank ─────────────────────────────────────────
describe('wilcoxonSignedRank', () => {
  it('finds W = 0 when all differences share a sign', () => {
    const a = [11, 12, 13, 14, 15];
    const b = [10, 10, 10, 10, 10];
    const r = wilcoxonSignedRank(a, b);
    expect(r.W).toBe(0);
    expect(r.pValue).toBeLessThan(0.08); // normal approximation at n=5
  });

  it('drops zero differences', () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 2, 3];   // two zeros dropped
    expect(wilcoxonSignedRank(a, b).nUsed).toBe(2);
  });

  it('returns p = 1 for identical samples', () => {
    const a = [1, 2, 3];
    expect(wilcoxonSignedRank(a, [...a]).pValue).toBe(1);
  });
});

// ─── Repeated-measures ANOVA ──────────────────────────────────────
describe('rmOneWayAnova', () => {
  it('decomposes the sums of squares exactly', () => {
    const matrix = [
      [8, 7, 1], [9, 5, 2], [6, 2, 3], [5, 3, 1], [8, 4, 5], [7, 5, 6],
    ];
    const r = rmOneWayAnova(matrix);
    const flat = matrix.flat();
    const grand = flat.reduce((s, v) => s + v, 0) / flat.length;
    const ssTotal = flat.reduce((s, v) => s + (v - grand) ** 2, 0);
    expect(r.ssCond + r.ssSubj + r.ssErr).toBeCloseTo(ssTotal, 8);
    expect(r.df1).toBe(2);
    expect(r.df2).toBe(10);
  });

  it('keeps epsilon within Greenhouse-Geisser bounds', () => {
    const matrix = [
      [8, 7, 1], [9, 5, 2], [6, 2, 3], [5, 3, 1], [8, 4, 5], [7, 5, 6],
    ];
    const r = rmOneWayAnova(matrix);
    expect(r.epsilon).toBeGreaterThanOrEqual(1 / 2);  // 1/(k-1) with k=3
    expect(r.epsilon).toBeLessThanOrEqual(1);
  });

  it('finds a strong consistent effect significant', () => {
    // Every speaker rises by ~10 between conditions with tiny noise
    const matrix = Array.from({ length: 8 }, (_, i) => [i, i + 10 + 0.1 * (i % 2), i + 20 - 0.1 * (i % 3)]);
    const r = rmOneWayAnova(matrix);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.partialEtaSq).toBeGreaterThan(0.9);
  });
});

// ─── Friedman ─────────────────────────────────────────────────────
describe('friedmanTest', () => {
  it('matches the exact statistic for a perfect ordering', () => {
    // 5 speakers all rank the 3 conditions identically:
    // chi-square = 2n = 10, df 2, p = 0.00674; Kendall's W = 1
    const matrix = Array.from({ length: 5 }, (_, i) => [1 + i, 10 + i, 20 + i]);
    const r = friedmanTest(matrix);
    expect(r.chiSq).toBeCloseTo(10, 6);
    expect(r.df).toBe(2);
    expect(r.pValue).toBeCloseTo(0.00674, 4);
    expect(r.kendallsW).toBeCloseTo(1, 6);
  });

  it('reports no effect when rankings are balanced', () => {
    const matrix = [
      [1, 2, 3], [3, 1, 2], [2, 3, 1], [1, 3, 2], [2, 1, 3], [3, 2, 1],
    ];
    const r = friedmanTest(matrix);
    expect(r.chiSq).toBeCloseTo(0, 6);
    expect(r.pValue).toBeCloseTo(1, 6);
  });
});

// ─── Paired post-hocs ─────────────────────────────────────────────
describe('pairedPostHoc', () => {
  it('Bonferroni-corrects across all pairs', () => {
    const matrix = Array.from({ length: 10 }, (_, i) => [i, i + 5, i + 5.05]);
    const res = pairedPostHoc(matrix, ['a', 'b', 'c'], true);
    expect(res).toHaveLength(3);
    const ab = res.find(p => p.pair.join() === 'a,b')!;
    const bc = res.find(p => p.pair.join() === 'b,c')!;
    expect(ab.significant).toBe(true);
    // b vs c differ by a hair against zero spread -> still tiny p, but the
    // pair ordering and mean differences must be right
    expect(ab.meanDiff).toBeCloseTo(-5, 6);
    expect(bc.meanDiff).toBeCloseTo(-0.05, 6);
  });
});

// ─── Repeated pipeline ────────────────────────────────────────────
describe('runRepeatedAnalysis', () => {
  const twoCol = Array.from({ length: 12 }, (_, i) => [100 + i * 3 + (i % 4), 110 + i * 3 + ((i + 1) % 3)]);

  it('recommends a paired test for two conditions and reports speaker n', () => {
    const r = runRepeatedAnalysis(twoCol, ['pre', 'post']);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(['Paired t-test', 'Wilcoxon signed-rank test']).toContain(r.testResult.testName);
    expect(r.testResult.reasoning).toContain('12 speakers');
    // Wilcoxon's normal approximation bottoms out near p ≈ 0.002 at n = 12
    expect(r.testResult.pValue).toBeLessThan(0.01);
  });

  it('warns when a forced test contradicts the checks', () => {
    // Heavily skewed differences: one huge outlier breaks normality
    const skewed = [...twoCol.map(r => [...r])];
    skewed[0] = [100, 400];
    const r = runRepeatedAnalysis(skewed, ['pre', 'post'], 0.05, 'paired-t');
    if ('error' in r) throw new Error(r.error);
    expect(r.testResult.testName).toBe('Paired t-test');
    if (!r.normalityTests[0].isNormal) {
      expect(r.testResult.advisory).toContain('Wilcoxon');
    }
  });

  it('rejects too few complete speakers', () => {
    const r = runRepeatedAnalysis([[1, 2], [2, 3]], ['a', 'b']);
    expect('error' in r).toBe(true);
  });

  it('routes three conditions to RM-ANOVA or Friedman', () => {
    const matrix = Array.from({ length: 10 }, (_, i) => [i, i + 8 + (i % 2), i + 16 + (i % 3)]);
    const r = runRepeatedAnalysis(matrix, ['a', 'b', 'c']);
    if ('error' in r) throw new Error(r.error);
    expect(['Repeated-measures ANOVA', 'Friedman test']).toContain(r.testResult.testName);
    expect(r.testResult.pValue).toBeLessThan(0.01);
    expect(r.postHoc).not.toBeNull();
  });
});

// ─── Design detection ─────────────────────────────────────────────
describe('detectDesign', () => {
  it('classifies a between-speaker design', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ speaker: `a${i % 4}`, level: 'north' })),
      ...Array.from({ length: 20 }, (_, i) => ({ speaker: `b${i % 4}`, level: 'south' })),
    ];
    const d = detectDesign(rows, ['north', 'south']);
    expect(d.design).toBe('between');
    expect(d.nSpeakers).toBe(8);
    expect(d.repeatedMeasures).toBe(true);
    expect(d.tokensPerSpeaker).toBe(5);
    expect(d.completeSpeakers).toBe(0);
  });

  it('classifies a within-speaker design and counts complete speakers', () => {
    const rows: { speaker: string; level: string }[] = [];
    for (let s = 0; s < 6; s++) {
      for (const level of ['a', 'i', 'u']) {
        for (let t = 0; t < 3; t++) rows.push({ speaker: `s${s}`, level });
      }
    }
    rows.push({ speaker: 's6', level: 'a' });   // one incomplete speaker
    const d = detectDesign(rows, ['a', 'i', 'u']);
    expect(d.design).toBe('within');
    expect(d.nSpeakers).toBe(7);
    expect(d.completeSpeakers).toBe(6);
  });

  it('reports no speakers when the column is empty', () => {
    const d = detectDesign([{ speaker: '', level: 'x' }], ['x']);
    expect(d.hasSpeakers).toBe(false);
    expect(d.design).toBe('none');
  });
});

// ─── Guardrails ───────────────────────────────────────────────────
describe('test applicability', () => {
  it('offers only paired tests for two conditions', () => {
    expect(applicableRepeatedTests(2)).toEqual(['auto', 'paired-t', 'wilcoxon']);
    expect(applicableRepeatedTests(4)).toEqual(['auto', 'rm-anova', 'friedman']);
  });

  it('runAnalysis falls back to the recommendation for inapplicable choices', () => {
    const grouped = new Map<string, number[]>([
      ['x', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['y', [2, 3, 4, 5, 6, 7, 8, 9]],
    ]);
    // 'anova' needs 3+ groups; with 2 it must fall back, not crash
    const r = runAnalysis(grouped, 0.05, 'anova');
    expect('error' in r).toBe(false);
  });
});

describe('linearFit', () => {
  const line = (n: number, slope: number, intercept: number, noise = 0) =>
    Array.from({ length: n }, (_, i) => ({ x: i, y: intercept + slope * i + (i % 2 ? noise : -noise) }));

  it('recovers the slope and intercept of a clean line', () => {
    const fit = linearFit(line(10, 2.5, 7))!;
    expect(fit.slope).toBeCloseTo(2.5);
    expect(fit.intercept).toBeCloseTo(7);
    expect(fit.r).toBeCloseTo(1);
    expect(fit.r2).toBeCloseTo(1);
    expect(fit.pValue).toBe(0);
    expect(fit.n).toBe(10);
  });

  it('signs the correlation with the slope', () => {
    expect(linearFit(line(10, -3, 100))!.r).toBeCloseTo(-1);
  });

  it('reports a weak, non-significant fit for unrelated variables', () => {
    // y alternates independently of x: no linear relationship to find
    const points = Array.from({ length: 30 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 1 : -1 }));
    const fit = linearFit(points)!;
    expect(Math.abs(fit.r)).toBeLessThan(0.2);
    expect(fit.pValue).toBeGreaterThan(0.05);
  });

  it('finds a real relationship through noise, and says how sure it is', () => {
    const fit = linearFit(line(40, 1, 0, 3))!;
    expect(fit.r).toBeGreaterThan(0.9);
    expect(fit.pValue).toBeLessThan(0.001);
  });

  it('needs three points and spread on both axes', () => {
    expect(linearFit([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    // Every x identical: no line to fit
    expect(linearFit([{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }])).toBeNull();
    // Every y identical: a flat line explains nothing
    expect(linearFit([{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }])).toBeNull();
  });

  it('ignores points missing either value', () => {
    const fit = linearFit([...line(6, 2, 1), { x: NaN, y: 5 }, { x: 3, y: NaN }])!;
    expect(fit.n).toBe(6);
    expect(fit.slope).toBeCloseTo(2);
  });
});
