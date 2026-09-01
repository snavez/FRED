import { describe, it, expect } from 'vitest';
import {
  formantMeasureKeys,
  isFormantMeasure,
  listNumericMeasures,
  measureLabel,
  measureValue,
} from './measures';
import type { ColumnMapping, DatasetMeta, SpeechToken, TrajectoryPoint } from '../types';

const meta = (columnMappings: ColumnMapping[], extra: Partial<DatasetMeta> = {}): DatasetMeta =>
  ({ fileName: 'x', columnMappings, timePoints: [], rowCount: 1, ...extra });

const point = (time: number, f1: number, f2: number): TrajectoryPoint =>
  ({ time, f1, f2, f3: 0, f1_smooth: f1 + 5, f2_smooth: f2 + 5, f3_smooth: 0 });

const token = (fields: Record<string, string> = {}): SpeechToken => ({
  id: 't', speaker: 's', file_id: 'f.wav', xmin: 1.25, duration: 0.18,
  trajectory: [point(0, 400, 1800), point(50, 500, 1500), point(100, 600, 1200)],
  fields,
});

describe('listNumericMeasures', () => {
  const dataset = meta([
    { csvHeader: 'MAU', role: 'field', fieldName: 'MAU', isDataField: false },
    { csvHeader: 'MAU_dur', role: 'duration', fieldName: 'MAU_dur', isDataField: true },
    { csvHeader: 'voice_pitch', role: 'pitch', fieldName: 'voice_pitch', isDataField: true },
    { csvHeader: 'COG_release_50%', role: 'spectral_cog', fieldName: 'COG_release_50%', isDataField: true },
    { csvHeader: 'xmax', role: 'field', fieldName: 'xmax', isDataField: true },
    { csvHeader: 'F1_50%', role: 'formant', formant: 'f1', timePoint: 50 },
    { csvHeader: 'F2_50%', role: 'formant', formant: 'f2', timePoint: 50 },
    { csvHeader: 'junk', role: 'ignore' },
  ]);

  it('offers every numeric column, token duration first', () => {
    expect(listNumericMeasures(dataset).map(m => m.key)).toEqual([
      'duration', 'MAU_dur', 'voice_pitch', 'COG_release_50%', 'xmax', 'f1', 'f2',
    ]);
  });

  it('leaves out labels and ignored columns', () => {
    const keys = listNumericMeasures(dataset).map(m => m.key);
    expect(keys).not.toContain('MAU');
    expect(keys).not.toContain('junk');
  });

  it('always offers token duration, even with no dataset', () => {
    expect(listNumericMeasures(null)).toEqual([{ key: 'duration', label: 'Duration' }]);
  });

  it('reports which measures need a timepoint', () => {
    expect(formantMeasureKeys(dataset)).toEqual(new Set(['f1', 'f2']));
    expect(isFormantMeasure('f1')).toBe(true);
    expect(isFormantMeasure('MAU_dur')).toBe(false);
  });
});

describe('measureValue', () => {
  it('reads the token duration and onset', () => {
    expect(measureValue(token(), 'duration')).toBeCloseTo(0.18);
    expect(measureValue(token(), 'xmin')).toBeCloseTo(1.25);
  });

  it('reads a formant at the requested timepoint', () => {
    expect(measureValue(token(), 'f1', 0)).toBe(400);
    expect(measureValue(token(), 'f1', 100)).toBe(600);
    expect(measureValue(token(), 'f2', 50)).toBe(1500);
    expect(measureValue(token(), 'f1_smooth', 50)).toBe(505);
  });

  it('falls back to the nearest timepoint the token carries', () => {
    expect(measureValue(token(), 'f1', 60)).toBe(500);
  });

  it('reads a numeric field from the token', () => {
    expect(measureValue(token({ 'COG_release_50%': '3200.5' }), 'COG_release_50%')).toBeCloseTo(3200.5);
  });

  it('returns NaN rather than guessing', () => {
    expect(measureValue(token(), 'nope')).toBeNaN();
    expect(measureValue(token({ x: '' }), 'x')).toBeNaN();
    expect(measureValue(token({ x: 'high' }), 'x')).toBeNaN();
    expect(measureValue(token(), '')).toBeNaN();
    const noTrajectory = { ...token(), trajectory: [] };
    expect(measureValue(noTrajectory, 'f1', 50)).toBeNaN();
  });
});

describe('measureLabel', () => {
  const dataset = meta(
    [{ csvHeader: 'COG_release_50%', role: 'spectral_cog', fieldName: 'COG_release_50%' }],
    { timePointLabels: { 50: 'midpoint' } },
  );

  it('names the axis for each kind of measure', () => {
    expect(measureLabel('duration', undefined, null)).toBe('Duration (s)');
    expect(measureLabel('f1', 20, null)).toBe('F1 @ 20% (Hz)');
    expect(measureLabel('f2_smooth', 80, null)).toBe('F2 (smooth) @ 80% (Hz)');
    expect(measureLabel('COG_release_50%', undefined, dataset)).toBe('COG_release_50%');
  });

  it('uses the timepoint labels the dataset defines', () => {
    expect(measureLabel('f1', 50, dataset)).toBe('F1 @ midpoint (Hz)');
  });

  it('title-cases an unmapped column name', () => {
    expect(measureLabel('release_dur', undefined, null)).toBe('Release Dur');
  });
});
