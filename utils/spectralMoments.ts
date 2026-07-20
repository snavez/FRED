import { SpeechToken, DatasetMeta, ColumnRole } from '../types';

/**
 * Spectral support for consonant analysis.
 *
 * Consonant datasets carry the four spectral moments — centre of gravity (COG),
 * standard deviation / spread (SD), skewness and kurtosis — in up to three forms,
 * all stored verbatim in `SpeechToken.fields`:
 *
 *  - **Point** — a moment sampled at a position in the segment: `COG_20%`, `SD_50%`.
 *  - **Track** — a dense trajectory over normalised time: `COG_t0` … `COG_t10`.
 *  - **Coefficient** — DCT/polynomial coefficients summarising a track's shape:
 *    `COG_k0` … `COG_k3` (k0 ≈ height, k1 ≈ slope, k2 ≈ curvature).
 *
 * The three forms are discovered and stored separately: a track is an ordered vector
 * per token, whereas points and coefficients are scalars. Grid lengths are always read
 * from the data — a dataset may carry any number of track samples or coefficients.
 *
 * This module insulates the UI from the exact column-naming scheme.
 */

export type SpectralMomentKey = 'COG' | 'SD' | 'skew' | 'kurt';

export interface SpectralMomentDef {
  key: SpectralMomentKey;
  /** Full descriptive label for axis titles and menus. */
  label: string;
  /** Short label for compact UI (axis ticks, chips). */
  short: string;
  /** Measurement unit ('Hz' for COG/SD, '' for the dimensionless higher moments). */
  unit: string;
}

/** Canonical definitions, in conventional moment order. */
export const SPECTRAL_MOMENT_DEFS: SpectralMomentDef[] = [
  { key: 'COG', label: 'Centre of Gravity', short: 'COG', unit: 'Hz' },
  { key: 'SD', label: 'Standard Deviation (spread)', short: 'SD', unit: 'Hz' },
  { key: 'skew', label: 'Skewness', short: 'Skew', unit: '' },
  { key: 'kurt', label: 'Kurtosis', short: 'Kurt', unit: '' },
];

const DEF_BY_KEY: Record<SpectralMomentKey, SpectralMomentDef> =
  Object.fromEntries(SPECTRAL_MOMENT_DEFS.map(d => [d.key, d])) as Record<SpectralMomentKey, SpectralMomentDef>;

/** Column-mapping roles that bind a CSV column to a specific spectral moment. */
export const SPECTRAL_ROLE_TO_MOMENT: Partial<Record<ColumnRole, SpectralMomentKey>> = {
  spectral_cog: 'COG',
  spectral_sd: 'SD',
  spectral_skew: 'skew',
  spectral_kurt: 'kurt',
};

export const isSpectralRole = (role: ColumnRole): boolean => role in SPECTRAL_ROLE_TO_MOMENT;

/**
 * Which form of measurement a spectral column holds. `point` and `coeff` are scalars;
 * `track` columns combine into one ordered vector per token.
 */
export type SpectralKind = 'point' | 'track' | 'coeff';

export interface SpectralColumnRef {
  kind: SpectralKind;
  /** Timepoint (point), sample index (track), or coefficient order (coeff). */
  index: number;
  /** Column name with the suffix stripped — the family this column belongs to. */
  base: string;
}

/** Trailing `_<timepoint>[%][_smooth]` suffix, e.g. `_20%`, `_50`, `_80%_smooth`. */
const TIMEPOINT_SUFFIX_REGEX = /_(\d+(?:\.\d+)?)\s*%?(?:_smooth)?$/;
/** Trailing track-sample suffix, e.g. `_t0`, `_t10`. */
const TRACK_SUFFIX_REGEX = /_t(\d+)$/i;
/** Trailing coefficient suffix, e.g. `_k0`, `_k3`. */
const COEFF_SUFFIX_REGEX = /_k(\d+)$/i;

/**
 * Classify a spectral column by its name suffix. Track and coefficient suffixes are
 * tested first — `_t0`/`_k0` must not be read as timepoints. A name with no recognised
 * suffix is a single point measurement at the segment midpoint.
 */
