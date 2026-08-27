import { describe, it, expect } from 'vitest';
import {
  filterFieldKey,
  filterFieldLabel,
  isFilterField,
  isVisibleFilterField,
  listFilterFields,
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
