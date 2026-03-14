/**
 * FRED Statistics Service
 *
 * Pure-math statistical tests using jstat-esm for distribution CDFs.
 * No React dependencies — all functions are standalone and testable.
 */

import jStat from 'jstat-esm';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface GroupStats {
  name: string;
  n: number;
  mean: number;
  sd: number;
  median: number;
  iqr: number;
  min: number;
  max: number;
}

export interface TestResult {
  testName: string;
  statistic: number;
  statisticName: string;       // 't', 'U', 'F', 'H', 'χ²'
  df: number | [number, number];
  pValue: number;
  effectSize: { name: string; value: number; magnitude: string };
  reasoning: string;
}

export interface NormalityResult {
  group: string;
  W: number;
  pValue: number;
  isNormal: boolean;
}

export interface VarianceResult {
  F: number;
  df1: number;
  df2: number;
  pValue: number;
  isEqual: boolean;
}

export interface PostHocResult {
  pair: [string, string];
  meanDiff: number;
  statistic: number;
  pValue: number;
  significant: boolean;
}

export interface AnalysisResult {
  groupStats: GroupStats[];
  normalityTests: NormalityResult[];
  varianceTest: VarianceResult | null;
  testResult: TestResult;
  postHoc: PostHocResult[] | null;
  error?: string;
}

export interface AnalysisError {
  error: string;
  groupStats?: GroupStats[];
}

// ---- Two-Way ANOVA Types ----

export interface TwoWayAnovaEffect {
  source: string;          // 'Factor A', 'Factor B', 'A × B', 'Residual', 'Total'
  ss: number;
  df: number;
  ms: number;
  F: number;
  pValue: number;
  partialEtaSq: number;
  magnitude: string;
}

export interface CellStats {
  factorA: string;
  factorB: string;
  n: number;
  mean: number;
  sd: number;
}

export interface SimpleEffect {
  level: string;
  testName: string;
  statistic: number;
  statisticName: string;
  df: number | [number, number];
  pValue: number;
  effectSize: { name: string; value: number; magnitude: string };
  groupStats: GroupStats[];
}

export interface TwoWayAnovaResult {
  effects: TwoWayAnovaEffect[];
  cellStats: CellStats[];
  marginalStatsA: GroupStats[];
  marginalStatsB: GroupStats[];
  normalityTest: NormalityResult;
  varianceTest: VarianceResult;
  postHocA: PostHocResult[] | null;
  postHocB: PostHocResult[] | null;
  simpleEffectsA: SimpleEffect[] | null;
  simpleEffectsB: SimpleEffect[] | null;
  N: number;
  warnings: string[];
}

// ---- Categorical Analysis Types ----

export interface ContingencyTableResult {
  observed: number[][];
  expected: number[][];
  rowLabels: string[];
  colLabels: string[];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
  testResult: TestResult;
  standardizedResiduals: number[][];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Section 1: Descriptive Statistics
// ═══════════════════════════════════════════════════════════════════

export const mean = (arr: number[]): number => {
  if (arr.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
};

export const variance = (arr: number[], ddof = 1): number => {
  const n = arr.length;
  if (n <= ddof) return NaN;
  const m = mean(arr);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (arr[i] - m) ** 2;
  return ss / (n - ddof);
};

export const sd = (arr: number[], ddof = 1): number => Math.sqrt(variance(arr, ddof));

export const median = (arr: number[]): number => {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const quantile = (arr: number[], q: number): number => {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export const iqr = (arr: number[]): number => quantile(arr, 0.75) - quantile(arr, 0.25);

export const groupStatsFor = (name: string, values: number[]): GroupStats => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    name,
    n: values.length,
    mean: mean(values),
    sd: sd(values),
    median: median(values),
    iqr: iqr(values),
    min: sorted[0] ?? NaN,
    max: sorted[sorted.length - 1] ?? NaN,
  };
};

/** Assign ranks to values (with tie handling via average ranks) */
const ranks = (values: number[]): number[] => {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const r = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j) / 2;    // 1-based
    for (let k = i; k < j; k++) r[indexed[k].i] = avgRank;
    i = j;
  }
  return r;
};

// ═══════════════════════════════════════════════════════════════════
// Section 2: Shapiro-Wilk Normality Test
// ═══════════════════════════════════════════════════════════════════

/**
 * Shapiro-Wilk test for normality (AS R94 algorithm).
 * For n=3..5000. Uses the approximation from Royston (1995).
 * Returns W statistic and p-value.
 */
