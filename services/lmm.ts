/**
 * FRED linear mixed-effects models: random intercepts, one or two crossed
 * grouping factors (speaker, word), fitted by profiled REML/ML deviance as in
 * lme4 (Bates, Maechler, Bolker & Walker 2015), with dense Cholesky solves.
 *
 * Scope is deliberately narrow: random INTERCEPTS only. Random slopes are the
 * point where naive fitters fail silently; those models belong in R (lme4).
 * Inference for fixed effects uses likelihood-ratio tests on ML fits, which
 * avoids the denominator-degrees-of-freedom problem entirely.
 */

import jStat from 'jstat-esm';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface LmmGroup {
  name: string;                 // 'speaker', 'word'
  /** Level index (0..nLevels-1) for every observation. */
  indices: Int32Array;
  nLevels: number;
  levelNames: string[];
}

export interface LmmFixedEffect { name: string; estimate: number; se: number; t: number; }
export interface LmmVarComp { group: string; variance: number; sd: number; levels: number; }

export interface LmmFit {
  formula: string;
  fixed: LmmFixedEffect[];
  varComps: LmmVarComp[];       // grouping factors, then 'Residual'
  n: number;
  p: number;
  q: number;
  remlDeviance: number;
  mlDeviance: number;
  converged: boolean;
  warnings: string[];
}

export interface LmmLRT {
  chiSq: number;
  df: number;
  pValue: number;
  devFull: number;
  devNull: number;
}

export interface LmmError { error: string; }

/** Guard: dense Cholesky is O(q³); past this many random-effect levels, use R. */
export const LMM_MAX_LEVELS = 1200;

// ═══════════════════════════════════════════════════════════════════
// Dense linear algebra on Float64Array (row-major)
// ═══════════════════════════════════════════════════════════════════

/** In-place lower Cholesky of the symmetric positive-definite n×n matrix A. */
const cholesky = (A: Float64Array, n: number): boolean => {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] ** 2;
    if (d <= 0) return false;
    const s = Math.sqrt(d);
    A[j * n + j] = s;
    for (let i = j + 1; i < n; i++) {
      let v = A[i * n + j];
      for (let k = 0; k < j; k++) v -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = v / s;
    }
    for (let k = j + 1; k < n; k++) A[j * n + k] = 0;   // zero upper triangle
  }
  return true;
};

/** Solve L * X = B in place (B is n×m row-major), L lower-triangular. */
const forwardSolve = (L: Float64Array, n: number, B: Float64Array, m: number): void => {
  for (let c = 0; c < m; c++) {
    for (let i = 0; i < n; i++) {
      let v = B[i * m + c];
      for (let k = 0; k < i; k++) v -= L[i * n + k] * B[k * m + c];
      B[i * m + c] = v / L[i * n + i];
    }
  }
};

