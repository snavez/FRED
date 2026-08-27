import { ColumnMapping, DatasetMeta } from '../types';

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

/** Whether a column can act as a label. Measures qualify only when explicitly shown. */
export const isFilterField = (m: ColumnMapping): boolean =>
  filterFieldKey(m) !== null && (m.showInSidebar === true || !m.isDataField);

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

/** One label field: the key tokens are read by, its display name, and its visibility. */
export interface FilterField {
  key: string;
  label: string;
  visible: boolean;
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