export const shapiroWilk = (x: number[]): { W: number; pValue: number } => {
  const n = x.length;
  if (n < 3) return { W: 1, pValue: 1 };
  if (n > 5000) {
    // For very large samples, use first 5000
    const sampled = [...x].sort((a, b) => a - b).slice(0, 5000);
    return shapiroWilk(sampled);
  }

  const sorted = [...x].sort((a, b) => a - b);
  const xMean = mean(sorted);

  // Check for zero variance
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (sorted[i] - xMean) ** 2;
  if (ss === 0) return { W: 1, pValue: 1 };

  // Compute expected normal order statistics (approximate via Blom's formula)
  const m = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    m[i] = jStat.normal.inv((i + 1 - 0.375) / (n + 0.25), 0, 1);
  }

  // Compute the a-coefficients
  const mSum = m.reduce((s, v) => s + v * v, 0);
  const u = 1.0 / Math.sqrt(n);

  const a = new Array<number>(n);
  // Use the approximation for the coefficients
  a[n - 1] = -2.706056 * u ** 5 + 4.434685 * u ** 4 - 2.07119 * u ** 3 - 0.147981 * u ** 2 + 0.221157 * u + m[n - 1] / Math.sqrt(mSum);
  a[0] = -a[n - 1];

  if (n > 5) {
    a[n - 2] = -3.582633 * u ** 5 + 5.682633 * u ** 4 - 1.752461 * u ** 3 - 0.293762 * u ** 2 + 0.042981 * u + m[n - 2] / Math.sqrt(mSum);
    a[1] = -a[n - 2];

    // Correction factor
    const phi = (ss - (a[0] ** 2 + a[1] ** 2 > 0 ? (a[0] * sorted[0] + a[n - 1] * sorted[n - 1]) ** 2 / (a[0] ** 2) : 0));
    void phi; // used below
  }

  // Fill remaining coefficients using normalized m values
  const eps = mSum;
  let twoA2 = a[0] ** 2 + a[n - 1] ** 2;
  if (n > 5) twoA2 += a[1] ** 2 + a[n - 2] ** 2;

  const phi2 = (eps - twoA2);
  for (let i = (n > 5 ? 2 : 1); i < n - (n > 5 ? 2 : 1); i++) {
    a[i] = m[i] / Math.sqrt(phi2);
  }

  // W statistic
  let num = 0;
  for (let i = 0; i < n; i++) num += a[i] * sorted[i];
  const W = (num * num) / ss;

  // P-value via Royston's approximation
  let pValue: number;
  if (n <= 11) {
    // Small sample: use gamma approximation
    const gamma = 0.459 * n - 2.273;
    const mu = -1.2725 + 1.0521 * (gamma - 0.6607);
    const sigma = 1.0308 - 0.26758 * (gamma + 2.0 / gamma);
    const z = (-Math.log(1 - W) - mu) / sigma;
    pValue = 1 - jStat.normal.cdf(z, 0, 1);
  } else {
    // Royston (1995) for n > 11
    const lnN = Math.log(n);
    const mu = -1.2725 + 1.0521 * lnN;
    const sigma = 1.0308 - 0.26758 * lnN;
    const z = (Math.log(1 - W) - mu) / sigma;
    pValue = 1 - jStat.normal.cdf(z, 0, 1);
  }

  return { W: Math.min(W, 1), pValue: Math.max(0, Math.min(1, pValue)) };
};

// ═══════════════════════════════════════════════════════════════════
// Section 3: Levene's Test for Equality of Variances
// ═══════════════════════════════════════════════════════════════════

/**
 * Levene's test (median-based, Brown-Forsythe variant).
 * More robust than the mean-based version.
 */
export const levenesTest = (groups: number[][]): VarianceResult => {
  const k = groups.length;
  const N = groups.reduce((s, g) => s + g.length, 0);

  // Compute deviations from group medians
  const deviations: number[][] = groups.map(g => {
    const med = median(g);
    return g.map(v => Math.abs(v - med));
  });

  // Grand mean of deviations
  let grandSum = 0, grandN = 0;
  for (const d of deviations) {
    for (const v of d) { grandSum += v; grandN++; }
  }
  const grandMean = grandSum / grandN;

  // Group means of deviations
  const groupMeans = deviations.map(d => mean(d));

  // Between-group sum of squares
  let ssBetween = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += deviations[i].length * (groupMeans[i] - grandMean) ** 2;
  }

  // Within-group sum of squares
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    for (const v of deviations[i]) {
      ssWithin += (v - groupMeans[i]) ** 2;
    }
  }

  const df1 = k - 1;
  const df2 = N - k;
  const F = (ssBetween / df1) / (ssWithin / df2);
  const pValue = 1 - jStat.centralF.cdf(F, df1, df2);

  return { F, df1, df2, pValue, isEqual: pValue > 0.05 };
};

// ═══════════════════════════════════════════════════════════════════
// Section 4: Two-Sample Tests
// ═══════════════════════════════════════════════════════════════════

/** Independent two-sample t-test (pooled variance, equal var assumed) */
export const independentTTest = (a: number[], b: number[]): { t: number; df: number; pValue: number } => {
  const n1 = a.length, n2 = b.length;
  const m1 = mean(a), m2 = mean(b);
  const s1 = variance(a), s2 = variance(b);
  const sp = ((n1 - 1) * s1 + (n2 - 1) * s2) / (n1 + n2 - 2);
  const t = (m1 - m2) / Math.sqrt(sp * (1 / n1 + 1 / n2));
  const df = n1 + n2 - 2;
  const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
  return { t, df, pValue };
};

/** Welch's t-test (unequal variances) */
export const welchsTTest = (a: number[], b: number[]): { t: number; df: number; pValue: number } => {
  const n1 = a.length, n2 = b.length;
  const m1 = mean(a), m2 = mean(b);
  const s1 = variance(a), s2 = variance(b);
  const se = Math.sqrt(s1 / n1 + s2 / n2);
  const t = (m1 - m2) / se;
  // Welch-Satterthwaite degrees of freedom
  const num = (s1 / n1 + s2 / n2) ** 2;
  const den = (s1 / n1) ** 2 / (n1 - 1) + (s2 / n2) ** 2 / (n2 - 1);
  const df = num / den;
  const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
  return { t, df, pValue };
};

/** Mann-Whitney U test (non-parametric, two independent samples) */
export const mannWhitneyU = (a: number[], b: number[]): { U: number; z: number; pValue: number } => {
  const n1 = a.length, n2 = b.length;
  const combined = [
    ...a.map(v => ({ v, group: 0 })),
    ...b.map(v => ({ v, group: 1 }))
  ];
  const r = ranks(combined.map(c => c.v));

  let R1 = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i].group === 0) R1 += r[i];
  }

  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation (valid for n1, n2 > 10)
  const mU = n1 * n2 / 2;
  const sigmaU = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  const z = (U1 - mU) / sigmaU;
  const pValue = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));

  return { U, z, pValue };
};

// ═══════════════════════════════════════════════════════════════════
// Section 5: Multi-Sample Tests
// ═══════════════════════════════════════════════════════════════════

