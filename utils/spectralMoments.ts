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
 * A column may also name the **region** of the segment it measures, between the moment
 * and the position: `COG_closure_20%`, `SD_release_t3`. Regions are free text taken from
 * the header, so a dataset can split a stop into closure and release, a fricative into
 * onset and offset, or carry no region at all. Every measurement is therefore addressed
 * by moment × region × kind × position, and closure never shares a slot with release.
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

export const getSpectralMomentDef = (key: SpectralMomentKey): SpectralMomentDef => DEF_BY_KEY[key];

/** Column-mapping roles that bind a CSV column to a specific spectral moment. */
export const SPECTRAL_ROLE_TO_MOMENT: Partial<Record<ColumnRole, SpectralMomentKey>> = {
  spectral_cog: 'COG',
  spectral_sd: 'SD',
  spectral_skew: 'skew',
  spectral_kurt: 'kurt',
};

const MOMENT_TO_ROLE: Record<SpectralMomentKey, ColumnRole> = {
  COG: 'spectral_cog', SD: 'spectral_sd', skew: 'spectral_skew', kurt: 'spectral_kurt',
};

export const isSpectralRole = (role: ColumnRole): boolean => role in SPECTRAL_ROLE_TO_MOMENT;

/**
 * Header spellings for each moment, matched case-insensitively with underscores removed
 * so `centre_of_gravity` and `centreOfGravity` both resolve. This table is the single
 * place that decides whether a name spells a spectral moment — CSV auto-detection and
 * the dataset scan both go through it.
 */
const MOMENT_SYNONYMS: Record<string, SpectralMomentKey> = {
  cog: 'COG', centroid: 'COG', centerofgravity: 'COG', centreofgravity: 'COG',
  sd: 'SD', stdev: 'SD', std: 'SD', sdev: 'SD', spread: 'SD', specdiff: 'SD', diffusion: 'SD',
  skew: 'skew', skewness: 'skew',
  kurt: 'kurt', kurtosis: 'kurt', kurts: 'kurt',
};

/** Map a header token (case-insensitive) to a canonical moment key, or null. */
const canonicalMoment = (raw: string): SpectralMomentKey | null =>
  MOMENT_SYNONYMS[raw.toLowerCase().replace(/_/g, '')] ?? null;

/**
 * Which form of measurement a spectral column holds. `point` and `coeff` are scalars;
 * `track` columns combine into one ordered vector per token.
 */
export type SpectralKind = 'point' | 'track' | 'coeff';

export interface SpectralColumnRef {
  kind: SpectralKind;
  /** Timepoint (point), sample index (track), or coefficient order (coeff). */
  index: number;
  /** Column name with the position suffix stripped, e.g. `COG_closure`. */
  base: string;
  /** Moment named by the head of the base name, or null when it names none. */
  moment: SpectralMomentKey | null;
  /** Region label between moment and position (`closure`), '' when there is none. */
  region: string;
}

/** Trailing `_<timepoint>[%][_smooth]` suffix, e.g. `_20%`, `_50`, `_80%_smooth`. */
const TIMEPOINT_SUFFIX_REGEX = /_(\d+(?:\.\d+)?)\s*%?(?:_smooth)?$/;
/** Trailing track-sample suffix, e.g. `_t0`, `_t10`. */
const TRACK_SUFFIX_REGEX = /_t(\d+)$/i;
/** Trailing coefficient suffix, e.g. `_k0`, `_k3`. */
const COEFF_SUFFIX_REGEX = /_k(\d+)$/i;

/** Reserved by the slot and feature-ref encodings, so a region may not contain them. */
const sanitizeRegion = (region: string): string => region.replace(/[|:@~]/g, '_');

/**
 * Split a base name into the moment it names and the region label that follows.
 * The longest leading run of parts that spells a moment wins, so `centre_of_gravity_burst`
 * reads as COG in the burst region. A base whose head names no moment has no region: a
 * hand-mapped column such as `sibilance_centre` is one measurement, not a region of one.
 */
const splitMomentAndRegion = (base: string): { moment: SpectralMomentKey | null; region: string } => {
  const parts = base.split('_').filter(p => p !== '');
  for (let i = Math.min(parts.length, 4); i >= 1; i--) {
    const moment = canonicalMoment(parts.slice(0, i).join(''));
    if (moment) return { moment, region: sanitizeRegion(parts.slice(i).join('_')) };
  }
  return { moment: null, region: '' };
};

