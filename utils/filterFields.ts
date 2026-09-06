import { ColumnMapping, DatasetMeta, NumericColumnStats } from '../types';

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
 * Whether a column can be filtered at all — that is, whether the visibility popover offers
 * it. Labels always qualify. A measure qualifies once explicitly shown, or as soon as it
 * holds numbers, since bounding a measure is a reasonable thing to want; a measure of text
 * stays out until asked for, so a wide dataset does not fill the popover with columns
 * nobody filters on.
 */
export const isFilterField = (m: ColumnMapping): boolean =>
  filterFieldKey(m) !== null
  && (!m.isDataField || m.showInSidebar === true || m.numeric !== undefined);

/**
 * Whether a filterable column is currently listed in the sidebar. Labels are listed unless
 * hidden; measures stay hidden until shown, so an unset flag on a measure means hidden
 * rather than relying on import to have written one.
 */
export const isVisibleFilterField = (m: ColumnMapping): boolean =>
  isFilterField(m) && (m.isDataField ? m.showInSidebar === true : m.showInSidebar !== false);

/** Above this many distinct values, a column of numbers is a measure rather than a code. */
const LIST_MAX_DISTINCT = 12;

/**
 * Which control a filterable column gets: a list of its values, or a pair of bounds.
 *
 * This follows from what the column *holds*, not from whether it was classified Filter or
 * Data — that classification decides where a column appears, and a column can very
 * reasonably be a filter you want thresholds on. Text is always a list. A column of
 * numbers is bounded once it holds more distinct values than you would want to pick from,
 * and `filterAs` overrides the guess either way.
 */
export const filterMode = (m: ColumnMapping): 'list' | 'range' => {
  if (!m.numeric) return 'list';
  if (m.filterAs) return m.filterAs;
  return m.numeric.distinct > LIST_MAX_DISTINCT ? 'range' : 'list';
};

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
    if (!isFilterField(m) || filterMode(m) !== 'list') continue;
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
 * A column qualifies once import has measured it as numeric and `filterMode` puts it in
 * range mode — whether it was classified Filter or Data. Kept apart from
 * `listFilterFields` so the encoding menus, which want categories, never offer a
 * continuous measure; a numeric column left in list mode stays on that side.
 */
export const listNumericFields = (
  meta: DatasetMeta | null, scope: 'visible' | 'all' = 'visible',
): NumericFilterField[] => {
  if (!meta) return [];
  const fields: NumericFilterField[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    if (!isFilterField(m) || filterMode(m) !== 'range' || !m.numeric) continue;
    const key = filterFieldKey(m);
    if (!key || seen.has(key)) continue;
    const visible = isVisibleFilterField(m);
    if (scope === 'visible' && !visible) continue;
    seen.add(key);
    fields.push({ key, label: filterFieldLabel(key, meta), visible, stats: m.numeric });
  }
  return fields;
};

/** One sidebar section: a field, and the control it gets. */
export type SidebarField =
  | { mode: 'list'; field: FilterField }
  | { mode: 'range'; field: NumericFilterField };

/**
 * Every filterable field in **column order**, each tagged with the control it gets.
 *
 * The sidebar and the field-visibility popover both read this, so a numeric field sits
 * among its neighbours rather than in a separate pile at the end — a section is where the
 * column is, whether you pick its values or bound them.
 */
export const listSidebarFields = (
  meta: DatasetMeta | null, scope: 'visible' | 'all' = 'visible',
): SidebarField[] => {
  if (!meta) return [];
  const fields: SidebarField[] = [];
  const seen = new Set<string>();
  for (const m of meta.columnMappings) {
    if (!isFilterField(m)) continue;
    const key = filterFieldKey(m);
    if (!key || seen.has(key)) continue;
    const visible = isVisibleFilterField(m);
    if (scope === 'visible' && !visible) continue;
    seen.add(key);
    const field = { key, label: filterFieldLabel(key, meta), visible };
    fields.push(m.numeric && filterMode(m) === 'range'
      ? { mode: 'range', field: { ...field, stats: m.numeric } }
      : { mode: 'list', field });
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
