import { SpeechToken, DatasetMeta } from '../types';
import { findNearestTimePoint } from './trajectory';
import { isSpectralRole } from './spectralMoments';

/**
 * Numeric measures — the values a plot can put on an axis, as opposed to the labels it
 * groups by. Every numeric column the dataset carries is one: a duration, a pitch, a
 * spectral moment, a custom data field, or a formant sampled at a timepoint.
 *
 * One catalogue and one accessor, so every plot offers the same variables and reads them
 * the same way. A measure is addressed by a field key plus, for formants, the timepoint
 * to sample — `f1` at 20% and `f1` at 80% are two different measures of one column.
 */

/** Formant keys, which need a timepoint before they name a single number. */
export const FORMANT_MEASURES = new Set(['f1', 'f2', 'f3', 'f1_smooth', 'f2_smooth', 'f3_smooth']);

export const isFormantMeasure = (field: string): boolean => FORMANT_MEASURES.has(field);

export interface Measure {
  key: string;
  label: string;
}

/**
 * Every numeric variable the dataset offers, in column order: token duration first (it
 * is always available), then duration, pitch, spectral and data columns, then the
 * formants the file carries.
 */
export const listNumericMeasures = (meta: DatasetMeta | null): Measure[] => {
  const measures: Measure[] = [{ key: 'duration', label: 'Duration' }];
  if (!meta) return measures;
  const seen = new Set<string>(['duration']);

  for (const m of meta.columnMappings) {
    const key = m.fieldName || m.csvHeader;
    if (!key || seen.has(key)) continue;
    const isNumericRole = m.role === 'duration' || m.role === 'pitch' || isSpectralRole(m.role)
      || (m.role === 'field' && m.isDataField === true);
    if (!isNumericRole) continue;
    seen.add(key);
    measures.push({ key, label: measureLabel(key, undefined, meta) });
  }

  for (const m of meta.columnMappings) {
    if (m.role !== 'formant' || !m.formant) continue;
    const key = m.formant + (m.isSmooth ? '_smooth' : '');
    if (seen.has(key)) continue;
    seen.add(key);
    measures.push({ key, label: measureLabel(key, undefined, meta) });
  }
  return measures;
};

/** Formant keys the dataset actually carries — the measures that need a timepoint. */
export const formantMeasureKeys = (meta: DatasetMeta | null): Set<string> => {
  const keys = new Set<string>();
  if (!meta) return keys;
  for (const m of meta.columnMappings) {
    if (m.role === 'formant' && m.formant) keys.add(m.formant + (m.isSmooth ? '_smooth' : ''));
  }
  return keys;
};

/**
 * A token's value for a measure, or NaN when it has none. Formants are read from the
 * trajectory at the nearest available timepoint, everything else from the token's own
 * fields — the same numbers the rest of FRED plots.
 */
export const measureValue = (token: SpeechToken, field: string, timePoint = 50): number => {
  if (!field) return NaN;
  if (field === 'duration') return token.duration;
  if (field === 'xmin') return token.xmin;
  if (isFormantMeasure(field)) {
    const time = findNearestTimePoint(token.trajectory, timePoint);
    if (time === undefined) return NaN;
    const point = token.trajectory.find(p => p.time === time);
    if (!point) return NaN;
    const v = (point as unknown as Record<string, number>)[field];
    return v === undefined ? NaN : v;
  }
  const raw = token.fields[field];
  if (raw === undefined || raw === '') return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
};

/** Axis title for a measure: the user's own column name, with the timepoint for formants. */
export const measureLabel = (field: string, timePoint: number | undefined, meta: DatasetMeta | null): string => {
  if (!field) return '';
  if (field === 'duration') return 'Duration (s)';
  if (isFormantMeasure(field)) {
    const name = field.replace('_smooth', ' (smooth)').replace(/^f(\d)/, 'F$1');
    if (timePoint === undefined) return name;
    const tp = meta?.timePointLabels?.[timePoint] ?? `${timePoint}%`;
    return `${name} @ ${tp} (Hz)`;
  }
  if (meta) {
    for (const m of meta.columnMappings) {
      if (m.fieldName === field || m.csvHeader === field) return m.fieldName || m.csvHeader;
    }
  }
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