/** One-way ANOVA (equal variances assumed) */
export const oneWayAnova = (groups: number[][]): { F: number; df1: number; df2: number; pValue: number; ssBetween: number; ssTotal: number } => {
  const k = groups.length;
  const N = groups.reduce((s, g) => s + g.length, 0);
  const grandMean = mean(groups.flat());

  let ssBetween = 0;
  for (const g of groups) {
    ssBetween += g.length * (mean(g) - grandMean) ** 2;
  }

  let ssWithin = 0;
  for (const g of groups) {
    const m = mean(g);
    for (const v of g) ssWithin += (v - m) ** 2;
  }

  const ssTotal = ssBetween + ssWithin;
  const df1 = k - 1;
  const df2 = N - k;
  const F = (ssBetween / df1) / (ssWithin / df2);
  const pValue = 1 - jStat.centralF.cdf(F, df1, df2);

  return { F, df1, df2, pValue, ssBetween, ssTotal };
};

/** Welch's ANOVA (unequal variances) */
export const welchsAnova = (groups: number[][]): { F: number; df1: number; df2: number; pValue: number; ssBetween: number; ssTotal: number } => {
  const k = groups.length;
  const ns = groups.map(g => g.length);
  const means = groups.map(g => mean(g));
  const vars = groups.map(g => variance(g));
  const weights = groups.map((g, i) => g.length / vars[i]);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const weightedMean = weights.reduce((s, w, i) => s + w * means[i], 0) / totalWeight;

  // Welch's F
  let numerator = 0;
  for (let i = 0; i < k; i++) {
    numerator += weights[i] * (means[i] - weightedMean) ** 2;
  }
  numerator /= (k - 1);

  let lambda = 0;
  for (let i = 0; i < k; i++) {
    lambda += (1 - weights[i] / totalWeight) ** 2 / (ns[i] - 1);
  }
  lambda *= 3 / (k * k - 1);

  const F = numerator / (1 + 2 * (k - 2) * lambda / (k * k - 1));
  const df1 = k - 1;
  const df2 = 1 / lambda;  // approximate denominator df
  const pValue = 1 - jStat.centralF.cdf(F, df1, df2);

  // Approximate SS for effect size
  const grandMean = mean(groups.flat());
  let ssBetween = 0, ssTotal = 0;
  for (const g of groups) {
    ssBetween += g.length * (mean(g) - grandMean) ** 2;
    for (const v of g) ssTotal += (v - grandMean) ** 2;
  }

  return { F, df1, df2, pValue, ssBetween, ssTotal };
};

/** Kruskal-Wallis test (non-parametric, 3+ independent samples) */
export const kruskalWallis = (groups: number[][]): { H: number; df: number; pValue: number } => {
  const N = groups.reduce((s, g) => s + g.length, 0);
  const allValues = groups.flatMap((g, gi) => g.map(v => ({ v, gi })));
  const r = ranks(allValues.map(x => x.v));

  // Sum of ranks per group
  const rankSums: number[] = new Array(groups.length).fill(0);
  for (let i = 0; i < allValues.length; i++) {
    rankSums[allValues[i].gi] += r[i];
  }

  let H = 0;
  for (let i = 0; i < groups.length; i++) {
    const ni = groups[i].length;
    if (ni === 0) continue;
    H += (rankSums[i] ** 2) / ni;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);

  const df = groups.length - 1;
  const pValue = 1 - jStat.chisquare.cdf(H, df);

  return { H, df, pValue };
};

// ═══════════════════════════════════════════════════════════════════
// Section 6: Post-Hoc Tests
// ═══════════════════════════════════════════════════════════════════

/** Tukey HSD post-hoc test (after ANOVA) */
export const tukeyHSD = (groups: number[][], names: string[], alpha = 0.05): PostHocResult[] => {
  const k = groups.length;
  const N = groups.reduce((s, g) => s + g.length, 0);
  const means = groups.map(g => mean(g));

  // MSE from one-way ANOVA
  let ssWithin = 0;
  for (const g of groups) {
    const m = mean(g);
    for (const v of g) ssWithin += (v - m) ** 2;
  }
  const mse = ssWithin / (N - k);

  const results: PostHocResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diff = means[i] - means[j];
      const se = Math.sqrt(mse * (1 / groups[i].length + 1 / groups[j].length) / 2);
      const q = Math.abs(diff) / se;

      // P-value from Tukey's studentized range distribution
      // jStat.tukey.cdf(q, k, N-k) gives the CDF
      let pValue: number;
      try {
        pValue = 1 - jStat.tukey.cdf(q, k, N - k);
      } catch {
        // Fallback: Bonferroni-corrected t-test
        const t = Math.abs(diff) / Math.sqrt(mse * (1 / groups[i].length + 1 / groups[j].length));
        const rawP = 2 * (1 - jStat.studentt.cdf(t, N - k));
        const nComparisons = k * (k - 1) / 2;
        pValue = Math.min(1, rawP * nComparisons);
      }

      results.push({
        pair: [names[i], names[j]],
        meanDiff: diff,
        statistic: q,
        pValue: Math.max(0, Math.min(1, pValue)),
        significant: pValue < alpha,
      });
    }
  }
  return results;
};

