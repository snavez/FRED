import { describe, it, expect } from 'vitest';
import { ColumnMapping, SpeechToken } from '../types';
import {
  isOpenRange,
  measureNumericColumn,
  measureNumericColumns,
  numericFieldKey,
  parseNumericCell,
  withinRange,
} from './numericFields';

/** A token carrying only the fields a test needs. */
const tok = (fields: Record<string, string>): SpeechToken =>
  ({ speaker: 's1', file_id: 'f1', trajectory: [], fields } as unknown as SpeechToken);

const column = (values: string[]): SpeechToken[] => values.map(v => tok({ release_dur: v }));

describe('parseNumericCell', () => {
  it('reads numbers, including negatives and decimals', () => {
    expect(parseNumericCell('28.8')).toBeCloseTo(28.8);
    expect(parseNumericCell(' -4 ')).toBe(-4);
  });

  it('rejects blanks and text that merely starts with a number', () => {
    expect(isNaN(parseNumericCell(''))).toBe(true);
    expect(isNaN(parseNumericCell('   '))).toBe(true);
    expect(isNaN(parseNumericCell('12ms'))).toBe(true);
    expect(isNaN(parseNumericCell('high'))).toBe(true);
  });
});

describe('measureNumericColumn', () => {
  it('reports the range over the whole column', () => {
    expect(measureNumericColumn(column(['28.8', '57.2', '67.1']), 'release_dur'))
      .toEqual({ min: 28.8, max: 67.1, count: 3 });
  });

  it('sees a column whose first rows are all blank — the reported case', () => {
    // A release measure is empty for every unreleased token, which can be the whole head
    // of the file; a sample of the first rows would call this column empty.
    const sparse = column([...Array(200).fill(''), '31', '44', '52']);
    expect(measureNumericColumn(sparse, 'release_dur')).toEqual({ min: 31, max: 52, count: 3 });
  });

  it('tolerates a few stray non-numbers', () => {
    const stats = measureNumericColumn(column(['10', '20', '30', '40', 'n/a']), 'release_dur');
    expect(stats).toEqual({ min: 10, max: 40, count: 4 });
  });

  it('is not numeric when the values are mostly text', () => {
    expect(measureNumericColumn(column(['high', 'low', 'high', '3']), 'release_dur')).toBeNull();
  });

  it('is not numeric when the column is empty or absent', () => {
    expect(measureNumericColumn(column(['', '', '']), 'release_dur')).toBeNull();
    expect(measureNumericColumn(column(['10', '20']), 'no_such_field')).toBeNull();
  });
});

describe('numericFieldKey', () => {
  it('names measure and label columns by their field name', () => {
    expect(numericFieldKey({ csvHeader: 'release_dur', role: 'duration', fieldName: 'release_dur' })).toBe('release_dur');
    expect(numericFieldKey({ csvHeader: 'COG_50%', role: 'spectral_cog', fieldName: 'COG_50%' })).toBe('COG_50%');
  });

  it('has no key for columns that are not one number per token', () => {
    expect(numericFieldKey({ csvHeader: 'F1_50%', role: 'formant' })).toBeNull();
    expect(numericFieldKey({ csvHeader: 'junk', role: 'ignore' })).toBeNull();
    expect(numericFieldKey({ csvHeader: 'tok', role: 'token_id' })).toBeNull();
  });
});

describe('measureNumericColumns', () => {
  it('marks the numeric columns and leaves the rest alone', () => {
    const tokens = [tok({ release_dur: '30', place: 'alveolar' }), tok({ release_dur: '60', place: 'velar' })];
    const mappings: ColumnMapping[] = [
      { csvHeader: 'release_dur', role: 'duration', fieldName: 'release_dur' },
      { csvHeader: 'place', role: 'field', fieldName: 'place' },
    ];
    const measured = measureNumericColumns(tokens, mappings);
    expect(measured[0].numeric).toEqual({ min: 30, max: 60, count: 2 });
    expect(measured[1].numeric).toBeUndefined();
  });
});

describe('withinRange', () => {
  it('treats both bounds as inclusive', () => {
    expect(withinRange('20', { min: 20, max: 40 })).toBe(true);
    expect(withinRange('40', { min: 20, max: 40 })).toBe(true);
    expect(withinRange('19.9', { min: 20, max: 40 })).toBe(false);
    expect(withinRange('40.1', { min: 20, max: 40 })).toBe(false);
  });

  it('leaves the other side open when only one bound is set', () => {
    expect(withinRange('5000', { min: 20 })).toBe(true);
    expect(withinRange('1', { min: 20 })).toBe(false);
    expect(withinRange('-99', { max: 40 })).toBe(true);
    expect(withinRange('41', { max: 40 })).toBe(false);
  });

  it('keeps unmeasured tokens unless asked not to', () => {
    expect(withinRange('', { min: 20 })).toBe(true);
    expect(withinRange('n/a', { min: 20 })).toBe(true);
    expect(withinRange('', { min: 20, includeMissing: false })).toBe(false);
  });
});

describe('isOpenRange', () => {
  it('is open with no bounds set', () => {
    expect(isOpenRange(undefined)).toBe(true);
    expect(isOpenRange({})).toBe(true);
  });

  it('is closed once a bound or a missing-value rule is set', () => {
    expect(isOpenRange({ min: 20 })).toBe(false);
    expect(isOpenRange({ max: 40 })).toBe(false);
    expect(isOpenRange({ includeMissing: false })).toBe(false);
  });
});
