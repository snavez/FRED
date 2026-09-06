import { describe, it, expect } from 'vitest';
import {
  filterFieldKey,
  filterFieldLabel,
  isFilterField,
  isVisibleFilterField,
  listFilterFields,
  listNumericFields,
  listSidebarFields,
  filterMode,
} from './filterFields';
import type { ColumnMapping, DatasetMeta } from '../types';

const meta = (columnMappings: ColumnMapping[]): DatasetMeta =>
  ({ fileName: 'x', columnMappings, timePoints: [], rowCount: 1 });

describe('filterFieldKey', () => {
  it('gives special roles their canonical keys', () => {
    expect(filterFieldKey({ csvHeader: 'spk', role: 'speaker' })).toBe('speaker');
    expect(filterFieldKey({ csvHeader: 'filename', role: 'file_id' })).toBe('file_id');
  });

  it('keys other columns by display name, falling back to the header', () => {
    expect(filterFieldKey({ csvHeader: 'MAU', role: 'field', fieldName: 'phoneme' })).toBe('phoneme');
    expect(filterFieldKey({ csvHeader: 'MAU_dur', role: 'duration' })).toBe('MAU_dur');
  });

  it('has no key for columns that are not labels', () => {
    expect(filterFieldKey({ csvHeader: 'F1_50%', role: 'formant' })).toBeNull();
    expect(filterFieldKey({ csvHeader: 'junk', role: 'ignore' })).toBeNull();
    expect(filterFieldKey({ csvHeader: 'id', role: 'token_id' })).toBeNull();
    expect(filterFieldKey({ csvHeader: 't', role: 'timepoint' })).toBeNull();
  });
});

describe('isFilterField', () => {
  it('accepts label columns', () => {
    expect(isFilterField({ csvHeader: 'word', role: 'field', fieldName: 'word', isDataField: false })).toBe(true);
    // No flags at all: a plain column is a label until told otherwise
    expect(isFilterField({ csvHeader: 'word', role: 'field', fieldName: 'word' })).toBe(true);
  });

  it('rejects measures — a data column is not a filter', () => {
    // The reported bug: a duration column confirmed as Data still appeared in the sidebar
    expect(isFilterField({ csvHeader: 'MAU_dur', role: 'duration', isDataField: true })).toBe(false);
    expect(isFilterField({ csvHeader: 'COG_50%', role: 'spectral_cog', fieldName: 'COG_50%', isDataField: true })).toBe(false);
  });

  it('accepts a measure the user explicitly asked to see', () => {
    expect(isFilterField({ csvHeader: 'MAU_dur', role: 'duration', isDataField: true, showInSidebar: true })).toBe(true);
  });

  it('separates being a label from being listed', () => {
    const hidden: ColumnMapping = { csvHeader: 'word', role: 'field', fieldName: 'word', showInSidebar: false };
    expect(isFilterField(hidden)).toBe(true);
    expect(isVisibleFilterField(hidden)).toBe(false);
  });
});

describe('listFilterFields', () => {
  const dataset = meta([
    { csvHeader: 'filename', role: 'file_id', showInSidebar: true },
    { csvHeader: 'MAU', role: 'field', fieldName: 'MAU', isDataField: false },
    { csvHeader: 'voice_pitch', role: 'field', fieldName: 'voice_pitch', isDataField: false },
    { csvHeader: 'hidden_note', role: 'field', fieldName: 'hidden_note', showInSidebar: false },
    { csvHeader: 'MAU_dur', role: 'duration', fieldName: 'MAU_dur', isDataField: true },
    { csvHeader: 'F1_50%', role: 'formant', formant: 'f1', timePoint: 50 },
    { csvHeader: 'dupe', role: 'field', fieldName: 'MAU' },
  ]);

  it('lists the visible labels, de-duplicated and in column order', () => {
    expect(listFilterFields(dataset).map(f => f.key)).toEqual(['file_id', 'MAU', 'voice_pitch']);
  });

  it('lists hidden labels too when asked, with their visibility', () => {
    const all = listFilterFields(dataset, 'all');
    expect(all.map(f => f.key)).toEqual(['file_id', 'MAU', 'voice_pitch', 'hidden_note']);
    expect(all.find(f => f.key === 'hidden_note')?.visible).toBe(false);
  });

  it('never lists measures or formants', () => {
    const keys = listFilterFields(dataset, 'all').map(f => f.key);
    expect(keys).not.toContain('MAU_dur');
    expect(keys).not.toContain('F1_50%');
  });

  it('returns nothing without a dataset', () => {
    expect(listFilterFields(null)).toEqual([]);
  });
});

