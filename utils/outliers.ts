import { SpeechToken, PlotConfig } from '../types';
import { getLabel } from './getLabel';
import { normalizeFormant, NormalizationMethod, SpeakerStatsMap } from './normalization';
import { findNearestTimePoint } from './trajectory';

/**
 * Tokens lying outside the ellipse drawn around their group.
 *
 * A mistracked formant usually shows up as a point far from its vowel's cloud, so the
 * ellipse on screen doubles as a review queue: whatever falls outside it is worth
 * listening to again. This module answers, for the plot as it is currently drawn, which
 * tokens those are and in which direction each one is extreme.
 *
 * The ellipse is drawn from the group's covariance, and a point is inside it exactly
 * when its Mahalanobis distance from the group mean is within the chosen SD multiple.
 * That distance is invariant under any linear change of axes, so working in data space
 * here selects precisely the points that fall outside the ellipse in screen space.
 */

/** One token's position on the two plotted axes. */
export interface PlottedPoint {
  token: SpeechToken;
  x: number;
  y: number;
}

/** The tokens sharing one ellipse — the same grouping the plot draws by. */
export interface PointGroup {
  key: string;
  points: PlottedPoint[];
}

export interface EllipseOutlier {
  token: SpeechToken;
  /** Group whose ellipse the token falls outside ('' when the plot draws one ellipse). */
  group: string;
  /** Layer the token was drawn in; empty when only one layer is visible. */
  layer: string;
  x: number;
  y: number;
  /** Distance from the group mean, in SDs along each axis. */
  zX: number;
  zY: number;
  /** Mahalanobis distance from the group mean, in the ellipse's own SD units. */
  distance: number;
  /** The ellipse this token was judged against — layers can be set to different SDs. */
  sd: number;
  /** Which axis, and which way, the token is extreme on: `high F1; low F2`. */
  divergence: string;
}

export interface OutlierScan {
  outliers: EllipseOutlier[];
  /** Tokens that were tested (i.e. plotted, in a group big enough to have an ellipse). */
  checked: number;
  /** Groups with too few points to draw an ellipse, so nothing could be judged. */
  skipped: { key: string; count: number }[];
}

/** An ellipse needs a spread to be drawn at all; below this the group is skipped. */
const MIN_GROUP_SIZE = 3;

/** Axis names as they appear in the divergence column and CSV headers. */
export interface AxisNames { x: string; y: string; }

/**
 * Describe where a token sits relative to its group, most extreme axis first: an axis is
 * named when the token is beyond the threshold along it. A token can also fall outside
 * the ellipse without being extreme on either axis alone — a combination the ellipse's
 * tilt rules out — and is then named for whichever axis it deviates on most.
 */
const describeDivergence = (zX: number, zY: number, threshold: number, axes: AxisNames): string => {
  const parts = [
    { axis: axes.y, z: zY },
    { axis: axes.x, z: zX },
  ].sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const beyond = parts.filter(p => Math.abs(p.z) >= threshold);
  const named = beyond.length > 0 ? beyond : parts.slice(0, 1);
  return named.map(p => `${p.z > 0 ? 'high' : 'low'} ${p.axis}`).join('; ');
};

/**
 * Find every point outside its group's ellipse at `sd` standard deviations.
 * Groups are measured with the population covariance the plot draws with, so the result
 * matches the ellipse on screen exactly.
 */
export const findEllipseOutliers = (
  groups: PointGroup[], sd: number, axes: AxisNames, layer = '',
): OutlierScan => {
  const outliers: EllipseOutlier[] = [];
  const skipped: { key: string; count: number }[] = [];
  let checked = 0;

  for (const group of groups) {
    const pts = group.points;
    if (pts.length < MIN_GROUP_SIZE) {
      if (pts.length > 0) skipped.push({ key: group.key, count: pts.length });
      continue;
    }
    checked += pts.length;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my);
    }
    sxx /= n; syy /= n; sxy /= n;
    const det = sxx * syy - sxy * sxy;
    const sdX = Math.sqrt(sxx), sdY = Math.sqrt(syy);

    for (const p of pts) {
      const dx = p.x - mx, dy = p.y - my;
      // A degenerate cloud (collinear, or all one value) has no ellipse to be outside of;
      // fall back to the axis-wise distance so such groups still report something sane.
      const distance = det > 0
        ? Math.sqrt(Math.max(0, (syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / det))
        : Math.max(sdX > 0 ? Math.abs(dx) / sdX : 0, sdY > 0 ? Math.abs(dy) / sdY : 0);
      if (!(distance > sd)) continue;
      const zX = sdX > 0 ? dx / sdX : 0;
      const zY = sdY > 0 ? dy / sdY : 0;
      outliers.push({
        token: p.token, group: group.key === 'default' ? '' : group.key, layer,
        x: p.x, y: p.y, zX, zY, distance, sd,
        divergence: describeDivergence(zX, zY, sd, axes),
      });
    }
  }
  return { outliers, checked, skipped };
};

