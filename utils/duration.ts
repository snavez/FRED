import { SpeechToken, DatasetMeta } from '../types';

/**
 * How long a token lasted, in the unit a plot needs.
 *
 * A dataset often carries several duration columns — the whole segment, the closure, the
 * release — and an absolute-time plot is only honest if it stretches each contour over
 * the span that contour actually measures. So the duration is chosen explicitly rather
 * than assumed: the caller names a column, and only falls back to the token's own
 * duration when it names none.
 */

/** Duration columns the dataset offers, in column order. */
export const listDurationFields = (meta: DatasetMeta | null): { key: string; label: string }[] => {
  if (!meta) return [];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    if (m.role !== 'duration') continue;
    const key = m.fieldName || m.csvHeader;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: key });
  }
  return out;
};

/**
 * The duration column that best fits a named region of the segment: `release` picks
 * `release_dur` over `MAU_dur`. Returns '' when nothing matches, meaning the token's own
 * duration.
 */
export const durationFieldForRegion = (meta: DatasetMeta | null, region: string): string => {
  if (!region) return '';
  const wanted = region.toLowerCase();
  const fields = listDurationFields(meta);
  const match = fields.find(f => f.key.toLowerCase().includes(wanted));
  return match ? match.key : '';
};

/** The token's own duration, falling back to a duration-like field when it has none. */
export const getTokenDuration = (t: SpeechToken): number => {
  if (t.duration > 0) return t.duration;
  for (const [key, val] of Object.entries(t.fields)) {
    const k = key.toLowerCase();
    if (k === 'duration' || k === 'dur' || k.startsWith('dur_') || k.endsWith('_dur') || k.endsWith('_duration')) {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 0;
};

/**
 * A token's duration in seconds or milliseconds, from `durationField` when given.
 * Datasets record durations in either unit, so the scale is inferred per value: speech
 * segments are well under 10 seconds and well over 10 milliseconds, which separates the
 * two cleanly.
 *
 * Naming a column is a statement about *which* span to measure, so a token that has no
 * value in it has no duration here — 0, for the caller to skip. Falling back to the whole
 * segment would quietly mix two different spans on one axis: a token with no release
 * would be drawn over its entire segment, stretching an axis meant for releases.
 */
export const getTokenDurationInUnit = (t: SpeechToken, useMs: boolean, durationField?: string): number => {
  if (durationField) {
    const raw = parseFloat(t.fields[durationField] ?? '');
    if (isNaN(raw) || raw <= 0) return 0;
    return useMs ? (raw > 10 ? raw : raw * 1000) : (raw > 10 ? raw / 1000 : raw);
  }
  if (useMs) {
    if (t.trajectoryDurationMs && t.trajectoryDurationMs > 0) return t.trajectoryDurationMs;
    const d = getTokenDuration(t);
    return d > 10 ? d : d * 1000;
  }
  if (t.trajectoryDurationMs && t.trajectoryDurationMs > 0) return t.trajectoryDurationMs / 1000;
  const d = getTokenDuration(t);
  return d > 10 ? d / 1000 : d;
};