/**
 * Classify a spectral column by its name. Track and coefficient suffixes are tested
 * first — `_t0`/`_k0` must not be read as timepoints. A name with no recognised suffix
 * is a single point measurement at the segment midpoint.
 */
export const parseSpectralColumn = (columnName: string): SpectralColumnRef => {
  const ref = (kind: SpectralKind, index: number, base: string): SpectralColumnRef =>
    ({ kind, index, base, ...splitMomentAndRegion(base) });
  const track = columnName.match(TRACK_SUFFIX_REGEX);
  if (track) return ref('track', parseInt(track[1], 10), columnName.slice(0, track.index));
  const coeff = columnName.match(COEFF_SUFFIX_REGEX);
  if (coeff) return ref('coeff', parseInt(coeff[1], 10), columnName.slice(0, coeff.index));
  const point = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  if (point) return ref('point', parseFloat(point[1]), columnName.slice(0, point.index));
  return ref('point', 50, columnName);
};

/**
 * The spectral role a CSV header implies, or null when the header names no moment.
 * Drives auto-detection in the mapping dialog; users can override it there.
 */
export const detectSpectralRole = (columnName: string): ColumnRole | null => {
  const moment = parseSpectralColumn(columnName).moment;
  return moment ? MOMENT_TO_ROLE[moment] : null;
};

/** Parse the timepoint suffix from a column name, or null when there is none. */
export const parseSpectralTimePointSuffix = (columnName: string): number | null => {
  const match = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  return match ? parseFloat(match[1]) : null;
};

/** Base name of a spectral column with any measurement suffix stripped (`COG_20%` → `COG`). */
export const spectralColumnBaseName = (columnName: string): string =>
  parseSpectralColumn(columnName).base;

/** Region label carried by a column name (`COG_closure_20%` → `closure`), '' when none. */
export const spectralColumnRegion = (columnName: string): string =>
  parseSpectralColumn(columnName).region;

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

// ─── Dataset discovery ────────────────────────────────────────────────────

/** One spectral measurement the dataset holds, and the token field carrying it. */
export interface SpectralColumn {
  moment: SpectralMomentKey;
  kind: SpectralKind;
  /** Timepoint (point), sample index (track), or coefficient order (coeff). */
  index: number;
  /** Region of the segment measured; '' when the column carries no region label. */
  region: string;
  /** Key into `SpeechToken.fields`. */
  fieldKey: string;
}

export interface SpectralMomentMeta {
  /** Every spectral measurement found, in discovery order. */
  columns: SpectralColumn[];
  /** Distinct region labels, in the order the dataset presents them. */
  regions: string[];
  /** Whether any spectral column of any kind was found. */
  available: boolean;
  /** Slot key → field key; the resolver behind every value read. */
  keyMap: Record<string, string>;
}

const slotKey = (region: string, moment: SpectralMomentKey, kind: SpectralKind, index: number) =>
  `${region}|${moment}|${kind}|${index}`;

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
 * Discover which spectral measurements the dataset holds, keyed by moment, region, kind
 * and position. Builds a resolver so callers fetch values without re-parsing header
 * schemes.
 *
 * Columns explicitly mapped to a spectral role (Spectral COG / SD / Skew / Kurtosis in
 * the Data Mapping dialog) are authoritative and are claimed first, so users can name
 * their columns anything; a mapping's `spectralRegion` overrides the region read from
 * the header. The header-pattern scan then fills any remaining slots (legacy datasets,
 * conventionally-named extra columns).
 */
export const discoverSpectralMoments = (
  tokens: SpeechToken[],
  meta: DatasetMeta | null = null,
): SpectralMomentMeta => {
  const columns: SpectralColumn[] = [];
  const keyMap: Record<string, string> = {};
  const regions: string[] = [];

  /** Record one column. The first claim on a slot wins. */
  const claim = (moment: SpectralMomentKey, fieldKey: string, regionOverride?: string) => {
    const ref = parseSpectralColumn(fieldKey);
    const region = sanitizeRegion(regionOverride ?? ref.region);
    const slot = slotKey(region, moment, ref.kind, ref.index);
    if (slot in keyMap) return;
    keyMap[slot] = fieldKey;
    columns.push({ moment, kind: ref.kind, index: ref.index, region, fieldKey });
    if (!regions.includes(region)) regions.push(region);
  };

  // Explicit role mappings are authoritative — claimed before the header scan.
  if (meta) {
    for (const m of meta.columnMappings) {
      const moment = SPECTRAL_ROLE_TO_MOMENT[m.role];
      if (!moment) continue;
      const fieldKey = m.fieldName || m.csvHeader;
      if (fieldKey) claim(moment, fieldKey, m.spectralRegion);
    }
  }

  // Header-pattern scan fills any remaining slots (legacy / unmapped datasets).
  // The head of the name must itself spell a moment, so `winms_closure_20%` and
  // `nsamples_20%` are correctly left alone.
  for (const fieldKey of collectFieldKeys(tokens, meta)) {
    const moment = parseSpectralColumn(fieldKey).moment;
    if (moment) claim(moment, fieldKey);
  }

  return { columns, regions, keyMap, available: columns.length > 0 };
};