export const parseSpectralColumn = (columnName: string): SpectralColumnRef => {
  const track = columnName.match(TRACK_SUFFIX_REGEX);
  if (track) return { kind: 'track', index: parseInt(track[1], 10), base: columnName.slice(0, track.index) };
  const coeff = columnName.match(COEFF_SUFFIX_REGEX);
  if (coeff) return { kind: 'coeff', index: parseInt(coeff[1], 10), base: columnName.slice(0, coeff.index) };
  const point = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  if (point) return { kind: 'point', index: parseFloat(point[1]), base: columnName.slice(0, point.index) };
  return { kind: 'point', index: 50, base: columnName };
};

/** Parse the timepoint suffix from a column name, or null when there is none. */
export const parseSpectralTimePointSuffix = (columnName: string): number | null => {
  const match = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  return match ? parseFloat(match[1]) : null;
};

/** Base name of a spectral column with any measurement suffix stripped (`COG_20%` → `COG`). */
export const spectralColumnBaseName = (columnName: string): string =>
  parseSpectralColumn(columnName).base;

/**
 * Timepoint for a spectral-role column: parsed from the header suffix when present,
 * otherwise the segment midpoint (50%) — a bare `COG` column is a single measurement.
 */
export const spectralRoleTimePoint = (columnName: string): number =>
  parseSpectralTimePointSuffix(columnName) ?? 50;

/** Compact chip label for a column in the mapping dialog: `50%`, `t3`, `k1`. */
export const spectralColumnChip = (columnName: string): string => {
  const ref = parseSpectralColumn(columnName);
  return ref.kind === 'track' ? `t${ref.index}` : ref.kind === 'coeff' ? `k${ref.index}` : `${ref.index}%`;
};

/** Conventional interpretation of the low-order DCT coefficients. */
const COEFF_MEANINGS = ['height', 'slope', 'curvature'];
export const coefficientMeaning = (index: number): string => COEFF_MEANINGS[index] ?? '';
export const coefficientLabel = (index: number): string => {
  const meaning = coefficientMeaning(index);
  return meaning ? `k${index} (${meaning})` : `k${index}`;
};

/** Map a header token (case-insensitive) to a canonical moment key, or null. */
const canonicalMoment = (raw: string): SpectralMomentKey | null => {
  const s = raw.toLowerCase();
  if (s === 'cog' || s === 'centroid' || s === 'centreofgravity' || s === 'centerofgravity') return 'COG';
  if (s === 'sd' || s === 'stdev' || s === 'std' || s === 'spread' || s === 'sdev') return 'SD';
  if (s === 'skew' || s === 'skewness') return 'skew';
  if (s === 'kurt' || s === 'kurtosis' || s === 'kurts') return 'kurt';
  return null;
};

export const getSpectralMomentDef = (key: SpectralMomentKey): SpectralMomentDef => DEF_BY_KEY[key];

export interface SpectralMomentMeta {
  /** Moments present as point measurements, in canonical order. */
  moments: SpectralMomentDef[];
  /** Distinct point timepoints present (sorted ascending), e.g. [20, 50, 80]. */
  timePoints: number[];
  /** Whether any spectral column of any kind was found. */
  available: boolean;
  /** Resolver from `${moment}@${timePoint}` to the field key in token.fields. */
  keyMap: Record<string, string>;

  /** Moments carrying a normalised-time track, in canonical order. */
  trackMoments: SpectralMomentDef[];
  /** Track sample indices present (sorted ascending), e.g. [0…10]. Length is data-driven. */
  trackIndices: number[];
  /** Resolver from `${moment}~t${index}` to the field key. */
  trackKeyMap: Record<string, string>;

  /** Moments carrying DCT/polynomial coefficients, in canonical order. */
  coeffMoments: SpectralMomentDef[];
  /** Coefficient orders present (sorted ascending), e.g. [0…3]. Length is data-driven. */
  coeffIndices: number[];
  /** Resolver from `${moment}~k${index}` to the field key. */
  coeffKeyMap: Record<string, string>;
}

const slot = (moment: SpectralMomentKey, timePoint: number) => `${moment}@${timePoint}`;
const trackSlot = (moment: SpectralMomentKey, index: number) => `${moment}~t${index}`;
const coeffSlot = (moment: SpectralMomentKey, index: number) => `${moment}~k${index}`;