/** Solve L' * X = B in place (B is n×m row-major), L lower-triangular. */
const backSolveT = (L: Float64Array, n: number, B: Float64Array, m: number): void => {
  for (let c = 0; c < m; c++) {
    for (let i = n - 1; i >= 0; i--) {
      let v = B[i * m + c];
      for (let k = i + 1; k < n; k++) v -= L[k * n + i] * B[k * m + c];
      B[i * m + c] = v / L[i * n + i];
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// Profiled deviance
// ═══════════════════════════════════════════════════════════════════

interface DevianceParts {
  deviance: number;             // REML or ML criterion
  beta: Float64Array;
  sigma2: number;               // residual variance at the profiled optimum
  RXinvDiagSq: Float64Array;    // diag of (RX'RX)^-1, for fixed-effect SEs
  ok: boolean;
}

/**
 * Evaluate the profiled deviance at theta (one entry per grouping factor).
 * theta_g = sigma_g / sigma_residual. Follows lme4's penalized least squares:
 * solve for the modes u and beta, then read the deviance off the determinants
 * and the penalized residual sum of squares.
 */
const profiledDeviance = (
  y: Float64Array, X: Float64Array, n: number, p: number,
  groups: LmmGroup[], theta: number[], reml: boolean,
): DevianceParts => {
  const fail: DevianceParts = { deviance: Infinity, beta: new Float64Array(p), sigma2: NaN, RXinvDiagSq: new Float64Array(p), ok: false };
  const offsets: number[] = [];
  let q = 0;
  for (const g of groups) { offsets.push(q); q += g.nLevels; }

  // A = Lambda' Z' Z Lambda + I  (q×q). Z columns are level indicators, so
  // Z'Z entries are level counts and cross-tabulations.
  const A = new Float64Array(q * q);
  for (let a = 0; a < groups.length; a++) {
    const ga = groups[a], ta = theta[a], oa = offsets[a];
    for (let i = 0; i < n; i++) {
      const ra = oa + ga.indices[i];
      A[ra * q + ra] += ta * ta;
      for (let b = a + 1; b < groups.length; b++) {
        const gb = groups[b], tb = theta[b], ob = offsets[b];
        const rb = ob + gb.indices[i];
        A[ra * q + rb] += ta * tb;
        A[rb * q + ra] += ta * tb;
      }
    }
  }
  for (let i = 0; i < q; i++) A[i * q + i] += 1;

  const L = A;                       // factored in place
  if (!cholesky(L, q)) return fail;

  // Lambda'Z'X (q×p) and Lambda'Z'y (q×1)
  const ZtX = new Float64Array(q * p);
  const Zty = new Float64Array(q);
  for (let a = 0; a < groups.length; a++) {
    const g = groups[a], t = theta[a], o = offsets[a];
    for (let i = 0; i < n; i++) {
      const r = o + g.indices[i];
      Zty[r] += t * y[i];
      for (let c = 0; c < p; c++) ZtX[r * p + c] += t * X[i * p + c];
    }
  }

  // RZX = L^-1 (Lambda'Z'X); cu = L^-1 (Lambda'Z'y)
  forwardSolve(L, q, ZtX, p);        // ZtX now holds RZX
  forwardSolve(L, q, Zty, 1);        // Zty now holds cu

  // RX'RX = X'X - RZX'RZX, then Cholesky
  const XtX = new Float64Array(p * p);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < p; a++)
      for (let b = 0; b < p; b++)
        XtX[a * p + b] += X[i * p + a] * X[i * p + b];
  for (let r = 0; r < q; r++)
    for (let a = 0; a < p; a++)
      for (let b = 0; b < p; b++)
        XtX[a * p + b] -= ZtX[r * p + a] * ZtX[r * p + b];
  const RX = XtX;
  if (!cholesky(RX, p)) return fail;

  // beta from RX'RX beta = X'y - RZX' cu
  const Xty = new Float64Array(p);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < p; c++) Xty[c] += X[i * p + c] * y[i];
  for (let r = 0; r < q; r++)
    for (let c = 0; c < p; c++) Xty[c] -= ZtX[r * p + c] * Zty[r];
  forwardSolve(RX, p, Xty, 1);
  backSolveT(RX, p, Xty, 1);
  const beta = Xty;

  // u = L'^-1 (cu - RZX beta)
  const u = new Float64Array(q);
  for (let r = 0; r < q; r++) {
    let v = Zty[r];
    for (let c = 0; c < p; c++) v -= ZtX[r * p + c] * beta[c];
    u[r] = v;
  }
  backSolveT(L, q, u, 1);

  // Penalized residual sum of squares: ||y - X beta - Z Lambda u||^2 + ||u||^2
  let pwrss = 0;
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let c = 0; c < p; c++) fit += X[i * p + c] * beta[c];
    for (let a = 0; a < groups.length; a++) {
      fit += theta[a] * u[offsets[a] + groups[a].indices[i]];
    }
    pwrss += (y[i] - fit) ** 2;
  }
  for (let r = 0; r < q; r++) pwrss += u[r] * u[r];

  let logDetL2 = 0;
  for (let i = 0; i < q; i++) logDetL2 += 2 * Math.log(L[i * q + i]);
  let logDetRX2 = 0;
  for (let i = 0; i < p; i++) logDetRX2 += 2 * Math.log(RX[i * p + i]);

  const dof = reml ? (n - p) : n;
  const deviance = logDetL2 + (reml ? logDetRX2 : 0)
    + dof * (1 + Math.log((2 * Math.PI * pwrss) / dof));
  const sigma2 = pwrss / dof;

  // diag of (RX'RX)^-1 via triangular solves on unit vectors
  const RXinvDiagSq = new Float64Array(p);
  const e = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    e.fill(0); e[j] = 1;
    forwardSolve(RX, p, e, 1);
    backSolveT(RX, p, e, 1);
    RXinvDiagSq[j] = e[j];
  }

  return { deviance, beta, sigma2, RXinvDiagSq, ok: true };
};

// ═══════════════════════════════════════════════════════════════════
// Optimizer: Nelder-Mead over theta >= 0, with restarts
// ═══════════════════════════════════════════════════════════════════

