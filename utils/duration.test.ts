import { describe, it, expect } from 'vitest';
import {
  durationFieldForRegion,
  getTokenDuration,
  getTokenDurationInUnit,
  listDurationFields,
} from './duration';
import type { ColumnMapping, DatasetMeta, SpeechToken } from '../types';

const meta = (columnMappings: ColumnMapping[]): DatasetMeta =>
  ({ fileName: 'x', columnMappings, timePoints: [], rowCount: 1 });

const token = (duration: number, fields: Record<string, string> = {}): SpeechToken =>
  ({ id: 't', speaker: '', file_id: 'f', xmin: 0, duration, trajectory: [], fields });

const dataset = meta([
  { csvHeader: 'MAU_dur', role: 'duration', fieldName: 'MAU_dur' },
  { csvHeader: 'closure_dur', role: 'duration', fieldName: 'closure_dur' },
  { csvHeader: 'release_dur', role: 'duration', fieldName: 'release_dur' },
  { csvHeader: 'word', role: 'field', fieldName: 'word' },
]);

describe('listDurationFields', () => {
  it('lists the duration columns in column order', () => {
    expect(listDurationFields(dataset).map(f => f.key)).toEqual(['MAU_dur', 'closure_dur', 'release_dur']);
  });

  it('is empty without a dataset', () => {
    expect(listDurationFields(null)).toEqual([]);
  });
});

describe('durationFieldForRegion', () => {
  it('picks the column that names the region', () => {
    expect(durationFieldForRegion(dataset, 'release')).toBe('release_dur');
    expect(durationFieldForRegion(dataset, 'closure')).toBe('closure_dur');
  });

  it('falls back to the token duration when nothing matches', () => {
    expect(durationFieldForRegion(dataset, 'burst')).toBe('');
    expect(durationFieldForRegion(dataset, '')).toBe('');
    expect(durationFieldForRegion(null, 'release')).toBe('');
  });
});

describe('getTokenDurationInUnit', () => {
  const t = token(0.22, { MAU_dur: '0.22', release_dur: '0.031', empty_dur: '' });

  it('reads the named column, converting to the unit asked for', () => {
    expect(getTokenDurationInUnit(t, true, 'release_dur')).toBeCloseTo(31);
    expect(getTokenDurationInUnit(t, false, 'release_dur')).toBeCloseTo(0.031);
  });

  it('recognises durations already recorded in milliseconds', () => {
    const ms = token(0, { seg_dur: '55' });
    expect(getTokenDurationInUnit(ms, true, 'seg_dur')).toBeCloseTo(55);
    expect(getTokenDurationInUnit(ms, false, 'seg_dur')).toBeCloseTo(0.055);
  });

  it('gives no duration for a token missing the named column', () => {
    // The bug this guards: a token with no release was drawn over its whole segment,
    // stretching an axis meant for releases
    expect(getTokenDurationInUnit(t, true, 'closure_dur')).toBe(0);
    expect(getTokenDurationInUnit(t, true, 'empty_dur')).toBe(0);
    expect(getTokenDurationInUnit(t, true, 'nonexistent')).toBe(0);
  });

  it('uses the token’s own duration when no column is named', () => {
    expect(getTokenDurationInUnit(t, true)).toBeCloseTo(220);
    expect(getTokenDurationInUnit(t, false)).toBeCloseTo(0.22);
  });

  it('prefers the native extraction range when the token carries one', () => {
    const tracked: SpeechToken = { ...token(0.22), trajectoryDurationMs: 180 };
    expect(getTokenDurationInUnit(tracked, true)).toBe(180);
    expect(getTokenDurationInUnit(tracked, false)).toBeCloseTo(0.18);
  });
});

describe('getTokenDuration', () => {
  it('prefers the token duration', () => {
    expect(getTokenDuration(token(0.15, { vowel_dur: '0.3' }))).toBeCloseTo(0.15);
  });

  it('falls back to a duration-like field', () => {
    expect(getTokenDuration(token(0, { vowel_dur: '0.3' }))).toBeCloseTo(0.3);
    expect(getTokenDuration(token(0, { duration: '0.4' }))).toBeCloseTo(0.4);
  });

  it('is zero when the token has no duration at all', () => {
    expect(getTokenDuration(token(0, { word: 'kite' }))).toBe(0);
  });
});