// ─── Querying what the dataset offers ─────────────────────────────────────

/** Columns of one kind, optionally restricted to a region. */
const columnsOfKind = (meta: SpectralMomentMeta, kind: SpectralKind, region?: string): SpectralColumn[] =>
  meta.columns.filter(c => c.kind === kind && (region === undefined || c.region === region));

/** Moments offering a given kind (within a region when given), in canonical order. */
export const spectralMomentsOfKind = (
  meta: SpectralMomentMeta, kind: SpectralKind, region?: string,
): SpectralMomentDef[] => {
  const present = new Set(columnsOfKind(meta, kind, region).map(c => c.moment));
  return SPECTRAL_MOMENT_DEFS.filter(d => present.has(d.key));
};

/** Positions available for a kind: timepoints, track samples, or coefficient orders. */
export const spectralIndicesOfKind = (
  meta: SpectralMomentMeta, kind: SpectralKind, region?: string,
): number[] =>
  Array.from(new Set(columnsOfKind(meta, kind, region).map(c => c.index))).sort((a, b) => a - b);

/** Kinds the dataset carries (within a region when given), in display order. */
export const spectralKindsAvailable = (meta: SpectralMomentMeta, region?: string): SpectralKind[] =>
  (['point', 'track', 'coeff'] as SpectralKind[]).filter(k => columnsOfKind(meta, k, region).length > 0);

/** Regions carrying a given measurement family — which phases of the segment have it. */
export const spectralRegionsOfKind = (
  meta: SpectralMomentMeta, kind: SpectralKind, moment?: SpectralMomentKey,
): string[] => meta.regions.filter(r =>
  meta.columns.some(c => c.region === r && c.kind === kind && (moment === undefined || c.moment === moment)));

/** Whether the dataset labels any spectral column by region. */
export const hasSpectralRegions = (meta: SpectralMomentMeta): boolean =>
  meta.regions.some(r => r !== '');

/** Display text for a region in menus; unlabelled columns read as "whole segment". */
export const spectralRegionLabel = (region: string): string => region || 'whole segment';

// ─── Features: any scalar a token can be plotted by ────────────────────────

/**
 * A scalar measurement selectable on an axis. Any of the three column kinds becomes a
 * scalar once an index is fixed: a moment at a timepoint (`COG@50`), one track sample
 * (`COG~t3`), or a shape coefficient (`COG~k1`). A track is only a *vector* when swept,
 * which is what trajectory and contour modes do. `region` names the phase of the segment
 * measured, and is omitted for datasets whose columns carry no region label.
 */
export interface SpectralFeature {
  moment: SpectralMomentKey;
  kind: SpectralKind;
  index: number;
  region?: string;
}

const featureRegion = (f: SpectralFeature): string => f.region ?? '';

/** The same measurement at another position on its grid — one step of a sweep. */
export const spectralFeatureAt = (f: SpectralFeature, index: number): SpectralFeature =>
  ({ ...f, index });

/**
 * Stable string form stored in PlotConfig: `COG@50`, `COG~t3`, `COG~k1`, with the region
 * prefixed when there is one — `closure:COG@50`. Region-less refs keep the older bare
 * form, so configs saved before regions existed still resolve.
 */
export const formatSpectralFeature = (f: SpectralFeature): string => {
  const body = f.kind === 'point' ? `${f.moment}@${f.index}`
    : f.kind === 'track' ? `${f.moment}~t${f.index}`
    : `${f.moment}~k${f.index}`;
  return featureRegion(f) ? `${featureRegion(f)}:${body}` : body;
};

