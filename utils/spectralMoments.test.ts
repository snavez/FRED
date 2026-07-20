import { describe, it, expect } from 'vitest';
import {
  discoverSpectralMoments,
  formatSpectralFeature,
  getSpectralCoeffValue,
  getSpectralFeatureValue,
  getSpectralTrack,
  getSpectralTrackValue,
  getSpectralValue,
  listSpectralFeatures,
  nearestSpectralTimePoint,
  parseSpectralColumn,
  parseSpectralFeature,
  parseSpectralTimePointSuffix,
  resolveSpectralFeature,
  spectralAxisLabel,
  spectralColumnBaseName,
  spectralColumnChip,
  spectralFeatureLabel,
  spectralRoleTimePoint,
} from './spectralMoments';
import type { SpeechToken } from '../types';

function tok(fields: Record<string, string>): SpeechToken {
  return {
    id: 't', speaker: '', file_id: '', xmin: 0, duration: 0,
    trajectory: [], fields,
  };
}

const consonantFields = {
  'COG_20%': '510.4', 'SD_20%': '425.4', 'skew_20%': '13.96', 'kurt_20%': '198.9',
  'COG_50%': '558.8', 'SD_50%': '349.6', 'skew_50%': '9.81', 'kurt_50%': '131.6',
  'COG_80%': '501.6', 'SD_80%': '280.9', 'skew_80%': '14.04', 'kurt_80%': '244.3',
  'allophone': 't', 'Target': 't0',
};

