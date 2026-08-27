import { SpeechToken, DatasetMeta, ColumnRole, BandRatioBands } from '../types';

/**
 * Spectral support for consonant analysis.
 *
 * Consonant datasets carry a handful of **spectral measures**: the four spectral
 * moments — centre of gravity (COG), standard deviation / spread (SD), skewness and
 * kurtosis — and the band-energy ratio, which is not a moment but is exported by the
 * same loop, under the same naming scheme, and is plotted the same way. Every measure
 * appears in up to three forms, all stored verbatim in `SpeechToken.fields`:
 *
 *  - **Point** — a measure sampled at a position in the segment: `COG_20%`, `SD_50%`.
 *  - **Track** — a dense trajectory over normalised time: `COG_t0` … `COG_t10`.
 *  - **Coefficient** — DCT/polynomial coefficients summarising a track's shape:
 *    `COG_k0` … `COG_k3` (k0 ≈ height, k1 ≈ slope, k2 ≈ curvature).
 *
 * A column may also name the **region** of the segment it measures, between the measure
 * and the position: `COG_closure_20%`, `SD_release_t3`. Regions are free text taken from
 * the header, so a dataset can split a stop into closure and release, a fricative into
 * onset and offset, or carry no region at all. Every measurement is therefore addressed
 * by measure × region × kind × position, and closure never shares a slot with release.
 *
 * The three forms are discovered and stored separately: a track is an ordered vector
 * per token, whereas points and coefficients are scalars. Grid lengths are always read
 * from the data — a dataset may carry any number of track samples or coefficients.
 *
 * This module insulates the UI from the exact column-naming scheme.
 */

/** Every spectral measure FRED reads from a column name. */
export type SpectralMeasureKey = 'COG' | 'SD' | 'skew' | 'kurt' | 'bandratio';

/**
 * The subset that really is a moment of the spectrum. Use this where the code means
 * *the four moments* — moment order, "the spectral moments" in prose — rather than
 * "any spectral column".
 */
export type SpectralMomentKey = Exclude<SpectralMeasureKey, 'bandratio'>;

export interface SpectralMeasureDef {
  key: SpectralMeasureKey;
  /** Full descriptive label for axis titles and menus. */
  label: string;
  /** Short label for compact UI (axis ticks, chips). */
  short: string;
  /** Measurement unit ('Hz' for COG/SD, 'dB' for the ratio, '' when dimensionless). */
  unit: string;
  /** True for the four spectral moments; false for measures derived some other way. */
  isMoment: boolean;
  /**
   * Signed, with a meaningful zero. Colour-map such a measure with a diverging scale
   * centred on 0 rather than a sequential one, and draw 0 as a reference line on any
   * axis carrying it — for the band ratio, 0 dB is equal energy in both bands, and
   * which side of it a token falls on is the reading.
   */
  centredAtZero: boolean;
}

/**
 * Canonical definitions: the four moments first, in conventional moment order, then
 * measures that are not moments.
 */
export const SPECTRAL_MEASURE_DEFS: SpectralMeasureDef[] = [
  { key: 'COG', label: 'Centre of Gravity', short: 'COG', unit: 'Hz', isMoment: true, centredAtZero: false },
  { key: 'SD', label: 'Standard Deviation (spread)', short: 'SD', unit: 'Hz', isMoment: true, centredAtZero: false },
  { key: 'skew', label: 'Skewness', short: 'Skew', unit: '', isMoment: true, centredAtZero: false },
  { key: 'kurt', label: 'Kurtosis', short: 'Kurt', unit: '', isMoment: true, centredAtZero: false },
  { key: 'bandratio', label: 'Band Energy Ratio', short: 'Ratio', unit: 'dB', isMoment: false, centredAtZero: true },
];

/** The four spectral moments alone, in conventional moment order. */
export const SPECTRAL_MOMENT_DEFS: SpectralMeasureDef[] =
  SPECTRAL_MEASURE_DEFS.filter(d => d.isMoment);

const DEF_BY_KEY: Record<SpectralMeasureKey, SpectralMeasureDef> =
  Object.fromEntries(SPECTRAL_MEASURE_DEFS.map(d => [d.key, d])) as Record<SpectralMeasureKey, SpectralMeasureDef>;

export const getSpectralMeasureDef = (key: SpectralMeasureKey): SpectralMeasureDef => DEF_BY_KEY[key];