/** Dunn's test (post-hoc for Kruskal-Wallis, Bonferroni-corrected) */
export const dunnsTest = (groups: number[][], names: string[], alpha = 0.05): PostHocResult[] => {
  const N = groups.reduce((s, g) => s + g.length, 0);
  const allValues = groups.flatMap((g, gi) => g.map(v => ({ v, gi })));
  const r = ranks(allValues.map(x => x.v));

  // Mean rank per group
  const meanRanks: number[] = new Array(groups.length).fill(0);
  const groupCounts: number[] = new Array(groups.length).fill(0);
  for (let i = 0; i < allValues.length; i++) {
    meanRanks[allValues[i].gi] += r[i];
    groupCounts[allValues[i].gi]++;
  }
  for (let i = 0; i < groups.length; i++) {
    meanRanks[i] /= groupCounts[i];
  }

  // Variance of ranks
  const tiedRankVar = N * (N + 1) / 12;

  const nComparisons = groups.length * (groups.length - 1) / 2;
  const results: PostHocResult[] = [];

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const diff = meanRanks[i] - meanRanks[j];
      const se = Math.sqrt(tiedRankVar * (1 / groupCounts[i] + 1 / groupCounts[j]));
      const z = diff / se;
      const rawP = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
      const pValue = Math.min(1, rawP * nComparisons); // Bonferroni

      results.push({
        pair: [names[i], names[j]],
        meanDiff: diff,
        statistic: z,
        pValue: Math.max(0, Math.min(1, pValue)),
        significant: pValue < alpha,
      });
    }
  }
  return results;
};

// ═══════════════════════════════════════════════════════════════════
// Section 7: Categorical Tests
// ═══════════════════════════════════════════════════════════════════

/** Chi-square test for independence */
export const chiSquareIndependence = (observed: number[][]): { chiSq: number; df: number; pValue: number } => {
  const rows = observed.length;
  const cols = observed[0].length;
  const rowTotals = observed.map(r => r.reduce((s, v) => s + v, 0));
  const colTotals = new Array(cols).fill(0);
  let total = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      colTotals[j] += observed[i][j];
      total += observed[i][j];
    }
  }

  let chiSq = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = rowTotals[i] * colTotals[j] / total;
      if (expected > 0) {
        chiSq += (observed[i][j] - expected) ** 2 / expected;
      }
    }
  }

  const df = (rows - 1) * (cols - 1);
  const pValue = 1 - jStat.chisquare.cdf(chiSq, df);
  return { chiSq, df, pValue };
};

/** Fisher's exact test for 2x2 contingency table */
export const fisherExact2x2 = (a: number, b: number, c: number, d: number): { pValue: number } => {
  const n = a + b + c + d;
  const r1 = a + b, r2 = c + d;
  const c1 = a + c, c2 = b + d;

  // Hypergeometric probability
  const lnFact = (x: number): number => jStat.gammaln(x + 1);
  const lnHyperProb = (x: number): number => {
    return lnFact(r1) + lnFact(r2) + lnFact(c1) + lnFact(c2) -
           lnFact(n) - lnFact(x) - lnFact(r1 - x) - lnFact(c1 - x) - lnFact(r2 - c1 + x);
  };

  const observedProb = lnHyperProb(a);

  // Two-tailed: sum all probabilities <= observed probability
  let pValue = 0;
  const minA = Math.max(0, c1 - r2);
  const maxA = Math.min(r1, c1);
  for (let x = minA; x <= maxA; x++) {
    const p = lnHyperProb(x);
    if (p <= observedProb + 1e-10) {
      pValue += Math.exp(p);
    }
  }

  return { pValue: Math.min(1, pValue) };
};

// ═══════════════════════════════════════════════════════════════════
// Section 8: Effect Sizes
// ═══════════════════════════════════════════════════════════════════