/** Parse a feature ref; returns null when malformed. */
export const parseSpectralFeature = (ref: string): SpectralFeature | null => {
  const colon = ref.indexOf(':');
  const region = colon >= 0 ? ref.slice(0, colon) : '';
  const body = colon >= 0 ? ref.slice(colon + 1) : ref;
  const suffixed = body.match(/^(\w+)~([tk])(\d+)$/);
  if (suffixed) return {
    moment: suffixed[1] as SpectralMomentKey,
    kind: suffixed[2] === 't' ? 'track' : 'coeff',
    index: parseInt(suffixed[3], 10),
    region,
  };
  const point = body.match(/^(\w+)@(\d+(?:\.\d+)?)$/);
  if (point) return { moment: point[1] as SpectralMomentKey, kind: 'point', index: parseFloat(point[2]), region };
  return null;
};

/** Stable ref for a measurement family — a moment in a region, e.g. `closure:COG`. */
export const formatSpectralMomentRef = (moment: SpectralMomentKey, region: string): string =>
  region ? `${region}:${moment}` : moment;

/** Parse a family ref written by `formatSpectralMomentRef`. */
export const parseSpectralMomentRef = (ref: string): { moment: SpectralMomentKey; region: string } => {
  const colon = ref.indexOf(':');
  return colon >= 0
    ? { moment: ref.slice(colon + 1) as SpectralMomentKey, region: ref.slice(0, colon) }
    : { moment: ref as SpectralMomentKey, region: '' };
};

/** Whether the dataset actually holds the column behind a feature. */
export const hasSpectralFeature = (meta: SpectralMomentMeta, f: SpectralFeature): boolean =>
  !!meta.keyMap[slotKey(featureRegion(f), f.moment, f.kind, f.index)];

/**
 * Every feature the dataset offers — points, then track samples, then coefficients —
 * restricted to one region when given.
 */