/** Column-mapping roles that bind a CSV column to a specific spectral measure. */
export const SPECTRAL_ROLE_TO_MEASURE: Partial<Record<ColumnRole, SpectralMeasureKey>> = {
  spectral_cog: 'COG',
  spectral_sd: 'SD',
  spectral_skew: 'skew',
  spectral_kurt: 'kurt',
  spectral_bandratio: 'bandratio',
};

const MEASURE_TO_ROLE: Record<SpectralMeasureKey, ColumnRole> = {
  COG: 'spectral_cog', SD: 'spectral_sd', skew: 'spectral_skew', kurt: 'spectral_kurt',
  bandratio: 'spectral_bandratio',
};

export const isSpectralRole = (role: ColumnRole): boolean => role in SPECTRAL_ROLE_TO_MEASURE;

/**
 * Header spellings for each measure, matched case-insensitively with underscores removed
 * so `centre_of_gravity` and `centreOfGravity` both resolve. This table is the single
 * place that decides whether a name spells a spectral measure — CSV auto-detection and
 * the dataset scan both go through it.
 */
const MEASURE_SYNONYMS: Record<string, SpectralMeasureKey> = {
  cog: 'COG', centroid: 'COG', centerofgravity: 'COG', centreofgravity: 'COG',
  sd: 'SD', stdev: 'SD', std: 'SD', sdev: 'SD', spread: 'SD', specdiff: 'SD', diffusion: 'SD',
  skew: 'skew', skewness: 'skew',
  kurt: 'kurt', kurtosis: 'kurt', kurts: 'kurt',
  bandratio: 'bandratio', bandenergyratio: 'bandratio', ber: 'bandratio',
};

/** Map a header token (case-insensitive) to a canonical measure key, or null. */
const canonicalMeasure = (raw: string): SpectralMeasureKey | null =>
  MEASURE_SYNONYMS[raw.toLowerCase().replace(/_/g, '')] ?? null;

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
  measure: SpectralMeasureKey | null;
  /** Region label between measure and position (`closure`), '' when there is none. */
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
 * Split a base name into the measure it names and the region label that follows.
 * The longest leading run of parts that spells a measure wins, so `centre_of_gravity_burst`
 * reads as COG in the burst region. A base whose head names no measure has no region: a
 * hand-mapped column such as `sibilance_centre` is one measurement, not a region of one.
 */
const splitMeasureAndRegion = (base: string): { measure: SpectralMeasureKey | null; region: string } => {
  const parts = base.split('_').filter(p => p !== '');
  for (let i = Math.min(parts.length, 4); i >= 1; i--) {
    const measure = canonicalMeasure(parts.slice(0, i).join(''));
    if (measure) return { measure, region: sanitizeRegion(parts.slice(i).join('_')) };
  }
  return { measure: null, region: '' };
};

/**
 * Classify a spectral column by its name. Track and coefficient suffixes are tested
 * first — `_t0`/`_k0` must not be read as timepoints. A name with no recognised suffix
 * is a single point measurement at the segment midpoint.
 */
export const parseSpectralColumn = (columnName: string): SpectralColumnRef => {
  const ref = (kind: SpectralKind, index: number, base: string): SpectralColumnRef =>
    ({ kind, index, base, ...splitMeasureAndRegion(base) });
  const track = columnName.match(TRACK_SUFFIX_REGEX);
  if (track) return ref('track', parseInt(track[1], 10), columnName.slice(0, track.index));
  const coeff = columnName.match(COEFF_SUFFIX_REGEX);
  if (coeff) return ref('coeff', parseInt(coeff[1], 10), columnName.slice(0, coeff.index));
  const point = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  if (point) return ref('point', parseFloat(point[1]), columnName.slice(0, point.index));
  return ref('point', 50, columnName);
};

/**
 * The spectral role a CSV header implies, or null when the header names no measure.
 * Drives auto-detection in the mapping dialog; users can override it there.
 */
export const detectSpectralRole = (columnName: string): ColumnRole | null => {
  const measure = parseSpectralColumn(columnName).measure;
  return measure ? MEASURE_TO_ROLE[measure] : null;
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
  measure: SpectralMeasureKey;
  kind: SpectralKind;
  /** Timepoint (point), sample index (track), or coefficient order (coeff). */
  index: number;
  /** Region of the segment measured; '' when the column carries no region label. */
  region: string;
  /** Key into `SpeechToken.fields`. */
  fieldKey: string;
}