const nelderMead = (
  f: (x: number[]) => number, start: number[], maxIter = 500,
): { x: number[]; fx: number; converged: boolean } => {
  const d = start.length;
  if (d === 1) {
    // Golden-section on [0, hi], expanding hi as needed
    let lo = 0, hi = Math.max(4, start[0] * 4);
    while (f([hi]) < f([hi * 0.98]) && hi < 1e4) hi *= 2;
    const phi = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    let c = b - phi * (b - a), e = a + phi * (b - a);
    let fc = f([c]), fe = f([e]);
    for (let i = 0; i < 200 && (b - a) > 1e-9 * (1 + b); i++) {
      if (fc < fe) { b = e; e = c; fe = fc; c = b - phi * (b - a); fc = f([c]); }
      else { a = c; c = e; fc = fe; e = a + phi * (b - a); fe = f([e]); }
    }
    const x = fc < fe ? c : e;
    return { x: [x], fx: Math.min(fc, fe), converged: true };
  }

  // Standard Nelder-Mead with clamping to theta >= 0
  const clamp = (x: number[]) => x.map(v => Math.max(0, v));
  let simplex: number[][] = [clamp(start)];
  for (let i = 0; i < d; i++) {
    const v = [...start];
    v[i] = v[i] > 0.25 ? v[i] * 1.5 : 0.5;
    simplex.push(clamp(v));
  }
  let fx = simplex.map(f);
  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    const order = fx.map((v, i) => i).sort((a, b) => fx[a] - fx[b]);
    simplex = order.map(i => simplex[i]);
    fx = order.map(i => fx[i]);
    if (Math.abs(fx[d] - fx[0]) < 1e-10 * (1 + Math.abs(fx[0]))) { converged = true; break; }

    const centroid = new Array(d).fill(0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) centroid[j] += simplex[i][j] / d;
    const worst = simplex[d];
    const refl = clamp(centroid.map((c, j) => c + (c - worst[j])));
    const fRefl = f(refl);
    if (fRefl < fx[0]) {
      const exp = clamp(centroid.map((c, j) => c + 2 * (c - worst[j])));
      const fExp = f(exp);
      if (fExp < fRefl) { simplex[d] = exp; fx[d] = fExp; }
      else { simplex[d] = refl; fx[d] = fRefl; }
    } else if (fRefl < fx[d - 1]) {
      simplex[d] = refl; fx[d] = fRefl;
    } else {
      const contr = clamp(centroid.map((c, j) => c + 0.5 * (worst[j] - c)));
      const fContr = f(contr);
      if (fContr < fx[d]) { simplex[d] = contr; fx[d] = fContr; }
      else {
        for (let i = 1; i <= d; i++) {
          simplex[i] = clamp(simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])));
          fx[i] = f(simplex[i]);
        }
      }
    }
  }
  const best = fx.indexOf(Math.min(...fx));
  return { x: simplex[best], fx: fx[best], converged };
};

const optimizeTheta = (
  f: (theta: number[]) => number, nGroups: number,
): { theta: number[]; fx: number; converged: boolean } => {
  // A few restarts guard against a bad basin; the profile is usually unimodal.
  const starts = nGroups === 1 ? [[1], [0.2], [3]] : [[1, 1], [0.2, 0.2], [2, 0.5], [0.5, 2]];
  let best: { x: number[]; fx: number; converged: boolean } | null = null;
  for (const s of starts) {
    const r = nelderMead(f, s);
    if (!best || r.fx < best.fx) best = r;
  }
  return { theta: best!.x, fx: best!.fx, converged: best!.converged };
};

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

export interface LmmInput {
  y: number[];
  /** Fixed factor levels per observation; null for an intercept-only model. */
  fixedLevels: string[] | null;
  /** Grouping assignments per observation, e.g. speaker and word labels. */
  groupings: { name: string; labels: string[] }[];
}

const buildGroups = (groupings: { name: string; labels: string[] }[]): LmmGroup[] =>
  groupings.map(g => {
    const levelNames = Array.from(new Set(g.labels)).sort();
    const idx = new Map(levelNames.map((l, i) => [l, i]));
    return {
      name: g.name,
      indices: Int32Array.from(g.labels.map(l => idx.get(l)!)),
      nLevels: levelNames.length,
      levelNames,
    };
  });