/** Collect candidate field keys from dataset meta (preferred) or a sample of tokens. */
const collectFieldKeys = (tokens: SpeechToken[], meta: DatasetMeta | null): string[] => {
  const keys = new Set<string>();
  if (meta) {
    for (const m of meta.columnMappings) {
      if (m.role === 'field' || m.role === 'pitch' || m.role === 'duration') {
        keys.add(m.fieldName || m.csvHeader);
      }
    }
  }
  // Union with actual token fields as a safety net (covers any keys meta missed).
  const sample = tokens.slice(0, 20);
  for (const t of sample) {
    for (const k of Object.keys(t.fields)) keys.add(k);
  }
  return Array.from(keys);
};

/**
 * Discover which spectral moments and timepoints are present in the dataset.
 * Builds a resolver so callers can fetch values without re-parsing header schemes.
 *
 * Columns explicitly mapped to a spectral role (Spectral COG / Diffusion / Skew /
 * Kurtosis in the Data Mapping dialog) are authoritative and are claimed first, so
 * users can name their columns anything. The header-pattern scan then fills any
 * remaining slots (legacy datasets, conventionally-named extra columns).
 */
export const discoverSpectralMoments = (
  tokens: SpeechToken[],
  meta: DatasetMeta | null = null,
): SpectralMomentMeta => {
  const keyMap: Record<string, string> = {};
  const trackKeyMap: Record<string, string> = {};
  const coeffKeyMap: Record<string, string> = {};
  const momentSet = new Set<SpectralMomentKey>();
  const trackSet = new Set<SpectralMomentKey>();
  const coeffSet = new Set<SpectralMomentKey>();
  const timeSet = new Set<number>();
  const trackIdxSet = new Set<number>();
  const coeffIdxSet = new Set<number>();

  /** Record one column against the right bucket. First key wins for a given slot. */
  const claim = (moment: SpectralMomentKey, fieldKey: string) => {
    const ref = parseSpectralColumn(fieldKey);
    if (ref.kind === 'track') {
      trackSet.add(moment); trackIdxSet.add(ref.index);
      const s = trackSlot(moment, ref.index);
      if (!(s in trackKeyMap)) trackKeyMap[s] = fieldKey;
    } else if (ref.kind === 'coeff') {
      coeffSet.add(moment); coeffIdxSet.add(ref.index);
      const s = coeffSlot(moment, ref.index);
      if (!(s in coeffKeyMap)) coeffKeyMap[s] = fieldKey;
    } else {
      momentSet.add(moment); timeSet.add(ref.index);
      const s = slot(moment, ref.index);
      if (!(s in keyMap)) keyMap[s] = fieldKey;
    }
  };

  // Explicit role mappings are authoritative — claimed before the header scan.
  if (meta) {
    for (const m of meta.columnMappings) {
      const moment = SPECTRAL_ROLE_TO_MOMENT[m.role];
      if (!moment) continue;
      const fieldKey = m.fieldName || m.csvHeader;
      if (fieldKey) claim(moment, fieldKey);
    }
  }

  // Header-pattern scan fills any remaining slots (legacy / unmapped datasets).
  // The base name — whatever precedes the suffix — must itself be a moment synonym,
  // so `winms_20%` and `nsamples_20%` are correctly left alone.
  for (const fieldKey of collectFieldKeys(tokens, meta)) {
    const moment = canonicalMoment(parseSpectralColumn(fieldKey).base);
    if (moment) claim(moment, fieldKey);
  }

  const byOrder = (set: Set<SpectralMomentKey>) => SPECTRAL_MOMENT_DEFS.filter(d => set.has(d.key));
  const sorted = (set: Set<number>) => Array.from(set).sort((a, b) => a - b);
  const moments = byOrder(momentSet);
  const trackMoments = byOrder(trackSet);
  const coeffMoments = byOrder(coeffSet);
  return {
    moments, timePoints: sorted(timeSet), keyMap,
    trackMoments, trackIndices: sorted(trackIdxSet), trackKeyMap,
    coeffMoments, coeffIndices: sorted(coeffIdxSet), coeffKeyMap,
    available: moments.length > 0 || trackMoments.length > 0 || coeffMoments.length > 0,
  };
};