export interface SpectralMeta {
  /** Every spectral measurement found, in discovery order. */
  columns: SpectralColumn[];
  /** Distinct region labels, in the order the dataset presents them. */
  regions: string[];
  /** Whether any spectral column of any kind was found. */
  available: boolean;
  /** Slot key → field key; the resolver behind every value read. */
  keyMap: Record<string, string>;
  /**
   * Bands behind the band-ratio columns, from the export's provenance sidecar; null
   * when no sidecar was loaded. Labels state them so two datasets measured over
   * different bands are not read as the same thing.
   */
  bandRatio: BandRatioBands | null;
}

const slotKey = (region: string, measure: SpectralMeasureKey, kind: SpectralKind, index: number) =>
  `${region}|${measure}|${kind}|${index}`;

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
 * Discover which spectral measurements the dataset holds, keyed by measure, region, kind
 * and position. Builds a resolver so callers fetch values without re-parsing header
 * schemes.
 *
 * Columns explicitly mapped to a spectral role (Spectral COG / SD / Skew / Kurtosis in
 * the Data Mapping dialog) are authoritative and are claimed first, so users can name
 * their columns anything; a mapping's `spectralRegion` overrides the region read from
 * the header. The header-pattern scan then fills any remaining slots (legacy datasets,
 * conventionally-named extra columns).
 */
export const discoverSpectralColumns = (
  tokens: SpeechToken[],
  meta: DatasetMeta | null = null,
): SpectralMeta => {
  const columns: SpectralColumn[] = [];
  const keyMap: Record<string, string> = {};
  const regions: string[] = [];

  /** Record one column. The first claim on a slot wins. */
  const claim = (measure: SpectralMeasureKey, fieldKey: string, regionOverride?: string) => {
    const ref = parseSpectralColumn(fieldKey);
    const region = sanitizeRegion(regionOverride ?? ref.region);
    const slot = slotKey(region, measure, ref.kind, ref.index);
    if (slot in keyMap) return;
    keyMap[slot] = fieldKey;
    columns.push({ measure, kind: ref.kind, index: ref.index, region, fieldKey });
    if (!regions.includes(region)) regions.push(region);
  };

  // Explicit role mappings are authoritative — claimed before the header scan.
  if (meta) {
    for (const m of meta.columnMappings) {
      const measure = SPECTRAL_ROLE_TO_MEASURE[m.role];
      if (!measure) continue;
      const fieldKey = m.fieldName || m.csvHeader;
      if (fieldKey) claim(measure, fieldKey, m.spectralRegion);
    }
  }

  // Header-pattern scan fills any remaining slots (legacy / unmapped datasets).
  // The head of the name must itself spell a measure, so `winms_closure_20%` and
  // `nsamples_20%` are correctly left alone.
  for (const fieldKey of collectFieldKeys(tokens, meta)) {
    const measure = parseSpectralColumn(fieldKey).measure;
    if (measure) claim(measure, fieldKey);
  }

  return {
    columns, regions, keyMap,
    available: columns.length > 0,
    bandRatio: meta?.provenance?.bandRatio ?? null,
  };
};

// ─── Querying what the dataset offers ─────────────────────────────────────

/** Columns of one kind, optionally restricted to a region. */
const columnsOfKind = (meta: SpectralMeta, kind: SpectralKind, region?: string): SpectralColumn[] =>
  meta.columns.filter(c => c.kind === kind && (region === undefined || c.region === region));

/** Measures offering a given kind (within a region when given), in canonical order. */
export const spectralMeasuresOfKind = (
  meta: SpectralMeta, kind: SpectralKind, region?: string,
): SpectralMeasureDef[] => {
  const present = new Set(columnsOfKind(meta, kind, region).map(c => c.measure));
  return SPECTRAL_MEASURE_DEFS.filter(d => present.has(d.key));
};

/** Positions available for a kind: timepoints, track samples, or coefficient orders. */
export const spectralIndicesOfKind = (
  meta: SpectralMeta, kind: SpectralKind, region?: string,
): number[] =>
  Array.from(new Set(columnsOfKind(meta, kind, region).map(c => c.index))).sort((a, b) => a - b);

