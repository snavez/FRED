import { SpeechToken, DatasetMeta, ColumnRole } from '../types';

/**
 * Spectral-moment support for consonant analysis.
 *
 * Consonant datasets carry the four spectral moments — centre of gravity (COG),
 * standard deviation / spread (SD), skewness and kurtosis — each measured at one or
 * more points within the segment (e.g. 20% / 50% / 80%). These arrive as wide-format
 * columns such as `COG_20%`, `SD_50%`, `skew_80%` and are stored verbatim in
 * `SpeechToken.fields`. This module discovers which moments/timepoints are present and
 * extracts numeric values, insulating the UI from the exact column-naming scheme.
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

/** Trailing `_<timepoint>[%][_smooth]` suffix, e.g. `_20%`, `_50`, `_80%_smooth`. */
const TIMEPOINT_SUFFIX_REGEX = /_(\d+(?:\.\d+)?)\s*%?(?:_smooth)?$/;

/** Parse the timepoint suffix from a column name, or null when there is none. */
export const parseSpectralTimePointSuffix = (columnName: string): number | null => {
  const match = columnName.match(TIMEPOINT_SUFFIX_REGEX);
  return match ? parseFloat(match[1]) : null;
};

/** Base name of a spectral column with its timepoint suffix stripped (`COG_20%` → `COG`). */
export const spectralColumnBaseName = (columnName: string): string =>
  columnName.replace(TIMEPOINT_SUFFIX_REGEX, '');

/**
 * Timepoint for a spectral-role column: parsed from the header suffix when present,
 * otherwise the segment midpoint (50%) — a bare `COG` column is a single measurement.
 */
export const spectralRoleTimePoint = (columnName: string): number =>
  parseSpectralTimePointSuffix(columnName) ?? 50;

/** Map a header token (case-insensitive) to a canonical moment key, or null. */
const canonicalMoment = (raw: string): SpectralMomentKey | null => {
  const s = raw.toLowerCase();
  if (s === 'cog' || s === 'centroid' || s === 'centreofgravity' || s === 'centerofgravity') return 'COG';
  if (s === 'sd' || s === 'stdev' || s === 'std' || s === 'spread' || s === 'sdev') return 'SD';
  if (s === 'skew' || s === 'skewness') return 'skew';
  if (s === 'kurt' || s === 'kurtosis' || s === 'kurts') return 'kurt';
  return null;
};

/**
 * Match a field key of the form `<moment>_<timepoint>[%]` — e.g. `COG_20%`, `sd_50`,
 * `kurtosis_80%`. A leading/trailing `_smooth` suffix is tolerated and ignored.
 */
const FIELD_KEY_REGEX = /^([a-zA-Z]+)_(\d+(?:\.\d+)?)\s*%?(?:_smooth)?$/;

export const getSpectralMomentDef = (key: SpectralMomentKey): SpectralMomentDef => DEF_BY_KEY[key];

export interface SpectralMomentMeta {
  /** Moments present in the data, in canonical order. */
  moments: SpectralMomentDef[];
  /** Distinct timepoints present (sorted ascending), e.g. [20, 50, 80]. */
  timePoints: number[];
  /** Whether any spectral-moment columns were found at all. */
  available: boolean;
  /** Resolver from `${moment}@${timePoint}` to the actual field key in token.fields. */
  keyMap: Record<string, string>;
}

const slot = (moment: SpectralMomentKey, timePoint: number) => `${moment}@${timePoint}`;

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
  const momentSet = new Set<SpectralMomentKey>();
  const timeSet = new Set<number>();

  if (meta) {
    for (const m of meta.columnMappings) {
      const moment = SPECTRAL_ROLE_TO_MOMENT[m.role];
      if (!moment) continue;
      const fieldKey = m.fieldName || m.csvHeader;
      if (!fieldKey) continue;
      const timePoint = spectralRoleTimePoint(fieldKey);
      momentSet.add(moment);
      timeSet.add(timePoint);
      const s = slot(moment, timePoint);
      if (!(s in keyMap)) keyMap[s] = fieldKey;
    }
  }

  for (const fieldKey of collectFieldKeys(tokens, meta)) {
    const match = fieldKey.match(FIELD_KEY_REGEX);
    if (!match) continue;
    const moment = canonicalMoment(match[1]);
    if (!moment) continue;
    const timePoint = parseFloat(match[2]);
    if (isNaN(timePoint)) continue;
    momentSet.add(moment);
    timeSet.add(timePoint);
    // First key wins for a given slot (raw preferred over any _smooth variant, which
    // sorts later alphabetically and won't overwrite an existing entry).
    const s = slot(moment, timePoint);
    if (!(s in keyMap)) keyMap[s] = fieldKey;
  }

  const moments = SPECTRAL_MOMENT_DEFS.filter(d => momentSet.has(d.key));
  const timePoints = Array.from(timeSet).sort((a, b) => a - b);
  return { moments, timePoints, available: moments.length > 0, keyMap };
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
