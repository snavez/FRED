import { ColumnMapping, DatasetMeta, NumericColumnStats } from '../types';
import { numericFieldKey } from './numericFields';

/**
 * Which columns are *labels* — the fields you filter by in the sidebar and group by in
 * the Colour / Shape / Group encodings — as opposed to *measures*, the numeric values a
 * plot draws. One rule, used by the sidebar, the field-visibility popover and the
 * encoding menus, so a field visible in the sidebar is always offered as an encoding.
 *
 * Two flags on a mapping decide it, both set by the Data Mapping dialog's Filter/Data
 * toggle: `isDataField` says it is a measure, `showInSidebar` says whether it is listed.
 * A measure is a label only when the user explicitly asks for it (`showInSidebar: true`).
 */

/** The key a column is filtered and grouped by, or null when it is not a label at all. */
export const filterFieldKey = (m: ColumnMapping): string | null => {
  if (m.role === 'speaker') return 'speaker';
  if (m.role === 'file_id') return 'file_id';
  if (m.role === 'ignore' || m.role === 'formant' || m.role === 'token_id' || m.role === 'timepoint') return null;
  return m.fieldName || m.csvHeader || null;
};

/**
 * Whether a column can act as a label. Measures qualify only when explicitly shown, and a
 * measure of *numbers* never does: it is filtered by bounds instead (see
 * `listNumericFields`), so showing it must not turn it back into a list of values.
 */
export const isFilterField = (m: ColumnMapping): boolean =>
  filterFieldKey(m) !== null && !(m.numeric && m.isDataField)
  && (m.showInSidebar === true || !m.isDataField);

/** Whether a label is currently listed in the sidebar. */
export const isVisibleFilterField = (m: ColumnMapping): boolean =>
  isFilterField(m) && m.showInSidebar !== false;

/** Display name for a field key, honouring names the user assigned in the mapping dialog. */
export const filterFieldLabel = (key: string, meta?: DatasetMeta | null): string => {
  // Special roles always get their standard display name — avoids confusion
  // when both speaker and file_id are mapped to the same CSV column
  if (key === 'speaker') return 'Speaker';
  if (key === 'file_id') return 'File ID';
  if (key === 'duration') return 'Duration';
  if (meta) {
    for (const m of meta.columnMappings) {
      if (m.fieldName === key && m.role !== 'formant') return m.fieldName;
    }
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

/** One filterable field: the key tokens are read by, its display name, and its visibility. */
export interface FilterField {
  key: string;
  label: string;
  visible: boolean;
}

/** A field of measurements, filtered by bounds rather than by picking values. */
export interface NumericFilterField extends FilterField {
  stats: NumericColumnStats;
}

/**
 * The dataset's label fields, de-duplicated and in column order.
 * `scope: 'visible'` returns only those listed in the sidebar (what the encoding menus
 * offer); `'all'` returns every label, which is what the visibility popover lists.
 */
export const listFilterFields = (
  meta: DatasetMeta | null, scope: 'visible' | 'all' = 'visible',
): FilterField[] => {
  if (!meta) return [];
  const fields: FilterField[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    if (!isFilterField(m)) continue;
    const key = filterFieldKey(m);
    if (!key || seen.has(key)) continue;
    const visible = isVisibleFilterField(m);
    if (scope === 'visible' && !visible) continue;
    seen.add(key);
    fields.push({ key, label: filterFieldLabel(key, meta), visible });
  }
  return fields;
};

/**
 * The dataset's numeric fields — those filtered by a range rather than a value list.
 *
 * A column qualifies once import has measured it as numeric; label fields are excluded
 * even when their values happen to be numbers, because picking `1`, `2`, `5` off a list is
 * the better control for a handful of discrete codes. Kept apart from `listFilterFields`
 * so the encoding menus, which want categories, never offer a continuous measure.
 */
export const listNumericFields = (
  meta: DatasetMeta | null, scope: 'visible' | 'all' = 'visible',
): NumericFilterField[] => {
  if (!meta) return [];
  const fields: NumericFilterField[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    if (!m.numeric || !m.isDataField) continue;
    const key = numericFieldKey(m);
    if (!key || seen.has(key)) continue;
    const visible = m.showInSidebar === true;
    if (scope === 'visible' && !visible) continue;
    seen.add(key);
    fields.push({ key, label: filterFieldLabel(key, meta), visible, stats: m.numeric });
  }
  return fields;
};

/**
 * Fields that identify a token: what you would need to find it again in the recording —
 * the file, the speaker, the word, the segment, its duration. Wider than the label
 * fields, because a measure such as duration is useful for telling two tokens apart, but
 * narrower than every column: formants and the other plotted values describe a token
 * rather than name it. Used by the Point Info selector and by the outlier export.
 */
export const listPointFields = (meta: DatasetMeta | null): FilterField[] => {
  if (!meta) return [];
  const fields: FilterField[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    const key = m.role === 'duration' ? 'duration' : filterFieldKey(m);
    if (!key || m.role === 'ignore') continue;
    // Case-insensitive dedup, so 'file_id' and 'File_ID' do not both appear
    const dedup = key.toLowerCase().trim();
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    fields.push({ key, label: filterFieldLabel(key, meta), visible: isVisibleFilterField(m) });
  }
  return fields;
};