/** Kinds the dataset carries (within a region when given), in display order. */
export const spectralKindsAvailable = (meta: SpectralMeta, region?: string): SpectralKind[] =>
  (['point', 'track', 'coeff'] as SpectralKind[]).filter(k => columnsOfKind(meta, k, region).length > 0);

/** Regions carrying a given measurement family — which phases of the segment have it. */
export const spectralRegionsOfKind = (
  meta: SpectralMeta, kind: SpectralKind, measure?: SpectralMeasureKey,
): string[] => meta.regions.filter(r =>
  meta.columns.some(c => c.region === r && c.kind === kind && (measure === undefined || c.measure === measure)));

/** Whether the dataset labels any spectral column by region. */
export const hasSpectralRegions = (meta: SpectralMeta): boolean =>
  meta.regions.some(r => r !== '');

/** Display text for a region in menus; unlabelled columns read as "whole segment". */
export const spectralRegionLabel = (region: string): string => region || 'whole segment';

// ─── Features: any scalar a token can be plotted by ────────────────────────

/**
 * A scalar measurement selectable on an axis. Any of the three column kinds becomes a
 * scalar once an index is fixed: a measure at a timepoint (`COG@50`), one track sample
 * (`COG~t3`), or a shape coefficient (`COG~k1`). A track is only a *vector* when swept,
 * which is what trajectory and contour modes do. `region` names the phase of the segment
 * measured, and is omitted for datasets whose columns carry no region label.
 */
export interface SpectralFeature {
  measure: SpectralMeasureKey;
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
  const body = f.kind === 'point' ? `${f.measure}@${f.index}`
    : f.kind === 'track' ? `${f.measure}~t${f.index}`
    : `${f.measure}~k${f.index}`;
  return featureRegion(f) ? `${featureRegion(f)}:${body}` : body;
};

/** Parse a feature ref; returns null when malformed. */
export const parseSpectralFeature = (ref: string): SpectralFeature | null => {
  const colon = ref.indexOf(':');
  const region = colon >= 0 ? ref.slice(0, colon) : '';
  const body = colon >= 0 ? ref.slice(colon + 1) : ref;
  const suffixed = body.match(/^(\w+)~([tk])(\d+)$/);
  if (suffixed) return {
    measure: suffixed[1] as SpectralMeasureKey,
    kind: suffixed[2] === 't' ? 'track' : 'coeff',
    index: parseInt(suffixed[3], 10),
    region,
  };
  const point = body.match(/^(\w+)@(\d+(?:\.\d+)?)$/);
  if (point) return { measure: point[1] as SpectralMeasureKey, kind: 'point', index: parseFloat(point[2]), region };
  return null;
};

/** Stable ref for a measurement family — a measure in a region, e.g. `closure:COG`. */
export const formatSpectralMeasureRef = (measure: SpectralMeasureKey, region: string): string =>
  region ? `${region}:${measure}` : measure;

/** Parse a family ref written by `formatSpectralMeasureRef`. */
export const parseSpectralMeasureRef = (ref: string): { measure: SpectralMeasureKey; region: string } => {
  const colon = ref.indexOf(':');
  return colon >= 0
    ? { measure: ref.slice(colon + 1) as SpectralMeasureKey, region: ref.slice(0, colon) }
    : { measure: ref as SpectralMeasureKey, region: '' };
};

/** Whether the dataset actually holds the column behind a feature. */
export const hasSpectralFeature = (meta: SpectralMeta, f: SpectralFeature): boolean =>
  !!meta.keyMap[slotKey(featureRegion(f), f.measure, f.kind, f.index)];

/**
 * Every feature the dataset offers — points, then track samples, then coefficients —
 * restricted to one region when given.
 */