/**
 * Extract a numeric spectral-moment value for a token at a timepoint.
 * Returns NaN when the moment/timepoint is absent or the stored value is non-numeric.
 */
export const getSpectralValue = (
  token: SpeechToken,
  meta: SpectralMomentMeta,
  moment: SpectralMomentKey,
  timePoint: number,
): number => {
  const key = meta.keyMap[slot(moment, timePoint)];
  if (!key) return NaN;
  const raw = token.fields[key];
  if (raw === undefined || raw === '') return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
};

/** Read a numeric value from a resolved field key. */
const readValue = (token: SpeechToken, key: string | undefined): number => {
  if (!key) return NaN;
  const raw = token.fields[key];
  if (raw === undefined || raw === '') return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
};

/** One DCT/polynomial coefficient for a token. NaN when absent or non-numeric. */
export const getSpectralCoeffValue = (
  token: SpeechToken, meta: SpectralMomentMeta, moment: SpectralMomentKey, index: number,
): number => readValue(token, meta.coeffKeyMap[coeffSlot(moment, index)]);

/** One track sample for a token. NaN when absent or non-numeric. */
export const getSpectralTrackValue = (
  token: SpeechToken, meta: SpectralMomentMeta, moment: SpectralMomentKey, index: number,
): number => readValue(token, meta.trackKeyMap[trackSlot(moment, index)]);

/**
 * A token's whole track for a moment, in grid order (`meta.trackIndices`).
 * Missing samples come back as NaN so callers can align tracks pointwise.
 */
export const getSpectralTrack = (
  token: SpeechToken, meta: SpectralMomentMeta, moment: SpectralMomentKey,
): number[] => meta.trackIndices.map(i => getSpectralTrackValue(token, meta, moment, i));

/** Nearest available timepoint to a target (for graceful fallback when 50 is absent). */
export const nearestSpectralTimePoint = (meta: SpectralMomentMeta, target: number): number | undefined => {
  if (meta.timePoints.length === 0) return undefined;
  return meta.timePoints.reduce((best, tp) =>
    Math.abs(tp - target) < Math.abs(best - target) ? tp : best, meta.timePoints[0]);
};

/** Axis/menu label for a moment, optionally with unit and timepoint. */
export const spectralAxisLabel = (moment: SpectralMomentKey, timePoint?: number): string => {
  const def = DEF_BY_KEY[moment];
  const base = def.unit ? `${def.label} (${def.unit})` : def.label;
  return timePoint === undefined ? base : `${base} @ ${timePoint}%`;
};

// ─── Features: any scalar a token can be plotted by ────────────────────────

/**
 * A scalar measurement selectable on an axis. Any of the three column kinds becomes a
 * scalar once an index is fixed: a moment at a timepoint (`COG@50`), one track sample
 * (`COG~t3`), or a shape coefficient (`COG~k1`). A track is only a *vector* when swept,
 * which is what trajectory and contour modes do.
 */
export interface SpectralFeature {
  moment: SpectralMomentKey;
  kind: SpectralKind;
  index: number;
}

/** Stable string form stored in PlotConfig, e.g. `COG@50`, `COG~t3` or `COG~k1`. */
export const formatSpectralFeature = (f: SpectralFeature): string =>
  f.kind === 'point' ? `${f.moment}@${f.index}`
    : f.kind === 'track' ? `${f.moment}~t${f.index}`
    : `${f.moment}~k${f.index}`;

/** Parse a feature ref; returns null when malformed. */
export const parseSpectralFeature = (ref: string): SpectralFeature | null => {
  const suffixed = ref.match(/^(\w+)~([tk])(\d+)$/);
  if (suffixed) return {
    moment: suffixed[1] as SpectralMomentKey,
    kind: suffixed[2] === 't' ? 'track' : 'coeff',
    index: parseInt(suffixed[3], 10),
  };
  const point = ref.match(/^(\w+)@(\d+(?:\.\d+)?)$/);
  if (point) return { moment: point[1] as SpectralMomentKey, kind: 'point', index: parseFloat(point[2]) };
  return null;
};