/** Treatment-coded design matrix: intercept + one dummy per non-reference level. */
const buildX = (fixedLevels: string[] | null, n: number): { X: Float64Array; p: number; names: string[]; levels: string[] } => {
  if (!fixedLevels) {
    const X = new Float64Array(n);
    X.fill(1);
    return { X, p: 1, names: ['(Intercept)'], levels: [] };
  }
  const levels = Array.from(new Set(fixedLevels)).sort();
  const p = levels.length;                 // intercept + (p-1) dummies
  const X = new Float64Array(n * p);
  const idx = new Map(levels.map((l, i) => [l, i]));
  for (let i = 0; i < n; i++) {
    X[i * p] = 1;
    const j = idx.get(fixedLevels[i])!;
    if (j > 0) X[i * p + j] = 1;
  }
  const names = ['(Intercept)', ...levels.slice(1).map(l => `${l} − ${levels[0]}`)];
  return { X, p, names, levels };
};

/** Fit the model by REML (estimates) and ML (for likelihood-ratio tests). */
export const fitLmm = (input: LmmInput): LmmFit | LmmError => {
  const n = input.y.length;
  if (n < 10) return { error: 'Need at least 10 observations for a mixed model.' };
  const groups = buildGroups(input.groupings);
  const q = groups.reduce((s, g) => s + g.nLevels, 0);
  if (q > LMM_MAX_LEVELS) {
    return { error: `The random effects have ${q} levels; FRED's fitter handles up to ${LMM_MAX_LEVELS}. Use the R export for this model.` };
  }
  if (groups.some(g => g.nLevels < 2)) {
    return { error: 'Each grouping factor needs at least 2 levels.' };
  }

  const { X, p, names } = buildX(input.fixedLevels, n);
  if (n <= p + 1) return { error: 'Too few observations for the number of fixed-effect levels.' };
  const y = Float64Array.from(input.y);

  const remlF = (theta: number[]) => {
    const d = profiledDeviance(y, X, n, p, groups, theta, true);
    return d.ok ? d.deviance : Infinity;
  };
  const opt = optimizeTheta(remlF, groups.length);
  const at = profiledDeviance(y, X, n, p, groups, opt.theta, true);
  if (!at.ok) return { error: 'The model could not be fitted (singular system).' };

  const mlF = (theta: number[]) => {
    const d = profiledDeviance(y, X, n, p, groups, theta, false);
    return d.ok ? d.deviance : Infinity;
  };
  const mlOpt = optimizeTheta(mlF, groups.length);

  const sigma2 = at.sigma2;
  const warnings: string[] = [];
  const varComps: LmmVarComp[] = groups.map((g, i) => {
    const v = (opt.theta[i] ** 2) * sigma2;
    if (opt.theta[i] < 1e-4) warnings.push(`The ${g.name} variance is estimated at (or near) zero — the ${g.name} grouping explains nothing beyond the residual.`);
    return { group: g.name, variance: v, sd: Math.sqrt(v), levels: g.nLevels };
  });
  varComps.push({ group: 'Residual', variance: sigma2, sd: Math.sqrt(sigma2), levels: n });
  if (!opt.converged) warnings.push('The optimizer did not fully converge; treat the estimates with caution.');

  const fixed: LmmFixedEffect[] = names.map((name, j) => {
    const se = Math.sqrt(sigma2 * at.RXinvDiagSq[j]);
    return { name, estimate: at.beta[j], se, t: at.beta[j] / se };
  });

  const grouping = groups.map(g => `(1|${g.name})`).join(' + ');
  const formula = input.fixedLevels ? `value ~ factor + ${grouping}` : `value ~ 1 + ${grouping}`;

  return {
    formula, fixed, varComps,
    n, p, q,
    remlDeviance: opt.fx,
    mlDeviance: mlOpt.fx,
    converged: opt.converged && mlOpt.converged,
    warnings,
  };
};

/**
 * Likelihood-ratio test for the fixed factor: ML fit with the factor vs the
 * intercept-only ML fit with the same random effects.
 */
export const lmmLRT = (input: LmmInput): (LmmFit & { lrt: LmmLRT }) | LmmError => {
  if (!input.fixedLevels) return { error: 'The likelihood-ratio test needs a fixed factor.' };
  const full = fitLmm(input);
  if ('error' in full) return full;
  const nullFit = fitLmm({ ...input, fixedLevels: null });
  if ('error' in nullFit) return nullFit;

  const chiSq = Math.max(0, nullFit.mlDeviance - full.mlDeviance);
  const df = full.p - nullFit.p;
  const pValue = 1 - jStat.chisquare.cdf(chiSq, df);
  return {
    ...full,
    lrt: { chiSq, df, pValue, devFull: full.mlDeviance, devNull: nullFit.mlDeviance },
  };
};