/** Cohen's d (two independent samples) */
export const cohensD = (a: number[], b: number[]): number => {
  const pooledSD = Math.sqrt(((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2));
  return pooledSD === 0 ? 0 : (mean(a) - mean(b)) / pooledSD;
};

/** Eta-squared (from ANOVA) */
export const etaSquared = (ssBetween: number, ssTotal: number): number => {
  return ssTotal === 0 ? 0 : ssBetween / ssTotal;
};

/** Rank-biserial correlation r (effect size for Mann-Whitney U) */
export const rankBiserialR = (U: number, n1: number, n2: number): number => {
  return 1 - (2 * U) / (n1 * n2);
};

/** Cramér's V (effect size for chi-square) */
export const cramersV = (chiSq: number, n: number, minDim: number): number => {
  return Math.sqrt(chiSq / (n * Math.max(1, minDim - 1)));
};

/** Partial eta-squared (for factorial ANOVA effects) */
export const partialEtaSquared = (ssEffect: number, ssResidual: number): number => {
  const total = ssEffect + ssResidual;
  return total === 0 ? 0 : ssEffect / total;
};

/** Magnitude label for effect size */
export const effectMagnitude = (name: string, absValue: number): string => {
  if (name === "Cohen's d" || name === 'r') {
    if (absValue < 0.2) return 'negligible';
    if (absValue < 0.5) return 'small';
    if (absValue < 0.8) return 'medium';
    return 'large';
  }
  if (name === "Cramér's V") {
    if (absValue < 0.1) return 'negligible';
    if (absValue < 0.3) return 'small';
    if (absValue < 0.5) return 'medium';
    return 'large';
  }
  // eta-squared, partial η²
  if (absValue < 0.01) return 'negligible';
  if (absValue < 0.06) return 'small';
  if (absValue < 0.14) return 'medium';
  return 'large';
};

// ═══════════════════════════════════════════════════════════════════
// Section 9: Decision Engine
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the full analysis pipeline:
 * 1. Descriptive stats per group
 * 2. Normality test (Shapiro-Wilk per group)
 * 3. Variance test (Levene's)
 * 4. Select and run appropriate test
 * 5. Post-hoc if needed
 */
export const runAnalysis = (
  groupedData: Map<string, number[]>,
  alpha: number = 0.05
): AnalysisResult | AnalysisError => {
  const groupNames = Array.from(groupedData.keys());
  const groups = Array.from(groupedData.values());
  const k = groups.length;

  // Descriptive stats
  const stats = groupNames.map((name, i) => groupStatsFor(name, groups[i]));

  // Validate
  if (k < 2) return { error: 'Need at least 2 groups for comparison.', groupStats: stats };
  if (groups.some(g => g.length < 3)) {
    return { error: 'All groups must have at least 3 observations.', groupStats: stats };
  }

  // Normality: Shapiro-Wilk per group (cap at 5000 per group)
  const normalityTests: NormalityResult[] = groups.map((g, i) => {
    const sw = shapiroWilk(g.length > 5000 ? g.slice(0, 5000) : g);
    return { group: groupNames[i], W: sw.W, pValue: sw.pValue, isNormal: sw.pValue > alpha };
  });
  const allNormal = normalityTests.every(r => r.isNormal);

  // Variance: Levene's
  const varianceTest = levenesTest(groups);
  const equalVar = varianceTest.isEqual;

  // Select and run test
  let testResult: TestResult;
  let postHoc: PostHocResult[] | null = null;

  if (k === 2) {
    // Two-sample tests
    if (allNormal && equalVar) {
      const res = independentTTest(groups[0], groups[1]);
      const d = cohensD(groups[0], groups[1]);
      testResult = {
        testName: "Independent t-test",
        statistic: res.t,
        statisticName: 't',
        df: res.df,
        pValue: res.pValue,
        effectSize: { name: "Cohen's d", value: d, magnitude: effectMagnitude("Cohen's d", Math.abs(d)) },
        reasoning: `Data is normally distributed (all Shapiro-Wilk p > ${alpha}) with equal variances (Levene's p = ${varianceTest.pValue.toFixed(3)}).`,
      };
    } else if (allNormal && !equalVar) {
      const res = welchsTTest(groups[0], groups[1]);
      const d = cohensD(groups[0], groups[1]);
      testResult = {
        testName: "Welch's t-test",
        statistic: res.t,
        statisticName: 't',
        df: parseFloat(res.df.toFixed(1)),
        pValue: res.pValue,
        effectSize: { name: "Cohen's d", value: d, magnitude: effectMagnitude("Cohen's d", Math.abs(d)) },
        reasoning: `Data is normally distributed but variances are unequal (Levene's p = ${varianceTest.pValue.toFixed(3)}).`,
      };
    } else {
      const res = mannWhitneyU(groups[0], groups[1]);
      const r = rankBiserialR(res.U, groups[0].length, groups[1].length);
      testResult = {
        testName: "Mann-Whitney U test",
        statistic: res.U,
        statisticName: 'U',
        df: NaN,
        pValue: res.pValue,
        effectSize: { name: 'r', value: r, magnitude: effectMagnitude('r', Math.abs(r)) },
        reasoning: `Data is not normally distributed (at least one group fails Shapiro-Wilk at α = ${alpha}). Non-parametric test used.`,
      };
    }
  } else {
    // 3+ group tests
    if (allNormal && equalVar) {
      const res = oneWayAnova(groups);
      const eta2 = etaSquared(res.ssBetween, res.ssTotal);
      testResult = {
        testName: "One-way ANOVA",
        statistic: res.F,
        statisticName: 'F',
        df: [res.df1, res.df2],
        pValue: res.pValue,
        effectSize: { name: 'η²', value: eta2, magnitude: effectMagnitude('η²', eta2) },
        reasoning: `Data is normally distributed with equal variances (Levene's p = ${varianceTest.pValue.toFixed(3)}).`,
      };
      if (res.pValue < alpha) {
        postHoc = tukeyHSD(groups, groupNames, alpha);
      }
    } else if (allNormal && !equalVar) {
      const res = welchsAnova(groups);
      const eta2 = etaSquared(res.ssBetween, res.ssTotal);
      testResult = {
        testName: "Welch's ANOVA",
        statistic: res.F,
        statisticName: 'F',
        df: [res.df1, parseFloat(res.df2.toFixed(1))],
        pValue: res.pValue,
        effectSize: { name: 'η²', value: eta2, magnitude: effectMagnitude('η²', eta2) },
        reasoning: `Data is normally distributed but variances are unequal (Levene's p = ${varianceTest.pValue.toFixed(3)}).`,
      };
      if (res.pValue < alpha) {
        postHoc = tukeyHSD(groups, groupNames, alpha); // Tukey acceptable, Games-Howell ideal
      }
    } else {
      const res = kruskalWallis(groups);
      // Epsilon-squared for Kruskal-Wallis
      const N = groups.reduce((s, g) => s + g.length, 0);
      const eta2H = (res.H - k + 1) / (N - k);
      testResult = {
        testName: "Kruskal-Wallis test",
        statistic: res.H,
        statisticName: 'H',
        df: res.df,
        pValue: res.pValue,
        effectSize: { name: 'η²H', value: Math.max(0, eta2H), magnitude: effectMagnitude('η²', Math.max(0, eta2H)) },
        reasoning: `Data is not normally distributed (at least one group fails Shapiro-Wilk at α = ${alpha}). Non-parametric test used.`,
      };
      if (res.pValue < alpha) {
        postHoc = dunnsTest(groups, groupNames, alpha);
      }
    }
  }

  return {
    groupStats: stats,
    normalityTests,
    varianceTest,
    testResult,
    postHoc,
  };
};

// ═══════════════════════════════════════════════════════════════════
// Section 10: Matrix Helpers (for Two-Way ANOVA)
// ═══════════════════════════════════════════════════════════════════

/** Transpose a matrix */
const matTranspose = (A: number[][]): number[][] => {
  const rows = A.length, cols = A[0].length;
  const T: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      T[j][i] = A[i][j];
  return T;
};

/** Multiply two matrices */
const matMul = (A: number[][], B: number[][]): number[][] => {
  const m = A.length, n = B[0].length, p = B.length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let k = 0; k < p; k++) {
      const a = A[i][k];
      for (let j = 0; j < n; j++)
        C[i][j] += a * B[k][j];
    }
  return C;
};

/** Invert a square matrix via Gaussian elimination with partial pivoting */
const matInverse = (M: number[][]): number[][] | null => {
  const n = M.length;
  // Augment with identity
  const aug: number[][] = M.map((row, i) => {
    const id = new Array(n).fill(0);
    id[i] = 1;
    return [...row, ...id];
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col, maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal < 1e-12) return null; // singular
    if (maxRow !== col) { const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp; }

    // Eliminate
    const pivot = aug[col][col];
    for (let j = col; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map(row => row.slice(n));
};

/** Compute residual sum of squares: ||y - X*beta||^2 where beta = (X'X)^-1 X'y */
const computeSSResidual = (X: number[][], y: number[]): { ss: number; fitted: number[] } | null => {
  const Xt = matTranspose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = matInverse(XtX);
  if (!XtXinv) return null;

  const yCol = y.map(v => [v]);
  const Xty = matMul(Xt, yCol);
  const beta = matMul(XtXinv, Xty);

  const fitted = X.map(row => row.reduce((s, v, j) => s + v * beta[j][0], 0));
  let ss = 0;
  for (let i = 0; i < y.length; i++) ss += (y[i] - fitted[i]) ** 2;
  return { ss, fitted };
};

// ═══════════════════════════════════════════════════════════════════
// Section 11: Two-Way ANOVA
// ═══════════════════════════════════════════════════════════════════

/**
 * Two-way factorial ANOVA with Type III SS.
 * Uses effect coding and the "extra sum of squares" principle.
 */
export const twoWayAnova = (
  data: { value: number; factorA: string; factorB: string }[],
  alpha: number = 0.05
): TwoWayAnovaResult | AnalysisError => {
  const N = data.length;
  if (N < 6) return { error: 'Need at least 6 observations for two-way ANOVA.' };

  const levelsA = [...new Set(data.map(d => d.factorA))].sort();
  const levelsB = [...new Set(data.map(d => d.factorB))].sort();
  const a = levelsA.length, b = levelsB.length;

  if (a < 2) return { error: 'Factor A must have at least 2 levels.' };
  if (b < 2) return { error: 'Factor B must have at least 2 levels.' };

  const warnings: string[] = [];
  if (a > 20) warnings.push(`Factor A has ${a} levels — computation may be slow.`);
  if (b > 20) warnings.push(`Factor B has ${b} levels — computation may be slow.`);

  // Build cell data
  const cellMap = new Map<string, number[]>();
  for (const d of data) {
    const key = `${d.factorA}|${d.factorB}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key)!.push(d.value);
  }

  // Check for empty cells
  const emptyCells: string[] = [];
  for (const la of levelsA) {
    for (const lb of levelsB) {
      const key = `${la}|${lb}`;
      const cell = cellMap.get(key);
      if (!cell || cell.length === 0) emptyCells.push(`${la} × ${lb}`);
      else if (cell.length < 2) warnings.push(`Cell ${la} × ${lb} has only ${cell.length} observation(s).`);
    }
  }
  if (emptyCells.length > 0) {
    return { error: `Empty cells in design: ${emptyCells.slice(0, 5).join(', ')}${emptyCells.length > 5 ? ` (and ${emptyCells.length - 5} more)` : ''}. Two-way ANOVA requires observations in all cells.` };
  }

  // Cell stats
  const cellStats: CellStats[] = [];
  for (const la of levelsA) {
    for (const lb of levelsB) {
      const vals = cellMap.get(`${la}|${lb}`)!;
      cellStats.push({ factorA: la, factorB: lb, n: vals.length, mean: mean(vals), sd: sd(vals) });
    }
  }

  // Build design matrix with effect coding
  // Columns: intercept | A effect codes (a-1) | B effect codes (b-1) | AB interaction ((a-1)*(b-1))
  const y: number[] = data.map(d => d.value);
  const colsA = a - 1, colsB = b - 1, colsAB = colsA * colsB;
  const totalCols = 1 + colsA + colsB + colsAB;

  const X: number[][] = data.map(d => {
    const row = new Array(totalCols).fill(0);
    row[0] = 1; // intercept

    const ai = levelsA.indexOf(d.factorA);
    const bi = levelsB.indexOf(d.factorB);

    // Effect coding for Factor A
    for (let j = 0; j < colsA; j++) {
      if (ai === j) row[1 + j] = 1;
      else if (ai === a - 1) row[1 + j] = -1; // last level = -1 for all
    }

    // Effect coding for Factor B
    for (let j = 0; j < colsB; j++) {
      if (bi === j) row[1 + colsA + j] = 1;
      else if (bi === b - 1) row[1 + colsA + j] = -1;
    }

    // Interaction: element-wise product of A and B codes
    for (let ja = 0; ja < colsA; ja++) {
      for (let jb = 0; jb < colsB; jb++) {
        row[1 + colsA + colsB + ja * colsB + jb] = row[1 + ja] * row[1 + colsA + jb];
      }
    }

    return row;
  });

  // Fit full model
  const fullResult = computeSSResidual(X, y);
  if (!fullResult) return { error: 'Design matrix is singular — cannot compute ANOVA. Check for empty or constant cells.' };
  const ssResidFull = fullResult.ss;
  const residuals = y.map((v, i) => v - fullResult.fitted[i]);

  // SS Total
  const grandMean = mean(y);
  let ssTotal = 0;
  for (const v of y) ssTotal += (v - grandMean) ** 2;

  // Type III SS: for each effect, remove its columns and refit
  const removeColumns = (cols: number[]): number[][] => {
    const keep = Array.from({ length: totalCols }, (_, i) => i).filter(i => !cols.includes(i));
    return X.map(row => keep.map(j => row[j]));
  };

  // Column indices for each effect
  const aColIndices = Array.from({ length: colsA }, (_, i) => 1 + i);
  const bColIndices = Array.from({ length: colsB }, (_, i) => 1 + colsA + i);
  const abColIndices = Array.from({ length: colsAB }, (_, i) => 1 + colsA + colsB + i);

  // SS for Factor A
  const noA = computeSSResidual(removeColumns(aColIndices), y);
  if (!noA) return { error: 'Singular matrix when testing Factor A.' };
  const ssA = noA.ss - ssResidFull;

  // SS for Factor B
  const noB = computeSSResidual(removeColumns(bColIndices), y);
  if (!noB) return { error: 'Singular matrix when testing Factor B.' };
  const ssB = noB.ss - ssResidFull;

  // SS for Interaction
  const noAB = computeSSResidual(removeColumns(abColIndices), y);
  if (!noAB) return { error: 'Singular matrix when testing interaction.' };
  const ssAB = noAB.ss - ssResidFull;

  // Degrees of freedom
  const dfA = a - 1;
  const dfB = b - 1;
  const dfAB = dfA * dfB;
  const dfResid = N - a * b;

  if (dfResid < 1) {
    return { error: `Not enough observations (N=${N}) for ${a}×${b} design. Need more than ${a * b} total observations.` };
  }

  const msResid = ssResidFull / dfResid;

  // Build effects
  const buildEffect = (source: string, ss: number, df: number): TwoWayAnovaEffect => {
    const ms = df > 0 ? ss / df : 0;
    const F = msResid > 0 ? ms / msResid : 0;
    const pValue = df > 0 && dfResid > 0 && F > 0 ? 1 - jStat.centralF.cdf(F, df, dfResid) : 1;
    const pEtaSq = partialEtaSquared(ss, ssResidFull);
    return { source, ss, df, ms, F, pValue, partialEtaSq: pEtaSq, magnitude: effectMagnitude('η²', pEtaSq) };
  };

  const effectA = buildEffect('Factor A', ssA, dfA);
  const effectB = buildEffect('Factor B', ssB, dfB);
  const effectAB = buildEffect('A × B', ssAB, dfAB);
  const effectResid: TwoWayAnovaEffect = {
    source: 'Residual', ss: ssResidFull, df: dfResid, ms: msResid,
    F: NaN, pValue: NaN, partialEtaSq: NaN, magnitude: '',
  };
  const effectTotal: TwoWayAnovaEffect = {
    source: 'Total', ss: ssTotal, df: N - 1, ms: NaN,
    F: NaN, pValue: NaN, partialEtaSq: NaN, magnitude: '',
  };

  const effects = [effectA, effectB, effectAB, effectResid, effectTotal];

  // Marginal stats
  const marginalA: Map<string, number[]> = new Map();
  const marginalB: Map<string, number[]> = new Map();
  for (const d of data) {
    if (!marginalA.has(d.factorA)) marginalA.set(d.factorA, []);
    marginalA.get(d.factorA)!.push(d.value);
    if (!marginalB.has(d.factorB)) marginalB.set(d.factorB, []);
    marginalB.get(d.factorB)!.push(d.value);
  }
  const marginalStatsA = levelsA.map(l => groupStatsFor(l, marginalA.get(l)!));
  const marginalStatsB = levelsB.map(l => groupStatsFor(l, marginalB.get(l)!));

  // Diagnostics
  const normalityTest: NormalityResult = (() => {
    const sw = shapiroWilk(residuals.length > 5000 ? residuals.slice(0, 5000) : residuals);
    return { group: 'Residuals', W: sw.W, pValue: sw.pValue, isNormal: sw.pValue > alpha };
  })();

  // Levene's across cells
  const cellGroups = levelsA.flatMap(la => levelsB.map(lb => cellMap.get(`${la}|${lb}`)!));
  const varianceTest = levenesTest(cellGroups);

  // Post-hoc for significant main effects
  let postHocA: PostHocResult[] | null = null;
  let postHocB: PostHocResult[] | null = null;
  if (effectA.pValue < alpha && a >= 3) {
    const groupsA = levelsA.map(l => marginalA.get(l)!);
    postHocA = tukeyHSD(groupsA, levelsA, alpha);
  }
  if (effectB.pValue < alpha && b >= 3) {
    const groupsB = levelsB.map(l => marginalB.get(l)!);
    postHocB = tukeyHSD(groupsB, levelsB, alpha);
  }

  // Simple effects when interaction is significant
  let simpleEffectsA: SimpleEffect[] | null = null;
  let simpleEffectsB: SimpleEffect[] | null = null;

  if (effectAB.pValue < alpha) {
    // Effect of Factor A at each level of Factor B
    simpleEffectsA = levelsB.map(levelB => {
      const subset = new Map<string, number[]>();
      for (const la of levelsA) {
        const vals = cellMap.get(`${la}|${levelB}`);
        if (vals && vals.length > 0) subset.set(la, vals);
      }
      if (subset.size < 2) {
        return {
          level: levelB, testName: 'N/A', statistic: NaN, statisticName: '',
          df: NaN, pValue: NaN,
          effectSize: { name: '', value: NaN, magnitude: '' },
          groupStats: [...subset.entries()].map(([name, vals]) => groupStatsFor(name, vals)),
        };
      }
      const result = runAnalysis(subset, alpha);
      if ('error' in result) {
        return {
          level: levelB, testName: 'Error', statistic: NaN, statisticName: '',
          df: NaN, pValue: NaN,
          effectSize: { name: '', value: NaN, magnitude: '' },
          groupStats: result.groupStats || [],
        };
      }
      return {
        level: levelB,
        testName: result.testResult.testName,
        statistic: result.testResult.statistic,
        statisticName: result.testResult.statisticName,
        df: result.testResult.df,
        pValue: result.testResult.pValue,
        effectSize: result.testResult.effectSize,
        groupStats: result.groupStats,
      };
    });

    // Effect of Factor B at each level of Factor A
    simpleEffectsB = levelsA.map(levelA => {
      const subset = new Map<string, number[]>();
      for (const lb of levelsB) {
        const vals = cellMap.get(`${levelA}|${lb}`);
        if (vals && vals.length > 0) subset.set(lb, vals);
      }
      if (subset.size < 2) {
        return {
          level: levelA, testName: 'N/A', statistic: NaN, statisticName: '',
          df: NaN, pValue: NaN,
          effectSize: { name: '', value: NaN, magnitude: '' },
          groupStats: [...subset.entries()].map(([name, vals]) => groupStatsFor(name, vals)),
        };
      }
      const result = runAnalysis(subset, alpha);
      if ('error' in result) {
        return {
          level: levelA, testName: 'Error', statistic: NaN, statisticName: '',
          df: NaN, pValue: NaN,
          effectSize: { name: '', value: NaN, magnitude: '' },
          groupStats: result.groupStats || [],
        };
      }
      return {
        level: levelA,
        testName: result.testResult.testName,
        statistic: result.testResult.statistic,
        statisticName: result.testResult.statisticName,
        df: result.testResult.df,
        pValue: result.testResult.pValue,
        effectSize: result.testResult.effectSize,
        groupStats: result.groupStats,
      };
    });
  }

  return {
    effects, cellStats, marginalStatsA, marginalStatsB,
    normalityTest, varianceTest,
    postHocA, postHocB,
    simpleEffectsA, simpleEffectsB,
    N, warnings,
  };
};

// ═══════════════════════════════════════════════════════════════════
// Section 12: Contingency Table Analysis
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a contingency table from paired categorical values and run
 * chi-square test of independence (or Fisher's exact for 2×2 with small counts).
 */
export const runContingencyAnalysis = (
  var1Values: string[],
  var2Values: string[],
  alpha: number = 0.05
): ContingencyTableResult | AnalysisError => {
  if (var1Values.length !== var2Values.length) return { error: 'Variable arrays must have equal length.' };
  const n = var1Values.length;
  if (n < 4) return { error: 'Need at least 4 observations for contingency analysis.' };

  // Build contingency table
  const rowLabels = [...new Set(var1Values)].sort();
  const colLabels = [...new Set(var2Values)].sort();
  const rows = rowLabels.length, cols = colLabels.length;

  if (rows < 2) return { error: 'Row variable must have at least 2 levels.' };
  if (cols < 2) return { error: 'Column variable must have at least 2 levels.' };

  const rowIdx = new Map(rowLabels.map((l, i) => [l, i]));
  const colIdx = new Map(colLabels.map((l, i) => [l, i]));

  const observed: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < n; i++) {
    const r = rowIdx.get(var1Values[i]);
    const c = colIdx.get(var2Values[i]);
    if (r !== undefined && c !== undefined) observed[r][c]++;
  }

  // Row/column totals
  const rowTotals = observed.map(r => r.reduce((s, v) => s + v, 0));
  const colTotals = new Array(cols).fill(0);
  let grandTotal = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      colTotals[j] += observed[i][j];
      grandTotal += observed[i][j];
    }
  }

  // Expected counts
  const expected: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => rowTotals[i] * colTotals[j] / grandTotal)
  );

  // Adjusted standardized residuals
  const standardizedResiduals: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const e = expected[i][j];
      if (e === 0) return 0;
      const denom = Math.sqrt(e * (1 - rowTotals[i] / grandTotal) * (1 - colTotals[j] / grandTotal));
      return denom === 0 ? 0 : (observed[i][j] - e) / denom;
    })
  );

  // Warnings
  const warnings: string[] = [];
  let smallExpected = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (expected[i][j] < 5) smallExpected++;
    }
  }
  if (smallExpected > 0) {
    warnings.push(`${smallExpected} cell(s) have expected count < 5.`);
  }

  // Choose test
  let testResult: TestResult;
  const is2x2 = rows === 2 && cols === 2;
  const useFisher = is2x2 && smallExpected > 0;

  if (useFisher) {
    // Fisher's exact test for 2×2
    const result = fisherExact2x2(observed[0][0], observed[0][1], observed[1][0], observed[1][1]);
    const minDim = Math.min(rows, cols);
    // Compute chi-sq for Cramér's V even when using Fisher's
    const chi = chiSquareIndependence(observed);
    const v = cramersV(chi.chiSq, grandTotal, minDim);
    testResult = {
      testName: "Fisher's exact test",
      statistic: result.pValue, // Fisher's doesn't have a test statistic per se
      statisticName: 'p',
      df: NaN,
      pValue: result.pValue,
      effectSize: { name: "Cramér's V", value: v, magnitude: effectMagnitude("Cramér's V", v) },
      reasoning: `2×2 table with expected cell count(s) < 5. Fisher's exact test is more accurate than chi-square for small samples.`,
    };
  } else {
    // Chi-square test of independence
    const result = chiSquareIndependence(observed);
    const minDim = Math.min(rows, cols);
    const v = cramersV(result.chiSq, grandTotal, minDim);
    let reasoning = `${rows}×${cols} contingency table.`;
    if (smallExpected > 0) {
      reasoning += ` Warning: ${smallExpected} cell(s) have expected count < 5; chi-square may be unreliable.`;
    }
    testResult = {
      testName: "Chi-square test of independence",
      statistic: result.chiSq,
      statisticName: 'χ²',
      df: result.df,
      pValue: result.pValue,
      effectSize: { name: "Cramér's V", value: v, magnitude: effectMagnitude("Cramér's V", v) },
      reasoning,
    };
  }

  return {
    observed, expected, rowLabels, colLabels,
    rowTotals, colTotals, grandTotal,
    testResult, standardizedResiduals, warnings,
  };
};

// ═══════════════════════════════════════════════════════════════════
// Utility: Significance Stars
// ═══════════════════════════════════════════════════════════════════

export const sigStars = (p: number): string => {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
};

export const formatP = (p: number): string => {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
};