describe('filterFieldLabel', () => {
  it('names the special roles', () => {
    expect(filterFieldLabel('speaker')).toBe('Speaker');
    expect(filterFieldLabel('file_id')).toBe('File ID');
    expect(filterFieldLabel('duration')).toBe('Duration');
  });

  it('prefers the name the user assigned in the mapping dialog', () => {
    const dataset = meta([{ csvHeader: 'MAU', role: 'field', fieldName: 'phoneme' }]);
    expect(filterFieldLabel('phoneme', dataset)).toBe('phoneme');
  });

  it('title-cases a raw column name otherwise', () => {
    expect(filterFieldLabel('voice_pitch')).toBe('Voice Pitch');
  });
});

const stats = (over: Partial<{ min: number; max: number; count: number; distinct: number }> = {}) =>
  ({ min: 12, max: 96, count: 400, distinct: 40, ...over });

describe('filterMode', () => {
  it('gives text a list, whatever else is set', () => {
    expect(filterMode({ csvHeader: 'MAU', role: 'field', fieldName: 'MAU' })).toBe('list');
  });

  it('bounds a column with more distinct values than you would pick from', () => {
    expect(filterMode({ csvHeader: 'dur', role: 'field', numeric: stats() })).toBe('range');
  });

  it('lists a handful of numeric codes', () => {
    expect(filterMode({ csvHeader: 'block', role: 'field', numeric: stats({ distinct: 3 }) })).toBe('list');
  });

  it('does not care whether the column was classified Filter or Data', () => {
    const asFilter = { csvHeader: 'score', role: 'field' as const, numeric: stats(), isDataField: false };
    const asData = { ...asFilter, isDataField: true, showInSidebar: true };
    expect(filterMode(asFilter)).toBe('range');
    expect(filterMode(asData)).toBe('range');
  });

  it('honours an explicit override in both directions', () => {
    expect(filterMode({ csvHeader: 'a', role: 'field', numeric: stats(), filterAs: 'list' })).toBe('list');
    expect(filterMode({ csvHeader: 'b', role: 'field', numeric: stats({ distinct: 3 }), filterAs: 'range' })).toBe('range');
  });
});

describe('listNumericFields', () => {
  const dataset = meta([
    { csvHeader: 'MAU', role: 'field', fieldName: 'MAU', isDataField: false },
    { csvHeader: 'release_dur', role: 'duration', fieldName: 'release_dur', isDataField: true, numeric: stats() },
    { csvHeader: 'COG_50%', role: 'spectral_cog', fieldName: 'COG_50%', isDataField: true, numeric: stats(), showInSidebar: true },
    { csvHeader: 'F1_50%', role: 'formant', formant: 'f1', timePoint: 50, numeric: stats() },
  ]);

  it('lists only the numeric fields the user has shown', () => {
    expect(listNumericFields(dataset).map(f => f.key)).toEqual(['COG_50%']);
  });

  it('lists every numeric field for the visibility popover', () => {
    expect(listNumericFields(dataset, 'all').map(f => f.key)).toEqual(['release_dur', 'COG_50%']);
  });

  it('carries the observed range, so the section header can show it', () => {
    expect(listNumericFields(dataset, 'all')[0].stats).toEqual(stats());
  });

  it('bounds a numeric column classified as Filter — the reported case', () => {
    // Classifying a column as Filter says where it appears, not how it is filtered: a
    // filter you want a threshold on is exactly the case this exists for.
    const filtered = meta([
      { csvHeader: 'score', role: 'field', fieldName: 'score', isDataField: false, numeric: stats() },
    ]);
    expect(listNumericFields(filtered).map(f => f.key)).toEqual(['score']);
    expect(listFilterFields(filtered, 'all')).toEqual([]);
  });

  it('leaves a handful of numeric codes to the value list', () => {
    const coded = meta([
      { csvHeader: 'block', role: 'field', fieldName: 'block', isDataField: false, numeric: stats({ distinct: 3 }) },
    ]);
    expect(listNumericFields(coded, 'all')).toEqual([]);
    expect(listFilterFields(coded, 'all').map(f => f.key)).toEqual(['block']);
  });

  it('is empty without a dataset', () => {
    expect(listNumericFields(null)).toEqual([]);
  });
});

describe('listSidebarFields', () => {
  const dataset = meta([
    { csvHeader: 'MAU', role: 'field', fieldName: 'MAU', isDataField: false },
    { csvHeader: 'score', role: 'field', fieldName: 'score', isDataField: false, numeric: stats() },
    { csvHeader: 'word', role: 'field', fieldName: 'word', isDataField: false },
  ]);

  it('keeps column order, so a numeric field sits among its neighbours', () => {
    expect(listSidebarFields(dataset).map(e => e.field.key)).toEqual(['MAU', 'score', 'word']);
  });

  it('tags each field with the control it gets', () => {
    expect(listSidebarFields(dataset).map(e => e.mode)).toEqual(['list', 'range', 'list']);
  });

  it('carries the range stats only on the bounded fields', () => {
    const bounded = listSidebarFields(dataset)[1];
    expect(bounded.mode === 'range' && bounded.field.stats).toEqual(stats());
  });

  it('is empty without a dataset', () => {
    expect(listSidebarFields(null)).toEqual([]);
  });
});
