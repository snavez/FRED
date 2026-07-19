import { describe, it, expect } from 'vitest';
import {
  discoverSpectralMoments,
  getSpectralValue,
  nearestSpectralTimePoint,
  parseSpectralTimePointSuffix,
  spectralAxisLabel,
  spectralColumnBaseName,
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

describe('spectral column-name helpers', () => {
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