export const listSpectralFeatures = (meta: SpectralMomentMeta, region?: string): SpectralFeature[] => {
  const kinds: SpectralKind[] = ['point', 'track', 'coeff'];
  const out: SpectralFeature[] = [];
  for (const kind of kinds) {
    for (const r of (region === undefined ? meta.regions : [region])) {
      for (const m of spectralMomentsOfKind(meta, kind, r)) {
        for (const i of spectralIndicesOfKind(meta, kind, r)) {
          const f: SpectralFeature = { moment: m.key, kind, index: i, region: r };
          if (hasSpectralFeature(meta, f)) out.push(f);
        }
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
  const parsed = parseSpectralFeature(ref);
  if (parsed && hasSpectralFeature(meta, parsed)) return parsed;
  const all = listSpectralFeatures(meta);
  if (all.length === 0) return null;
  return all[Math.min(fallbackIndex, all.length - 1)];
};

/**
 * The measurement to put on the second axis beside `x`: another moment in the same
 * region at the same position — the classic COG × SD pairing — or another coefficient
 * order when x is a coefficient.
 */
const partnerFeature = (x: SpectralFeature, meta: SpectralMomentMeta): SpectralFeature => {
  const region = featureRegion(x);
  if (x.kind === 'coeff') {
    const indices = spectralIndicesOfKind(meta, 'coeff', region);
    return { ...x, index: indices.find(i => i !== x.index) ?? x.index };
  }
  const moments = spectralMomentsOfKind(meta, x.kind, region);
  return { ...x, moment: (moments.find(m => m.key !== x.moment) ?? moments[0])?.key ?? x.moment };
};

/**
 * Resolve a pair of scatter axis refs together. Refs the dataset holds are kept as
 * stored; an unusable X falls back to the dataset's first feature, and an unusable Y to
 * the partner of X, so the pair always names two real columns of the same kind. Every
 * caller — plot and controls alike — resolves through here, so what the axis menus show
 * is what the plot draws.
 */
export const resolveSpectralAxes = (
  xRef: string, yRef: string, meta: SpectralMomentMeta,
): { x: SpectralFeature | null; y: SpectralFeature | null } => {
  const x = resolveSpectralFeature(xRef, meta, 0);
  if (!x) return { x: null, y: null };
  const storedY = parseSpectralFeature(yRef);
  return { x, y: (storedY && hasSpectralFeature(meta, storedY)) ? storedY : partnerFeature(x, meta) };
};

// ─── Reading values ───────────────────────────────────────────────────────

/** Read a numeric value from a resolved field key. */
const readValue = (token: SpeechToken, key: string | undefined): number => {
  if (!key) return NaN;
  const raw = token.fields[key];
  if (raw === undefined || raw === '') return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
};

/** Value of a feature for a token. NaN when the column is absent or non-numeric. */
export const getSpectralFeatureValue = (
  token: SpeechToken, meta: SpectralMomentMeta, f: SpectralFeature,
): number => readValue(token, meta.keyMap[slotKey(featureRegion(f), f.moment, f.kind, f.index)]);

/** One point measurement: a moment at a timepoint, within a region. */
export const getSpectralValue = (
  token: SpeechToken, meta: SpectralMomentMeta,
  moment: SpectralMomentKey, timePoint: number, region = '',
): number => getSpectralFeatureValue(token, meta, { moment, kind: 'point', index: timePoint, region });

/** One DCT/polynomial coefficient for a token. */
export const getSpectralCoeffValue = (
  token: SpeechToken, meta: SpectralMomentMeta,
  moment: SpectralMomentKey, index: number, region = '',
): number => getSpectralFeatureValue(token, meta, { moment, kind: 'coeff', index, region });

/** One track sample for a token. */
export const getSpectralTrackValue = (
  token: SpeechToken, meta: SpectralMomentMeta,
  moment: SpectralMomentKey, index: number, region = '',
): number => getSpectralFeatureValue(token, meta, { moment, kind: 'track', index, region });

/**
 * A token's whole track for a moment, in grid order.
 * Missing samples come back as NaN so callers can align tracks pointwise.
 */
export const getSpectralTrack = (
  token: SpeechToken, meta: SpectralMomentMeta, moment: SpectralMomentKey, region = '',
): number[] => spectralIndicesOfKind(meta, 'track', region)
  .map(i => getSpectralTrackValue(token, meta, moment, i, region));

/** Nearest available timepoint to a target (for graceful fallback when 50 is absent). */
export const nearestSpectralTimePoint = (
  meta: SpectralMomentMeta, target: number, region?: string,
): number | undefined => {
  const points = spectralIndicesOfKind(meta, 'point', region);
  if (points.length === 0) return undefined;
  return points.reduce((best, tp) => Math.abs(tp - target) < Math.abs(best - target) ? tp : best, points[0]);
};

// ─── Labels ───────────────────────────────────────────────────────────────

/** Trailing region qualifier for a label, empty for region-less datasets. */
const regionSuffix = (region: string): string => region ? ` · ${region}` : '';

/** Axis/menu label for a moment, optionally with timepoint and region. */
export const spectralAxisLabel = (moment: SpectralMomentKey, timePoint?: number, region = ''): string => {
  const def = DEF_BY_KEY[moment];
  const base = def.unit ? `${def.label} (${def.unit})` : def.label;
  return (timePoint === undefined ? base : `${base} @ ${timePoint}%`) + regionSuffix(region);
};

/** Compact menu label, e.g. `COG @50%`, `COG t3 · release` or `COG k1 (slope)`. */
export const spectralFeatureLabel = (f: SpectralFeature): string => {
  const def = DEF_BY_KEY[f.moment];
  const short = def ? def.short : f.moment;
  const body = f.kind === 'point' ? `${short} @${f.index}%`
    : f.kind === 'track' ? `${short} t${f.index}`
    : `${short} ${coefficientLabel(f.index)}`;
  return body + regionSuffix(featureRegion(f));
};

/** Full axis label, e.g. `Centre of Gravity (Hz) @ 50% · release`. */
export const spectralFeatureAxisLabel = (f: SpectralFeature, flipped = false): string => {
  const def = DEF_BY_KEY[f.moment];
  const base = def ? def.label : f.moment;
  const region = featureRegion(f);
  if (f.kind === 'point') return spectralAxisLabel(f.moment, f.index, region);
  if (f.kind === 'track') {
    const unit = def?.unit ? ` (${def.unit})` : '';
    return `${base}${unit} — track t${f.index}${regionSuffix(region)}`;
  }
  return `${base} — ${coefficientLabel(f.index)}${flipped ? ', sign-flipped' : ''}${regionSuffix(region)}`;
};

/** Human name for a column kind, used in the Data selector. */
export const spectralKindLabel = (kind: SpectralKind): string =>
  kind === 'point' ? 'Moments' : kind === 'track' ? 'Track' : 'Coefficients';

/** Label for one position within a kind: `50%`, `t3`, `k1 (slope)`. */
export const spectralIndexLabel = (kind: SpectralKind, index: number): string =>
  kind === 'point' ? `${index}%` : kind === 'track' ? `t${index}` : coefficientLabel(index);
