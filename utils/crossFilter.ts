import { FilterState, SpeechToken, UNDEFINED_LABEL } from '../types';
import { getLabel } from './getLabel';
import { isOpenRange, withinRange } from './numericFields';

/**
 * The values each filter field still offers, given every *other* filter.
 *
 * This is what makes the sidebar a faceted search: narrowing one field narrows the
 * choices in the rest, while the field you are working in keeps offering everything it
 * could still show, so a selection is never a one-way door.
 *
 * Answered in a single pass over the tokens. A token belongs in field X's list exactly
 * when the only filter it fails is X's own — fail nothing and it belongs in every list,
 * fail two and it belongs in none — so counting each token's failures decides every field
 * at once. Re-filtering the whole dataset once per field is the obvious reading of the
 * same rule and costs `fields × fields × tokens`: a second and a half on a
 * nine-thousand-token set with thirty fields, paid on every filter change.
 *
 * An empty selection needs no special case. Nothing satisfies it, so every token fails
 * that field; every other list comes back empty, and that field still offers its own
 * values so you can pick one again.
 */
export const crossFilterOptions = (
  tokens: SpeechToken[],
  keys: string[],
  filters: FilterState,
): Record<string, string[]> => {
  const sets: Record<string, Set<string>> = {};
  for (const key of keys) sets[key] = new Set();

  const valueFilters = Object.entries(filters.filters || {})
    .filter(([, values]) => Array.isArray(values))
    .map(([key, values]) => ({ key, set: new Set<string>(values) }));
  // Bounds are never the field being listed — a bounded field has no value list — so a
  // token outside them is out of every list.
  const rangeFilters = Object.entries(filters.ranges || {}).filter(([, r]) => !isOpenRange(r));

  const labelOf = (token: SpeechToken, key: string) => {
    const raw = getLabel(token, key);
    return raw === '' ? UNDEFINED_LABEL : raw;
  };

  for (const token of tokens) {
    if (!rangeFilters.every(([key, range]) => withinRange(getLabel(token, key), range))) continue;

    let failed: string | null = null;
    let failedTwice = false;
    for (const { key, set } of valueFilters) {
      if (set.has(labelOf(token, key))) continue;
      if (failed !== null) { failedTwice = true; break; }
      failed = key;
    }
    if (failedTwice) continue;

    if (failed === null) for (const key of keys) sets[key].add(labelOf(token, key));
    else if (sets[failed]) sets[failed].add(labelOf(token, failed));
  }

  const result: Record<string, string[]> = {};
  for (const key of keys) {
    result[key] = [...sets[key]].sort((a, b) => {
      if (a === UNDEFINED_LABEL) return 1;
      if (b === UNDEFINED_LABEL) return -1;
      return a.localeCompare(b);
    });
  }
  return result;
};
