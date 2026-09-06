import { ColumnMapping, NumericColumnStats, NumericRange, SpeechToken } from '../types';
import { getLabel } from './getLabel';

/**
 * Numeric columns, and filtering by their value rather than by their exact text.
 *
 * A label field is filtered by picking values off a list; that is useless for a column of
 * measurements, where what you want is "drop anything under 20 ms". Such a column is
 * recognised by looking at **every** row rather than a sample: a measure taken only on
 * some segments — a release duration, a burst COG — can be blank for the whole head of the
 * file and still be a column of numbers, and the sample used during import cannot tell.
 *
 * The bounds are inclusive and each is optional, so one field covers `>`, `<` and a window
 * between two thresholds. An absent bound is open, and a field with no range at all is
 * unfiltered — the opposite convention to the value lists, where an empty selection passes
 * nothing.
 */

/** Share of a column's non-blank cells that must be numbers for it to count as numeric. */
const NUMERIC_SHARE = 0.8;

/** The number in a cell, or NaN when it is blank or holds something that is not a number. */
export const parseNumericCell = (raw: string): number => {
  const trimmed = raw.trim();
  if (trimmed === '') return NaN;
  return Number(trimmed);
};

/**
 * Measure one column across every token, or null when it is not a column of numbers.
 * Blank cells are ignored rather than counted against it.
 */
export const measureNumericColumn = (
  tokens: SpeechToken[], key: string,
): NumericColumnStats | null => {
  let filled = 0, count = 0, min = Infinity, max = -Infinity;
  for (const token of tokens) {
    const raw = getLabel(token, key);
    if (raw.trim() === '') continue;
    filled++;
    const value = parseNumericCell(raw);
    if (isNaN(value)) continue;
    count++;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0 || count / filled < NUMERIC_SHARE) return null;
  return { min, max, count };
};

/** Roles whose columns are not a single number per token, so cannot carry a range. */
const UNMEASURABLE_ROLES = new Set(['formant', 'timepoint', 'token_id', 'ignore', 'speaker', 'file_id']);

/** The key a mapping's values are read by, or null when it has none. */
export const numericFieldKey = (m: ColumnMapping): string | null =>
  UNMEASURABLE_ROLES.has(m.role) ? null : (m.fieldName || m.csvHeader || null);

/**
 * Fill in `numeric` on every mapping that names a column of numbers, measured over the
 * whole dataset. Mappings that name anything else are returned unchanged.
 */
export const measureNumericColumns = (
  tokens: SpeechToken[], mappings: ColumnMapping[],
): ColumnMapping[] => mappings.map(m => {
  const key = numericFieldKey(m);
  const numeric = key ? measureNumericColumn(tokens, key) : null;
  return numeric ? { ...m, numeric } : m;
});

/** Whether a range leaves the field unfiltered. */
export const isOpenRange = (range?: NumericRange): boolean =>
  !range || (range.min === undefined && range.max === undefined && range.includeMissing !== false);

/**
 * Whether a cell passes a bound. Both bounds are inclusive. A cell that holds no number —
 * blank, or text in a mostly-numeric column — is kept unless `includeMissing` is false,
 * so narrowing one field does not silently drop tokens that were never measured on it.
 */
export const withinRange = (raw: string, range: NumericRange): boolean => {
  const value = parseNumericCell(raw);
  if (isNaN(value)) return range.includeMissing !== false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
};