/** Whether the dataset actually holds the column behind a feature. */
export const hasSpectralFeature = (meta: SpectralMomentMeta, f: SpectralFeature): boolean =>
  f.kind === 'point' ? !!meta.keyMap[slot(f.moment, f.index)]
    : f.kind === 'track' ? !!meta.trackKeyMap[trackSlot(f.moment, f.index)]
    : !!meta.coeffKeyMap[coeffSlot(f.moment, f.index)];

/** Moments offering a given kind, in canonical order. */
export const spectralMomentsOfKind = (meta: SpectralMomentMeta, kind: SpectralKind): SpectralMomentDef[] =>
  kind === 'point' ? meta.moments : kind === 'track' ? meta.trackMoments : meta.coeffMoments;

/** Positions available for a kind: timepoints, track samples, or coefficient orders. */
export const spectralIndicesOfKind = (meta: SpectralMomentMeta, kind: SpectralKind): number[] =>
  kind === 'point' ? meta.timePoints : kind === 'track' ? meta.trackIndices : meta.coeffIndices;

/** Every feature the dataset offers: points, then track samples, then coefficients. */
export const listSpectralFeatures = (meta: SpectralMomentMeta): SpectralFeature[] => {
  const out: SpectralFeature[] = [];
  const kinds: SpectralKind[] = ['point', 'track', 'coeff'];
  for (const kind of kinds) {
    for (const m of spectralMomentsOfKind(meta, kind)) {
      for (const i of spectralIndicesOfKind(meta, kind)) {
        const f: SpectralFeature = { moment: m.key, kind, index: i };
        if (hasSpectralFeature(meta, f)) out.push(f);
      }
    }
  }
  return out;
};

/**
 * Resolve a stored feature ref against the dataset, falling back to the first
 * available feature when the ref is missing or refers to an absent column.
 */
export const resolveSpectralFeature = (
  ref: string, meta: SpectralMomentMeta, fallbackIndex = 0,
): SpectralFeature | null => {
  const all = listSpectralFeatures(meta);
  if (all.length === 0) return null;
  const parsed = parseSpectralFeature(ref);
  const found = parsed && all.find(f =>
    f.moment === parsed.moment && f.kind === parsed.kind && f.index === parsed.index);
  return found ?? all[Math.min(fallbackIndex, all.length - 1)];
};

/** Value of a feature for a token. NaN when absent. */
export const getSpectralFeatureValue = (
  token: SpeechToken, meta: SpectralMomentMeta, f: SpectralFeature,
): number => f.kind === 'point' ? getSpectralValue(token, meta, f.moment, f.index)
  : f.kind === 'track' ? getSpectralTrackValue(token, meta, f.moment, f.index)
  : getSpectralCoeffValue(token, meta, f.moment, f.index);

/** Compact menu label, e.g. `COG @50%`, `COG t3` or `COG k1 (slope)`. */
export const spectralFeatureLabel = (f: SpectralFeature): string => {
  const def = DEF_BY_KEY[f.moment];
  const short = def ? def.short : f.moment;
  return f.kind === 'point' ? `${short} @${f.index}%`
    : f.kind === 'track' ? `${short} t${f.index}`
    : `${short} ${coefficientLabel(f.index)}`;
};

/** Full axis label, e.g. `Centre of Gravity (Hz) @ 50%` or `Centre of Gravity — k1 (slope)`. */
export const spectralFeatureAxisLabel = (f: SpectralFeature, flipped = false): string => {
  const def = DEF_BY_KEY[f.moment];
  const base = def ? def.label : f.moment;
  if (f.kind === 'point') return spectralAxisLabel(f.moment, f.index);
  if (f.kind === 'track') {
    const unit = def?.unit ? ` (${def.unit})` : '';
    return `${base}${unit} — track t${f.index}`;
  }
  return `${base} — ${coefficientLabel(f.index)}${flipped ? ', sign-flipped' : ''}`;
};

/** Human name for a column kind, used in the Data selector. */
export const spectralKindLabel = (kind: SpectralKind): string =>
  kind === 'point' ? 'Moments' : kind === 'track' ? 'Track' : 'Coefficients';

/** Label for one position within a kind: `50%`, `t3`, `k1 (slope)`. */
export const spectralIndexLabel = (kind: SpectralKind, index: number): string =>
  kind === 'point' ? `${index}%` : kind === 'track' ? `t${index}` : coefficientLabel(index);