export const listSpectralFeatures = (meta: SpectralMeta, region?: string): SpectralFeature[] => {
  const kinds: SpectralKind[] = ['point', 'track', 'coeff'];
  const out: SpectralFeature[] = [];
  for (const kind of kinds) {
    for (const r of (region === undefined ? meta.regions : [region])) {
      for (const m of spectralMeasuresOfKind(meta, kind, r)) {
        for (const i of spectralIndicesOfKind(meta, kind, r)) {
          const f: SpectralFeature = { measure: m.key, kind, index: i, region: r };
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
  ref: string, meta: SpectralMeta, fallbackIndex = 0,
): SpectralFeature | null => {
  const parsed = parseSpectralFeature(ref);
  if (parsed && hasSpectralFeature(meta, parsed)) return parsed;
  const all = listSpectralFeatures(meta);
  if (all.length === 0) return null;
  return all[Math.min(fallbackIndex, all.length - 1)];
};

/**
 * The measurement to put on the second axis beside `x`: another measure in the same
 * region at the same position — the classic COG × SD pairing — or another coefficient
 * order when x is a coefficient.
 */
const partnerFeature = (x: SpectralFeature, meta: SpectralMeta): SpectralFeature => {
  const region = featureRegion(x);
  if (x.kind === 'coeff') {
    const indices = spectralIndicesOfKind(meta, 'coeff', region);
    return { ...x, index: indices.find(i => i !== x.index) ?? x.index };
  }
  const measures = spectralMeasuresOfKind(meta, x.kind, region);
  return { ...x, measure: (measures.find(m => m.key !== x.measure) ?? measures[0])?.key ?? x.measure };
};

/**
 * Resolve a pair of scatter axis refs together. Refs the dataset holds are kept as
 * stored; an unusable X falls back to the dataset's first feature, and an unusable Y to
 * the partner of X, so the pair always names two real columns of the same kind. Every
 * caller — plot and controls alike — resolves through here, so what the axis menus show
 * is what the plot draws.
 */
export const resolveSpectralAxes = (
  xRef: string, yRef: string, meta: SpectralMeta,
): { x: SpectralFeature | null; y: SpectralFeature | null } => {
  const x = resolveSpectralFeature(xRef, meta, 0);
  if (!x) return { x: null, y: null };
  const storedY = parseSpectralFeature(yRef);
  return { x, y: (storedY && hasSpectralFeature(meta, storedY)) ? storedY : partnerFeature(x, meta) };
};

/**
 * Where a feature lands on another kind's grid. A position is kept verbatim when the new
 * grid has it; between the two time-like kinds it moves proportionally, so the segment
 * midpoint stays the midpoint (50% ↔ t5) and switching back returns where you were.
 * Coefficient orders are not positions in time, so they always start at k0.
 */
const positionOnGrid = (
  f: SpectralFeature, kind: SpectralKind, meta: SpectralMeta, indices: number[],
): number => {
  if (indices.includes(f.index)) return f.index;
  if (kind === 'coeff' || f.kind === 'coeff') return indices[0];
  const from = spectralIndicesOfKind(meta, f.kind, featureRegion(f));
  const at = from.indexOf(f.index);
  if (at < 0 || from.length < 2) return indices[0];
  return indices[Math.round((at / (from.length - 1)) * (indices.length - 1))];
};

/**
 * Move a feature onto another column kind, keeping its measure and region wherever that
 * kind offers them — Moments → Track should still be showing COG of the release, just
 * sampled along the track. `measureFallback` picks which measure to land on when the
 * feature's own is absent (0 for a first axis, 1 for the one beside it). Null when the
 * kind carries nothing to show.
 */
export const spectralFeatureOnKind = (
  f: SpectralFeature | null, kind: SpectralKind, meta: SpectralMeta, measureFallback = 0,
): SpectralFeature | null => {
  const regions = spectralRegionsOfKind(meta, kind);
  if (regions.length === 0) return null;
  const region = f && regions.includes(featureRegion(f)) ? featureRegion(f) : regions[0];
  const measures = spectralMeasuresOfKind(meta, kind, region);
  const indices = spectralIndicesOfKind(meta, kind, region);
  if (!measures.length || !indices.length) return null;
  const measure = f && measures.some(m => m.key === f.measure) ? f.measure
    : measures[Math.min(measureFallback, measures.length - 1)].key;
  const index = f ? positionOnGrid(f, kind, meta, indices) : indices[0];
  return { measure, kind, index, region };
};

/**
 * The single measurement a box or density plot shows. The stored ref wins while the
 * dataset holds it; otherwise the plot follows the scatter X axis, so moving between
 * plot types keeps the measure and region you were already looking at.
 */
export const resolveSpectralMeasure = (
  ref: string, axisRef: string, meta: SpectralMeta,
): SpectralFeature | null => {
  const stored = parseSpectralFeature(ref);
  if (stored && hasSpectralFeature(meta, stored)) return stored;
  return resolveSpectralFeature(axisRef, meta, 0);
};

/** A measurement family swept over time, and the grid it sweeps. */
export interface SpectralContour {
  measure: SpectralMeasureKey;
  region: string;
  /** Tracks are preferred: a denser grid over the same segment. */
  kind: 'track' | 'point';
}

/**
 * The positions a contour sweeps: only those the measure itself has in that region, so a
 * measure measured once inside a region that others sample three times is not swept over
 * two missing values.
 */
export const spectralContourSteps = (meta: SpectralMeta, c: SpectralContour): number[] =>
  spectralIndicesOfKind(meta, c.kind, c.region)
    .filter(i => hasSpectralFeature(meta, { measure: c.measure, kind: c.kind, index: i, region: c.region }));

/**
 * Every measurement family that can be drawn as a contour. Selection is deliberately
 * per measure and region: COG having a dense track must not hide a Band Energy Ratio that
 * is available only at 20/50/80%. A family's track wins when it has one; otherwise its
 * percentage points are used.
 */
export const listSpectralContours = (meta: SpectralMeta): SpectralContour[] => {
  const out: SpectralContour[] = [];
  for (const region of meta.regions) {
    for (const def of SPECTRAL_MEASURE_DEFS) {
      for (const kind of ['track', 'point'] as const) {
        const contour: SpectralContour = { measure: def.key, region, kind };
        if (spectralContourSteps(meta, contour).length >= 2) {
          out.push(contour);
          break;
        }
      }
    }
  }
  return out;
};
/**
 * The contour a timeline draws: the stored `region:measure` family while the dataset
 * holds a grid for it, else the scatter X axis's family, else the first family with a
 * grid at all. Returns null when nothing has ≥2 positions to sweep.
 */
export const resolveSpectralContour = (
  ref: string, axisRef: string, meta: SpectralMeta,
): SpectralContour | null => {
  const kinds: ('track' | 'point')[] = ['track', 'point'];
  const find = (measure: SpectralMeasureKey | undefined, region: string): SpectralContour | null => {
    if (!measure) return null;
    for (const kind of kinds) {
      const c: SpectralContour = { measure, region, kind };
      if (spectralContourSteps(meta, c).length >= 2) return c;
    }
    return null;
  };
  const stored = parseSpectralMeasureRef(ref);
  const fromStored = find(stored.measure, stored.region);
  if (fromStored) return fromStored;
  const axis = parseSpectralFeature(axisRef);
  const fromAxis = axis && find(axis.measure, axis.region ?? '');
  if (fromAxis) return fromAxis;
  for (const kind of kinds) {
    for (const region of meta.regions) {
      const found = find(spectralMeasuresOfKind(meta, kind, region)[0]?.key, region);
      if (found) return found;
    }
  }
  return null;
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
  token: SpeechToken, meta: SpectralMeta, f: SpectralFeature,
): number => readValue(token, meta.keyMap[slotKey(featureRegion(f), f.measure, f.kind, f.index)]);

/** One point measurement: a measure at a timepoint, within a region. */
export const getSpectralValue = (
  token: SpeechToken, meta: SpectralMeta,
  measure: SpectralMeasureKey, timePoint: number, region = '',
): number => getSpectralFeatureValue(token, meta, { measure, kind: 'point', index: timePoint, region });

/** One DCT/polynomial coefficient for a token. */
export const getSpectralCoeffValue = (
  token: SpeechToken, meta: SpectralMeta,
  measure: SpectralMeasureKey, index: number, region = '',
): number => getSpectralFeatureValue(token, meta, { measure, kind: 'coeff', index, region });

/** One track sample for a token. */
export const getSpectralTrackValue = (
  token: SpeechToken, meta: SpectralMeta,
  measure: SpectralMeasureKey, index: number, region = '',
): number => getSpectralFeatureValue(token, meta, { measure, kind: 'track', index, region });

/**
 * A token's whole track for a measure, in grid order.
 * Missing samples come back as NaN so callers can align tracks pointwise.
 */
export const getSpectralTrack = (
  token: SpeechToken, meta: SpectralMeta, measure: SpectralMeasureKey, region = '',
): number[] => spectralIndicesOfKind(meta, 'track', region)
  .map(i => getSpectralTrackValue(token, meta, measure, i, region));

/** Nearest available timepoint to a target (for graceful fallback when 50 is absent). */
export const nearestSpectralTimePoint = (
  meta: SpectralMeta, target: number, region?: string,
): number | undefined => {
  const points = spectralIndicesOfKind(meta, 'point', region);
  if (points.length === 0) return undefined;
  return points.reduce((best, tp) => Math.abs(tp - target) < Math.abs(best - target) ? tp : best, points[0]);
};

// ─── Labels ───────────────────────────────────────────────────────────────

/** Trailing region qualifier for a label, empty for region-less datasets. */
const regionSuffix = (region: string): string => region ? ` · ${region}` : '';

/**
 * One band as `5.5–7.5k`: both edges in kHz, carrying the unit once. Axis labels get
 * long, and both bands are read together — a single scale keeps them comparable at a
 * glance and costs three characters instead of six.
 */
const bandSpan = ([lo, hi]: [number, number]): string =>
  `${parseFloat((lo / 1000).toFixed(3))}–${parseFloat((hi / 1000).toFixed(3))}k`;

/** `5.5–7.5k / 0.4–0.9k` — the two bands a ratio compares, high over low. */
export const bandRatioBandsLabel = (bands: BandRatioBands): string =>
  `${bandSpan(bands.high)} / ${bandSpan(bands.low)}`;

/**
 * The name of a measure as it must appear on an axis or in a legend.
 *
 * For the band ratio this is not decoration. Two CSVs exported with different band
 * edges carry identically-named `bandratio_*` columns that are not comparable, so the
 * edges travel with the label whenever the sidecar told us what they were. Without a
 * sidecar the label stays plain — inventing edges would be worse than omitting them.
 */
export const spectralMeasureLabel = (measure: SpectralMeasureKey, bands?: BandRatioBands | null): string => {
  const def = DEF_BY_KEY[measure];
  if (measure === 'bandratio' && bands) return `Band ratio ${bandRatioBandsLabel(bands)} (${def.unit})`;
  return def.unit ? `${def.label} (${def.unit})` : def.label;
};

/** Axis/menu label for a measure, optionally with timepoint and region. */
export const spectralAxisLabel = (
  measure: SpectralMeasureKey, timePoint?: number, region = '', bands?: BandRatioBands | null,
): string => {
  const base = spectralMeasureLabel(measure, bands);
  return (timePoint === undefined ? base : `${base} @ ${timePoint}%`) + regionSuffix(region);
};

/** Compact menu label, e.g. `COG @50%`, `COG t3 · release` or `COG k1 (slope)`. */
export const spectralFeatureLabel = (f: SpectralFeature): string => {
  const def = DEF_BY_KEY[f.measure];
  const short = def ? def.short : f.measure;
  const body = f.kind === 'point' ? `${short} @${f.index}%`
    : f.kind === 'track' ? `${short} t${f.index}`
    : `${short} ${coefficientLabel(f.index)}`;
  return body + regionSuffix(featureRegion(f));
};

/** Full axis label, e.g. `Centre of Gravity (Hz) @ 50% · release`. */
export const spectralFeatureAxisLabel = (
  f: SpectralFeature, bands?: BandRatioBands | null, flipped = false,
): string => {
  const def = DEF_BY_KEY[f.measure];
  const region = featureRegion(f);
  if (f.kind === 'point') return spectralAxisLabel(f.measure, f.index, region, bands);
  if (f.kind === 'track') return `${spectralMeasureLabel(f.measure, bands)} — track t${f.index}${regionSuffix(region)}`;
  const base = def ? def.label : f.measure;
  return `${base} — ${coefficientLabel(f.index)}${flipped ? ', sign-flipped' : ''}${regionSuffix(region)}`;
};

/** Whether a measure is signed with a meaningful zero, so an axis should mark 0. */
export const isCentredAtZero = (measure: SpectralMeasureKey): boolean =>
  DEF_BY_KEY[measure]?.centredAtZero === true;

/** Human name for a column kind, used in the Data selector. */
export const spectralKindLabel = (kind: SpectralKind): string =>
  kind === 'point' ? 'Moments' : kind === 'track' ? 'Track' : 'Coefficients';

/** Label for one position within a kind: `50%`, `t3`, `k1 (slope)`. */
export const spectralIndexLabel = (kind: SpectralKind, index: number): string =>
  kind === 'point' ? `${index}%` : kind === 'track' ? `t${index}` : coefficientLabel(index);