/**
 * The F1/F2 positions the plot is drawing, grouped as it groups them. Values carry the
 * layer's smoothing and the background layer's normalisation, and come from the same
 * nearest-timepoint sample the plot draws, so the numbers match what is on screen.
 */
export const collectFormantPoints = (
  tokens: SpeechToken[],
  config: PlotConfig,
  groupKeyOf: (token: SpeechToken) => string,
  normalization: NormalizationMethod,
  speakerStats: SpeakerStatsMap | null,
): PointGroup[] => {
  const byKey = new Map<string, PlottedPoint[]>();
  for (const t of tokens) {
    const time = findNearestTimePoint(t.trajectory, config.timePoint);
    const pt = time !== undefined ? t.trajectory.find(p => p.time === time) : undefined;
    if (!pt) continue;
    const stats = speakerStats?.[t.speaker || '__all__'];
    const rawF1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
    const rawF2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
    const f1 = normalizeFormant(rawF1, 'f1', normalization, stats);
    const f2 = normalizeFormant(rawF2, 'f2', normalization, stats);
    if (f1 === undefined || f2 === undefined || isNaN(f1) || isNaN(f2)) continue;
    const key = groupKeyOf(t);
    // X is F2 and Y is F1, as plotted
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ token: t, x: f2, y: f1 });
  }
  return Array.from(byKey, ([key, points]) => ({ key, points }));
};

/** Columns every outlier export carries, before the user's identifying fields. */
export interface OutlierCsvSpec {
  outliers: EllipseOutlier[];
  /** Field keys identifying each token, in the order the user chose them. */
  fields: { key: string; label: string }[];
  axes: AxisNames;
  /** True when more than one layer contributed, adding a Layer column. */
  multiLayer: boolean;
}

/** The distinct ellipse thresholds an export was taken at, ascending. */
export const outlierSdLevels = (outliers: EllipseOutlier[]): number[] =>
  Array.from(new Set(outliers.map(o => o.sd))).sort((a, b) => a - b);

/** Round for the CSV: enough precision to be useful, not enough to be noise. */
const num = (v: number, dp = 1): string => (Math.round(v * 10 ** dp) / 10 ** dp).toString();

/** Header row and body rows for an outlier export. */
export const buildOutlierRows = (spec: OutlierCsvSpec): { headers: string[]; rows: string[][] } => {
  const { axes, fields, multiLayer } = spec;
  // Layers can be set to different ellipses; when they are, each row says which one
  // judged it, so the file still means one thing.
  const mixedSd = outlierSdLevels(spec.outliers).length > 1;
  const headers = [
    ...(multiLayer ? ['layer'] : []),
    'group',
    ...fields.map(f => f.key),
    axes.y, axes.x,
    `${axes.y}_z`, `${axes.x}_z`,
    'sd_distance',
    ...(mixedSd ? ['ellipse_sd'] : []),
    'divergence',
  ];
  const rows = spec.outliers.map(o => [
    ...(multiLayer ? [o.layer] : []),
    o.group,
    ...fields.map(f => getLabel(o.token, f.key)),
    num(o.y), num(o.x),
    num(o.zY, 2), num(o.zX, 2),
    num(o.distance, 2),
    ...(mixedSd ? [String(o.sd)] : []),
    o.divergence,
  ]);
  return { headers, rows };
};

/** File name for an outlier export, e.g. `fred_outliers_2SD.csv`. */
export const outlierFileName = (sd: number): string =>
  `fred_outliers_${String(sd).replace('.', 'p')}SD.csv`;