describe('discoverSpectralMoments', () => {
  it('discovers all four moments and three timepoints from %-suffixed headers', () => {
    const meta = discoverSpectralMoments([tok(consonantFields)]);
    expect(meta.available).toBe(true);
    expect(meta.moments.map(m => m.key)).toEqual(['COG', 'SD', 'skew', 'kurt']);
    expect(meta.timePoints).toEqual([20, 50, 80]);
  });

  it('recognises alternative moment names (kurtosis, spread)', () => {
    const meta = discoverSpectralMoments([tok({ 'centroid_50': '600', 'kurtosis_50': '3.2' })]);
    expect(meta.moments.map(m => m.key)).toEqual(['COG', 'kurt']);
    expect(meta.timePoints).toEqual([50]);
  });

  it('is not available when no moment columns exist', () => {
    const meta = discoverSpectralMoments([tok({ word: 'hi', f1: '500' })]);
    expect(meta.available).toBe(false);
    expect(meta.moments).toEqual([]);
  });

  it('only reports moments actually present (partial datasets)', () => {
    const meta = discoverSpectralMoments([tok({ 'COG_50%': '600', 'SD_50%': '300' })]);
    expect(meta.moments.map(m => m.key)).toEqual(['COG', 'SD']);
  });

  it('prefers dataset meta column mappings when supplied', () => {
    const meta = discoverSpectralMoments([tok({})], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'COG_50%', role: 'field', fieldName: 'COG_50%' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(true);
    expect(meta.moments.map(m => m.key)).toEqual(['COG']);
  });

  it('discovers arbitrarily-named columns via explicit spectral roles', () => {
    const fields = { 'sibilance_centre': '5100', 'noise_width_20': '800' };
    const meta = discoverSpectralMoments([tok(fields)], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'sibilance_centre', role: 'spectral_cog', fieldName: 'sibilance_centre' },
        { csvHeader: 'noise_width_20', role: 'spectral_sd', fieldName: 'noise_width_20' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(true);
    expect(meta.moments.map(m => m.key)).toEqual(['COG', 'SD']);
    // No timepoint suffix → midpoint default (50); suffixed → parsed (20)
    expect(meta.timePoints).toEqual([20, 50]);
    expect(getSpectralValue(tok(fields), meta, 'COG', 50)).toBeCloseTo(5100);
    expect(getSpectralValue(tok(fields), meta, 'SD', 20)).toBeCloseTo(800);
  });

  it('role mappings take precedence over the header-pattern scan for the same slot', () => {
    const fields = { 'my_cog': '4000', 'COG_50%': '9999' };
    const meta = discoverSpectralMoments([tok(fields)], {
      fileName: 'x', columnMappings: [
        // Only my_cog is mapped to the spectral role; COG_50% is a plain field
        { csvHeader: 'my_cog', role: 'spectral_cog', fieldName: 'my_cog' },
        { csvHeader: 'COG_50%', role: 'field', fieldName: 'COG_50%' },
      ], timePoints: [], rowCount: 1,
    });
    // Both resolve to COG@50 — the explicit role mapping wins
    expect(getSpectralValue(tok(fields), meta, 'COG', 50)).toBeCloseTo(4000);
  });

  it('ignored spectral-named columns are not resurrected by the meta scan', () => {
    // Column exists in mapping as 'ignore' and is absent from token fields
    const meta = discoverSpectralMoments([tok({ word: 'hi' })], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'COG_50%', role: 'ignore' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(false);
  });
});

describe('tracks and coefficients', () => {
  // Mirrors the real export format: %-points, an 11-sample track, 4 DCT coefficients.
  const trackFields: Record<string, string> = {
    'COG_20%': '502.4', 'COG_50%': '539.6', 'COG_80%': '506.6',
    'COG_k0': '1620.84', 'COG_k1': '-44.13', 'COG_k2': '9.52', 'COG_k3': '-29.86',
    'SD_k0': '1568.90', 'SD_k1': '-31.25', 'SD_k2': '62.35', 'SD_k3': '-1.00',
    // QA metadata that must never be mistaken for a moment
    'winms_20%': '23.4', 'nsamples_20%': '374', 'winsource_20%': 'proportional',
  };
  for (let i = 0; i <= 10; i++) trackFields[`COG_t${i}`] = `${400 + i * 10}`;
  for (let i = 0; i <= 10; i++) trackFields[`SD_t${i}`] = `${300 + i * 5}`;
  const meta = discoverSpectralMoments([tok(trackFields)]);

  it('keeps point, track and coefficient columns in separate buckets', () => {
    expect(meta.moments.map(m => m.key)).toEqual(['COG']);
    expect(meta.timePoints).toEqual([20, 50, 80]);
    expect(meta.trackMoments.map(m => m.key)).toEqual(['COG', 'SD']);
    expect(meta.coeffMoments.map(m => m.key)).toEqual(['COG', 'SD']);
  });

  it('discovers grid lengths from the data rather than assuming them', () => {
    expect(meta.trackIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(meta.coeffIndices).toEqual([0, 1, 2, 3]);
  });

  it('handles a different grid length without code changes', () => {
    const short: Record<string, string> = {};
    for (let i = 0; i <= 4; i++) short[`COG_t${i}`] = `${i}`;
    for (let i = 0; i <= 5; i++) short[`COG_k${i}`] = `${i}`;
    const m2 = discoverSpectralMoments([tok(short)]);
    expect(m2.trackIndices).toEqual([0, 1, 2, 3, 4]);
    expect(m2.coeffIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(m2.available).toBe(true);
  });

  it('extracts track and coefficient values', () => {
    const t = tok(trackFields);
    expect(getSpectralTrackValue(t, meta, 'COG', 0)).toBeCloseTo(400);
    expect(getSpectralTrackValue(t, meta, 'COG', 10)).toBeCloseTo(500);
    expect(getSpectralCoeffValue(t, meta, 'COG', 1)).toBeCloseTo(-44.13);
    expect(getSpectralCoeffValue(t, meta, 'SD', 2)).toBeCloseTo(62.35);
  });

  it('returns a whole track in grid order', () => {
    const track = getSpectralTrack(tok(trackFields), meta, 'COG');
    expect(track).toHaveLength(11);
    expect(track[0]).toBeCloseTo(400);
    expect(track[10]).toBeCloseTo(500);
  });

  it('does not treat analysis metadata as a moment', () => {
    // winms/nsamples/winsource share the _20% suffix but are not moment synonyms
    expect(getSpectralValue(tok(trackFields), meta, 'COG', 20)).toBeCloseTo(502.4);
    expect(meta.moments.map(m => m.key)).not.toContain('SD');
  });

  it('is available from tracks or coefficients alone (no %-points)', () => {
    const only = discoverSpectralMoments([tok({ 'COG_t0': '1', 'COG_t1': '2' })]);
    expect(only.available).toBe(true);
    expect(only.moments).toEqual([]);
    expect(only.trackMoments.map(m => m.key)).toEqual(['COG']);
  });
});

describe('spectral features', () => {
  const fields: Record<string, string> = {
    'COG_50%': '5000', 'SD_50%': '800', 'COG_k0': '19197.9', 'COG_k1': '1126.2',
  };
  const meta = discoverSpectralMoments([tok(fields)]);

  it('lists points then coefficients', () => {
    expect(listSpectralFeatures(meta).map(formatSpectralFeature))
      .toEqual(['COG@50', 'SD@50', 'COG~k0', 'COG~k1']);
  });

  it('round-trips feature refs', () => {
    expect(parseSpectralFeature('COG~k1')).toEqual({ moment: 'COG', kind: 'coeff', index: 1 });
    expect(parseSpectralFeature('COG@50')).toEqual({ moment: 'COG', kind: 'point', index: 50 });
    expect(parseSpectralFeature('nonsense')).toBeNull();
  });

  it('reads values for both feature kinds', () => {
    const t = tok(fields);
    expect(getSpectralFeatureValue(t, meta, { moment: 'COG', kind: 'point', index: 50 })).toBeCloseTo(5000);
    expect(getSpectralFeatureValue(t, meta, { moment: 'COG', kind: 'coeff', index: 1 })).toBeCloseTo(1126.2);
  });

  it('falls back when a stored ref refers to an absent column', () => {
    expect(formatSpectralFeature(resolveSpectralFeature('kurt~k9', meta)!)).toBe('COG@50');
    expect(formatSpectralFeature(resolveSpectralFeature('COG~k1', meta)!)).toBe('COG~k1');
  });

  it('labels coefficients with their conventional meaning', () => {
    expect(spectralFeatureLabel({ moment: 'COG', kind: 'coeff', index: 1 })).toBe('COG k1 (slope)');
    expect(spectralFeatureLabel({ moment: 'COG', kind: 'coeff', index: 0 })).toBe('COG k0 (height)');
    expect(spectralFeatureLabel({ moment: 'COG', kind: 'coeff', index: 7 })).toBe('COG k7');
    expect(spectralFeatureLabel({ moment: 'SD', kind: 'point', index: 20 })).toBe('SD @20%');
  });
});

describe('spectral column-name helpers', () => {
  it('classifies track, coefficient and point suffixes', () => {
    expect(parseSpectralColumn('COG_t7')).toEqual({ kind: 'track', index: 7, base: 'COG' });
    expect(parseSpectralColumn('COG_t10')).toEqual({ kind: 'track', index: 10, base: 'COG' });
    expect(parseSpectralColumn('COG_k3')).toEqual({ kind: 'coeff', index: 3, base: 'COG' });
    expect(parseSpectralColumn('COG_20%')).toEqual({ kind: 'point', index: 20, base: 'COG' });
    // bare name = a single measurement at the midpoint
    expect(parseSpectralColumn('centroid')).toEqual({ kind: 'point', index: 50, base: 'centroid' });
  });

  it('renders chips for each column kind', () => {
    expect(spectralColumnChip('COG_t3')).toBe('t3');
    expect(spectralColumnChip('COG_k1')).toBe('k1');
    expect(spectralColumnChip('COG_80%')).toBe('80%');
  });

  it('parses timepoint suffixes and returns null for bare names', () => {
    expect(parseSpectralTimePointSuffix('COG_20%')).toBe(20);
    expect(parseSpectralTimePointSuffix('sd_50')).toBe(50);
    expect(parseSpectralTimePointSuffix('skew_12.5%_smooth')).toBe(12.5);
    expect(parseSpectralTimePointSuffix('centroid')).toBeNull();
    expect(parseSpectralTimePointSuffix('SpecDiff')).toBeNull();
  });

  it('strips timepoint suffixes to give the family base name', () => {
    expect(spectralColumnBaseName('COG_20%')).toBe('COG');
    expect(spectralColumnBaseName('noise_width_80%')).toBe('noise_width');
    expect(spectralColumnBaseName('centroid')).toBe('centroid');
  });

  it('defaults bare names to the 50% midpoint', () => {
    expect(spectralRoleTimePoint('COG_80%')).toBe(80);
    expect(spectralRoleTimePoint('centroid')).toBe(50);
  });
});

describe('getSpectralValue', () => {
  const meta = discoverSpectralMoments([tok(consonantFields)]);
  const token = tok(consonantFields);

  it('extracts the correct numeric value at a given timepoint', () => {
    expect(getSpectralValue(token, meta, 'COG', 50)).toBeCloseTo(558.8);
    expect(getSpectralValue(token, meta, 'SD', 20)).toBeCloseTo(425.4);
    expect(getSpectralValue(token, meta, 'kurt', 80)).toBeCloseTo(244.3);
  });

  it('returns NaN for an absent timepoint', () => {
    expect(getSpectralValue(token, meta, 'COG', 30)).toBeNaN();
  });

  it('returns NaN for a non-numeric or missing value', () => {
    const bad = tok({ ...consonantFields, 'COG_50%': 'NA' });
    expect(getSpectralValue(bad, meta, 'COG', 50)).toBeNaN();
    const empty = tok({ ...consonantFields, 'COG_50%': '' });
    expect(getSpectralValue(empty, meta, 'COG', 50)).toBeNaN();
  });
});

describe('nearestSpectralTimePoint', () => {
  const meta = discoverSpectralMoments([tok(consonantFields)]);

  it('returns exact match when present', () => {
    expect(nearestSpectralTimePoint(meta, 50)).toBe(50);
  });

  it('snaps to the nearest available timepoint', () => {
    expect(nearestSpectralTimePoint(meta, 45)).toBe(50);
    expect(nearestSpectralTimePoint(meta, 25)).toBe(20);
  });

  it('returns undefined when no timepoints exist', () => {
    const empty = discoverSpectralMoments([tok({ word: 'hi' })]);
    expect(nearestSpectralTimePoint(empty, 50)).toBeUndefined();
  });
});

describe('spectralAxisLabel', () => {
  it('includes unit for COG/SD and omits for dimensionless moments', () => {
    expect(spectralAxisLabel('COG')).toBe('Centre of Gravity (Hz)');
    expect(spectralAxisLabel('skew')).toBe('Skewness');
  });

  it('appends timepoint when given', () => {
    expect(spectralAxisLabel('COG', 50)).toBe('Centre of Gravity (Hz) @ 50%');
  });
});
