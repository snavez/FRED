import { describe, it, expect } from 'vitest';
import {
  detectSpectralRole,
  discoverSpectralColumns,
  formatSpectralFeature,
  formatSpectralMeasureRef,
  getSpectralCoeffValue,
  getSpectralFeatureValue,
  getSpectralTrack,
  getSpectralTrackValue,
  getSpectralValue,
  hasSpectralFeature,
  hasSpectralRegions,
  listSpectralFeatures,
  nearestSpectralTimePoint,
  parseSpectralColumn,
  parseSpectralFeature,
  parseSpectralMeasureRef,
  parseSpectralTimePointSuffix,
  resolveSpectralAxes,
  resolveSpectralContour,
  resolveSpectralFeature,
  resolveSpectralMeasure,
  spectralAxisLabel,
  spectralContourSteps,
  spectralFeatureAxisLabel,
  spectralMeasureLabel,
  bandRatioBandsLabel,
  isCentredAtZero,
  getSpectralMeasureDef,
  SPECTRAL_MEASURE_DEFS,
  SPECTRAL_MOMENT_DEFS,
  spectralColumnBaseName,
  spectralColumnChip,
  spectralColumnRegion,
  spectralFeatureAt,
  spectralFeatureLabel,
  spectralFeatureOnKind,
  spectralIndicesOfKind,
  spectralKindsAvailable,
  spectralMeasuresOfKind,
  spectralRegionsOfKind,
  spectralRoleTimePoint,
} from './spectralMoments';
import type { SpectralMeta } from './spectralMoments';
import type { SpeechToken, BandRatioBands } from '../types';

function tok(fields: Record<string, string>): SpeechToken {
  return {
    id: 't', speaker: '', file_id: '', xmin: 0, duration: 0,
    trajectory: [], fields,
  };
}

/** Moment keys offering point measurements, in canonical order. */
const pointMoments = (meta: SpectralMeta, region?: string) =>
  spectralMeasuresOfKind(meta, 'point', region).map(m => m.key);

const consonantFields = {
  'COG_20%': '510.4', 'SD_20%': '425.4', 'skew_20%': '13.96', 'kurt_20%': '198.9',
  'COG_50%': '558.8', 'SD_50%': '349.6', 'skew_50%': '9.81', 'kurt_50%': '131.6',
  'COG_80%': '501.6', 'SD_80%': '280.9', 'skew_80%': '14.04', 'kurt_80%': '244.3',
  'allophone': 't', 'Target': 't0',
};

describe('discoverSpectralColumns', () => {
  it('discovers all four moments and three timepoints from %-suffixed headers', () => {
    const meta = discoverSpectralColumns([tok(consonantFields)]);
    expect(meta.available).toBe(true);
    expect(pointMoments(meta)).toEqual(['COG', 'SD', 'skew', 'kurt']);
    expect(spectralIndicesOfKind(meta, 'point')).toEqual([20, 50, 80]);
  });

  it('recognises alternative measure names (kurtosis, spread)', () => {
    const meta = discoverSpectralColumns([tok({ 'centroid_50': '600', 'kurtosis_50': '3.2' })]);
    expect(pointMoments(meta)).toEqual(['COG', 'kurt']);
    expect(spectralIndicesOfKind(meta, 'point')).toEqual([50]);
  });

  it('is not available when no measure columns exist', () => {
    const meta = discoverSpectralColumns([tok({ word: 'hi', f1: '500' })]);
    expect(meta.available).toBe(false);
    expect(meta.columns).toEqual([]);
  });

  it('only reports moments actually present (partial datasets)', () => {
    const meta = discoverSpectralColumns([tok({ 'COG_50%': '600', 'SD_50%': '300' })]);
    expect(pointMoments(meta)).toEqual(['COG', 'SD']);
  });

  it('prefers dataset meta column mappings when supplied', () => {
    const meta = discoverSpectralColumns([tok({})], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'COG_50%', role: 'field', fieldName: 'COG_50%' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(true);
    expect(pointMoments(meta)).toEqual(['COG']);
  });

  it('discovers arbitrarily-named columns via explicit spectral roles', () => {
    const fields = { 'sibilance_centre': '5100', 'noise_width_20': '800' };
    const meta = discoverSpectralColumns([tok(fields)], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'sibilance_centre', role: 'spectral_cog', fieldName: 'sibilance_centre' },
        { csvHeader: 'noise_width_20', role: 'spectral_sd', fieldName: 'noise_width_20' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(true);
    expect(pointMoments(meta)).toEqual(['COG', 'SD']);
    // No timepoint suffix → midpoint default (50); suffixed → parsed (20)
    expect(spectralIndicesOfKind(meta, 'point')).toEqual([20, 50]);
    expect(getSpectralValue(tok(fields), meta, 'COG', 50)).toBeCloseTo(5100);
    expect(getSpectralValue(tok(fields), meta, 'SD', 20)).toBeCloseTo(800);
  });

  it('role mappings take precedence over the header-pattern scan for the same slot', () => {
    const fields = { 'my_cog': '4000', 'COG_50%': '9999' };
    const meta = discoverSpectralColumns([tok(fields)], {
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
    const meta = discoverSpectralColumns([tok({ word: 'hi' })], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'COG_50%', role: 'ignore' },
      ], timePoints: [], rowCount: 1,
    });
    expect(meta.available).toBe(false);
  });
});

describe('regions', () => {
  // Mirrors a stop release/closure export: each measure measured twice per token.
  const regionFields: Record<string, string> = {
    'COG_closure_20%': '400', 'COG_closure_50%': '420', 'COG_closure_80%': '440',
    'COG_release_20%': '3000', 'COG_release_50%': '3200', 'COG_release_80%': '3400',
    'SD_release_50%': '1200', 'kurt_release_50%': '4.5',
    'winms_closure_20%': '23.4', 'nsamples_release_50%': '374',
    'winsource_release_50%': 'proportional',
    'closure_dur': '0.055', 'release_dur': '0.031',
  };
  for (let i = 0; i <= 3; i++) regionFields[`COG_release_k${i}`] = `${i}`;
  for (let i = 0; i <= 10; i++) regionFields[`COG_release_t${i}`] = `${3000 + i * 10}`;
  const meta = discoverSpectralColumns([tok(regionFields)]);

  it('keeps each region as its own family', () => {
    expect(meta.regions).toEqual(['closure', 'release']);
    expect(hasSpectralRegions(meta)).toBe(true);
    expect(pointMoments(meta, 'closure')).toEqual(['COG']);
    expect(pointMoments(meta, 'release')).toEqual(['COG', 'SD', 'kurt']);
  });

  it('reads the same measure and timepoint separately per region', () => {
    const t = tok(regionFields);
    expect(getSpectralValue(t, meta, 'COG', 50, 'closure')).toBeCloseTo(420);
    expect(getSpectralValue(t, meta, 'COG', 50, 'release')).toBeCloseTo(3200);
  });

  it('does not mistake analysis metadata or duration columns for moments', () => {
    expect(meta.columns.some(c => c.fieldKey.startsWith('winms'))).toBe(false);
    expect(meta.columns.some(c => c.fieldKey.startsWith('nsamples'))).toBe(false);
    expect(meta.columns.some(c => c.fieldKey.endsWith('_dur'))).toBe(false);
  });

  it('reports which kinds and regions carry which measurements', () => {
    expect(spectralKindsAvailable(meta, 'closure')).toEqual(['point']);
    expect(spectralKindsAvailable(meta, 'release')).toEqual(['point', 'track', 'coeff']);
    expect(spectralRegionsOfKind(meta, 'track')).toEqual(['release']);
    expect(spectralRegionsOfKind(meta, 'point', 'SD')).toEqual(['release']);
  });

  it('has no feature for a measure absent from a region', () => {
    expect(hasSpectralFeature(meta, { measure: 'SD', kind: 'point', index: 50, region: 'release' })).toBe(true);
    expect(hasSpectralFeature(meta, { measure: 'SD', kind: 'point', index: 50, region: 'closure' })).toBe(false);
    // An unqualified ref must not silently fall through to a regioned column
    expect(hasSpectralFeature(meta, { measure: 'COG', kind: 'point', index: 50 })).toBe(false);
  });

  it('reads tracks and coefficients within their region', () => {
    const t = tok(regionFields);
    expect(getSpectralTrackValue(t, meta, 'COG', 10, 'release')).toBeCloseTo(3100);
    expect(getSpectralTrackValue(t, meta, 'COG', 10, 'closure')).toBeNaN();
    expect(getSpectralCoeffValue(t, meta, 'COG', 2, 'release')).toBeCloseTo(2);
    expect(getSpectralTrack(t, meta, 'COG', 'release')).toHaveLength(11);
  });

  it('round-trips region-qualified feature refs', () => {
    expect(formatSpectralFeature({ measure: 'COG', kind: 'point', index: 20, region: 'release' }))
      .toBe('release:COG@20');
    expect(parseSpectralFeature('release:COG@20'))
      .toEqual({ measure: 'COG', kind: 'point', index: 20, region: 'release' });
    expect(parseSpectralFeature('closure:COG~t3'))
      .toEqual({ measure: 'COG', kind: 'track', index: 3, region: 'closure' });
    // Refs saved before regions existed stay valid and mean "no region"
    expect(parseSpectralFeature('COG@20')).toEqual({ measure: 'COG', kind: 'point', index: 20, region: '' });
  });

  it('round-trips family refs for contour selection', () => {
    expect(formatSpectralMeasureRef('COG', 'release')).toBe('release:COG');
    expect(formatSpectralMeasureRef('COG', '')).toBe('COG');
    expect(parseSpectralMeasureRef('release:COG')).toEqual({ measure: 'COG', region: 'release' });
    expect(parseSpectralMeasureRef('COG')).toEqual({ measure: 'COG', region: '' });
  });

  it('lists every region-qualified feature and labels it', () => {
    const refs = listSpectralFeatures(meta).map(formatSpectralFeature);
    expect(refs).toContain('closure:COG@20');
    expect(refs).toContain('release:kurt@50');
    expect(refs).not.toContain('closure:SD@50');
    expect(listSpectralFeatures(meta, 'closure').map(formatSpectralFeature))
      .toEqual(['closure:COG@20', 'closure:COG@50', 'closure:COG@80']);
    expect(spectralFeatureLabel({ measure: 'COG', kind: 'point', index: 20, region: 'release' }))
      .toBe('COG @20% · release');
  });

  it('pairs a fallback axis inside the region of the other axis', () => {
    const { x, y } = resolveSpectralAxes('release:COG@50', 'burst:SD@50', meta);
    expect(x && formatSpectralFeature(x)).toBe('release:COG@50');
    expect(y && formatSpectralFeature(y)).toBe('release:SD@50');
  });

  it('carries the measure and region onto another column kind', () => {
    const f = { measure: 'COG' as const, kind: 'point' as const, index: 50, region: 'release' };
    const onTrack = spectralFeatureOnKind(f, 'track', meta);
    // Same measurement, sampled along the track: the midpoint stays the midpoint
    expect(onTrack && formatSpectralFeature(onTrack)).toBe('release:COG~t5');
    // …and switching back returns where you were
    expect(formatSpectralFeature(spectralFeatureOnKind(onTrack, 'point', meta)!)).toBe('release:COG@50');
    // A coefficient order is not a position in time, so it starts at k0
    expect(formatSpectralFeature(spectralFeatureOnKind(f, 'coeff', meta)!)).toBe('release:COG~k0');
    // A region without that kind falls back to one that has it
    const closure = { measure: 'COG' as const, kind: 'point' as const, index: 20, region: 'closure' };
    expect(formatSpectralFeature(spectralFeatureOnKind(closure, 'track', meta)!)).toBe('release:COG~t0');
    // A measure the kind lacks falls back by rank; nothing at all returns null
    const kurt = { measure: 'kurt' as const, kind: 'point' as const, index: 50, region: 'release' };
    expect(formatSpectralFeature(spectralFeatureOnKind(kurt, 'track', meta)!)).toBe('release:COG~t5');
    expect(spectralFeatureOnKind(f, 'coeff', discoverSpectralColumns([tok({ 'COG_50%': '1' })]))).toBeNull();
  });

  it('follows the scatter axis when a measure ref is unusable', () => {
    // Stored measure the dataset holds is kept
    const kept = resolveSpectralMeasure('release:SD@50', 'closure:COG@20', meta);
    expect(kept && formatSpectralFeature(kept)).toBe('release:SD@50');
    // Otherwise the box/density plot picks up whatever the scatter axes were showing,
    // so switching plot type keeps the measure and region on screen
    const followed = resolveSpectralMeasure('burst:SD@50', 'release:COG@80', meta);
    expect(followed && formatSpectralFeature(followed)).toBe('release:COG@80');
  });

  it('resolves a contour family, preferring the track and following the axis', () => {
    // release COG has a track: the denser grid wins over its %-points
    expect(resolveSpectralContour('release:COG', '', meta))
      .toEqual({ measure: 'COG', region: 'release', kind: 'track' });
    // closure COG has only %-points
    expect(resolveSpectralContour('closure:COG', '', meta))
      .toEqual({ measure: 'COG', region: 'closure', kind: 'point' });
    // An unusable family follows the scatter X axis before falling back to the first
    expect(resolveSpectralContour('burst:kurt', 'closure:COG@20', meta))
      .toEqual({ measure: 'COG', region: 'closure', kind: 'point' });
    // kurt is measured once in release — nothing to sweep, so the fallback applies
    expect(resolveSpectralContour('release:kurt', '', meta))
      .toEqual({ measure: 'COG', region: 'release', kind: 'track' });
    expect(resolveSpectralContour('anything', '', discoverSpectralColumns([tok({ 'COG_50%': '1' })])))
      .toBeNull();
  });

  it('falls back to a real column when a stored ref names an absent region', () => {
    expect(formatSpectralFeature(resolveSpectralFeature('burst:COG@20', meta)!)).toBe('closure:COG@20');
    expect(formatSpectralFeature(resolveSpectralFeature('release:COG@80', meta)!)).toBe('release:COG@80');
  });

  it('sweeps a feature along its own grid', () => {
    const f = { measure: 'COG' as const, kind: 'point' as const, index: 20, region: 'release' };
    expect(getSpectralFeatureValue(tok(regionFields), meta, spectralFeatureAt(f, 80))).toBeCloseTo(3400);
  });

  it('lets a mapping override the region read from the column name', () => {
    const fields = { 'sibilance_centre': '5100' };
    const overridden = discoverSpectralColumns([tok(fields)], {
      fileName: 'x', columnMappings: [
        { csvHeader: 'sibilance_centre', role: 'spectral_cog', fieldName: 'sibilance_centre', spectralRegion: 'frication' },
      ], timePoints: [], rowCount: 1,
    });
    expect(overridden.regions).toEqual(['frication']);
    expect(getSpectralValue(tok(fields), overridden, 'COG', 50, 'frication')).toBeCloseTo(5100);
  });
});

describe('tracks and coefficients', () => {
  // Mirrors the real export format: %-points, an 11-sample track, 4 DCT coefficients.
  const trackFields: Record<string, string> = {
    'COG_20%': '502.4', 'COG_50%': '539.6', 'COG_80%': '506.6',
    'COG_k0': '1620.84', 'COG_k1': '-44.13', 'COG_k2': '9.52', 'COG_k3': '-29.86',
    'SD_k0': '1568.90', 'SD_k1': '-31.25', 'SD_k2': '62.35', 'SD_k3': '-1.00',
    // QA metadata that must never be mistaken for a measure
    'winms_20%': '23.4', 'nsamples_20%': '374', 'winsource_20%': 'proportional',
  };
  for (let i = 0; i <= 10; i++) trackFields[`COG_t${i}`] = `${400 + i * 10}`;
  for (let i = 0; i <= 10; i++) trackFields[`SD_t${i}`] = `${300 + i * 5}`;
  const meta = discoverSpectralColumns([tok(trackFields)]);

  it('keeps point, track and coefficient columns in separate buckets', () => {
    expect(pointMoments(meta)).toEqual(['COG']);
    expect(spectralIndicesOfKind(meta, 'point')).toEqual([20, 50, 80]);
    expect(spectralMeasuresOfKind(meta, 'track').map(m => m.key)).toEqual(['COG', 'SD']);
    expect(spectralMeasuresOfKind(meta, 'coeff').map(m => m.key)).toEqual(['COG', 'SD']);
  });

  it('discovers grid lengths from the data rather than assuming them', () => {
    expect(spectralIndicesOfKind(meta, 'track')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(spectralIndicesOfKind(meta, 'coeff')).toEqual([0, 1, 2, 3]);
  });

  it('handles a different grid length without code changes', () => {
    const short: Record<string, string> = {};
    for (let i = 0; i <= 4; i++) short[`COG_t${i}`] = `${i}`;
    for (let i = 0; i <= 5; i++) short[`COG_k${i}`] = `${i}`;
    const m2 = discoverSpectralColumns([tok(short)]);
    expect(spectralIndicesOfKind(m2, 'track')).toEqual([0, 1, 2, 3, 4]);
    expect(spectralIndicesOfKind(m2, 'coeff')).toEqual([0, 1, 2, 3, 4, 5]);
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

  it('does not treat analysis metadata as a measure', () => {
    // winms/nsamples/winsource share the _20% suffix but are not measure synonyms
    expect(getSpectralValue(tok(trackFields), meta, 'COG', 20)).toBeCloseTo(502.4);
    expect(pointMoments(meta)).not.toContain('SD');
  });

  it('is available from tracks or coefficients alone (no %-points)', () => {
    const only = discoverSpectralColumns([tok({ 'COG_t0': '1', 'COG_t1': '2' })]);
    expect(only.available).toBe(true);
    expect(pointMoments(only)).toEqual([]);
    expect(spectralMeasuresOfKind(only, 'track').map(m => m.key)).toEqual(['COG']);
  });
});

describe('spectral features', () => {
  const fields: Record<string, string> = {
    'COG_50%': '5000', 'SD_50%': '800', 'COG_k0': '19197.9', 'COG_k1': '1126.2',
  };
  const meta = discoverSpectralColumns([tok(fields)]);

  it('lists points then coefficients', () => {
    expect(listSpectralFeatures(meta).map(formatSpectralFeature))
      .toEqual(['COG@50', 'SD@50', 'COG~k0', 'COG~k1']);
  });

  it('round-trips feature refs', () => {
    expect(parseSpectralFeature('COG~k1')).toEqual({ measure: 'COG', kind: 'coeff', index: 1, region: '' });
    expect(parseSpectralFeature('COG@50')).toEqual({ measure: 'COG', kind: 'point', index: 50, region: '' });
    expect(parseSpectralFeature('nonsense')).toBeNull();
  });

  it('reads values for both feature kinds', () => {
    const t = tok(fields);
    expect(getSpectralFeatureValue(t, meta, { measure: 'COG', kind: 'point', index: 50 })).toBeCloseTo(5000);
    expect(getSpectralFeatureValue(t, meta, { measure: 'COG', kind: 'coeff', index: 1 })).toBeCloseTo(1126.2);
  });

  it('falls back when a stored ref refers to an absent column', () => {
    expect(formatSpectralFeature(resolveSpectralFeature('kurt~k9', meta)!)).toBe('COG@50');
    expect(formatSpectralFeature(resolveSpectralFeature('COG~k1', meta)!)).toBe('COG~k1');
  });

  it('pairs the axes on two real columns of the same kind', () => {
    // Stored refs the dataset holds are kept exactly as they are
    const kept = resolveSpectralAxes('COG@50', 'SD@50', meta);
    expect(kept.x && formatSpectralFeature(kept.x)).toBe('COG@50');
    expect(kept.y && formatSpectralFeature(kept.y)).toBe('SD@50');
    // An unusable Y falls back beside X — same kind and position, the next measure
    const paired = resolveSpectralAxes('COG@50', 'kurt@99', meta);
    expect(paired.y && formatSpectralFeature(paired.y)).toBe('SD@50');
    // Coefficients pair by order instead, giving the k0 x k1 shape space
    const coeffs = resolveSpectralAxes('COG~k0', 'nonsense', meta);
    expect(coeffs.y && formatSpectralFeature(coeffs.y)).toBe('COG~k1');
    // Nothing to draw from an empty dataset
    const empty = resolveSpectralAxes('COG@50', 'SD@50', discoverSpectralColumns([tok({ word: 'hi' })]));
    expect(empty).toEqual({ x: null, y: null });
  });

  it('labels coefficients with their conventional meaning', () => {
    expect(spectralFeatureLabel({ measure: 'COG', kind: 'coeff', index: 1 })).toBe('COG k1 (slope)');
    expect(spectralFeatureLabel({ measure: 'COG', kind: 'coeff', index: 0 })).toBe('COG k0 (height)');
    expect(spectralFeatureLabel({ measure: 'COG', kind: 'coeff', index: 7 })).toBe('COG k7');
    expect(spectralFeatureLabel({ measure: 'SD', kind: 'point', index: 20 })).toBe('SD @20%');
  });
});

describe('spectral column-name helpers', () => {
  it('classifies track, coefficient and point suffixes', () => {
    expect(parseSpectralColumn('COG_t7')).toEqual({ kind: 'track', index: 7, base: 'COG', measure: 'COG', region: '' });
    expect(parseSpectralColumn('COG_k3')).toEqual({ kind: 'coeff', index: 3, base: 'COG', measure: 'COG', region: '' });
    expect(parseSpectralColumn('COG_20%')).toEqual({ kind: 'point', index: 20, base: 'COG', measure: 'COG', region: '' });
    // bare name = a single measurement at the midpoint
    expect(parseSpectralColumn('centroid')).toEqual({ kind: 'point', index: 50, base: 'centroid', measure: 'COG', region: '' });
  });

  it('splits the region label out of the column name', () => {
    expect(parseSpectralColumn('COG_closure_20%'))
      .toEqual({ kind: 'point', index: 20, base: 'COG_closure', measure: 'COG', region: 'closure' });
    expect(parseSpectralColumn('SD_release_t3'))
      .toEqual({ kind: 'track', index: 3, base: 'SD_release', measure: 'SD', region: 'release' });
    expect(spectralColumnRegion('kurt_release_50%')).toBe('release');
    expect(spectralColumnRegion('kurt_50%')).toBe('');
    // Multi-word measure names still leave the rest as the region
    expect(spectralColumnRegion('centre_of_gravity_burst_50%')).toBe('burst');
  });

  it('names no measure for columns that only look spectral', () => {
    expect(parseSpectralColumn('winms_closure_20%').measure).toBeNull();
    expect(parseSpectralColumn('nsamples_20%').measure).toBeNull();
    // A hand-named column is one measurement, not a region of one
    expect(parseSpectralColumn('sibilance_centre').region).toBe('');
  });

  it('derives the auto-detection role from the column name', () => {
    expect(detectSpectralRole('COG_closure_20%')).toBe('spectral_cog');
    expect(detectSpectralRole('kurtosis_release_t3')).toBe('spectral_kurt');
    expect(detectSpectralRole('SpecDiff')).toBe('spectral_sd');
    expect(detectSpectralRole('winsource_release_50%')).toBeNull();
    expect(detectSpectralRole('release_dur')).toBeNull();
  });

  it('renders chips for each column kind', () => {
    expect(spectralColumnChip('COG_t3')).toBe('t3');
    expect(spectralColumnChip('COG_k1')).toBe('k1');
    expect(spectralColumnChip('COG_80%')).toBe('80%');
    expect(spectralColumnChip('COG_closure_80%')).toBe('80%');
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
  const meta = discoverSpectralColumns([tok(consonantFields)]);
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
  const meta = discoverSpectralColumns([tok(consonantFields)]);

  it('returns exact match when present', () => {
    expect(nearestSpectralTimePoint(meta, 50)).toBe(50);
  });

  it('snaps to the nearest available timepoint', () => {
    expect(nearestSpectralTimePoint(meta, 45)).toBe(50);
    expect(nearestSpectralTimePoint(meta, 25)).toBe(20);
  });

  it('returns undefined when no timepoints exist', () => {
    const empty = discoverSpectralColumns([tok({ word: 'hi' })]);
    expect(nearestSpectralTimePoint(empty, 50)).toBeUndefined();
  });
});

describe('spectralAxisLabel', () => {
  it('includes unit for COG/SD and omits for dimensionless moments', () => {
    expect(spectralAxisLabel('COG')).toBe('Centre of Gravity (Hz)');
    expect(spectralAxisLabel('skew')).toBe('Skewness');
  });

  it('appends timepoint and region when given', () => {
    expect(spectralAxisLabel('COG', 50)).toBe('Centre of Gravity (Hz) @ 50%');
    expect(spectralAxisLabel('COG', 50, 'release')).toBe('Centre of Gravity (Hz) @ 50% · release');
  });
});

// ─── Band energy ratio ────────────────────────────────────────────────────
// FormantStudio writes the ratio in the same loop as the four moments, so its columns
// follow the same scheme and must inherit point/track/coefficient discovery for free.

const bandRatioFields = {
  'bandratio_release_20%': '-12.4', 'bandratio_release_50%': '3.7', 'bandratio_release_80%': '18.2',
  'COG_release_50%': '5100',
  'bandratio_release_k0': '9.1', 'bandratio_release_k1': '-4.2',
  'bandratio_release_t0': '-18.6', 'bandratio_release_t1': '-2.0', 'bandratio_release_t2': '11.3',
};

const bands: BandRatioBands = { low: [400, 900], high: [5500, 7500], units: 'dB' };

describe('band energy ratio columns', () => {
  it('reads the ratio as its own measure, in every column form', () => {
    expect(parseSpectralColumn('bandratio_release_20%')).toMatchObject({
      measure: 'bandratio', kind: 'point', index: 20, region: 'release',
    });
    expect(parseSpectralColumn('bandratio_release_t3')).toMatchObject({
      measure: 'bandratio', kind: 'track', index: 3, region: 'release',
    });
    expect(parseSpectralColumn('bandratio_k2')).toMatchObject({
      measure: 'bandratio', kind: 'coeff', index: 2, region: '',
    });
    // No region and no suffix: one measurement at the segment midpoint
    expect(parseSpectralColumn('bandratio')).toMatchObject({
      measure: 'bandratio', kind: 'point', index: 50, region: '',
    });
  });

  it('accepts the header synonyms, underscores and case aside', () => {
    for (const h of ['bandratio_50%', 'band_ratio_50%', 'BandEnergyRatio_50%', 'BER_50%', 'ber_release_t0']) {
      expect(parseSpectralColumn(h).measure).toBe('bandratio');
    }
    expect(detectSpectralRole('bandratio_release_20%')).toBe('spectral_bandratio');
    expect(detectSpectralRole('BER_k1')).toBe('spectral_bandratio');
  });

  it('does not sweep up a column that merely starts with a similar word', () => {
    expect(parseSpectralColumn('band_low_hz').measure).toBeNull();
    expect(detectSpectralRole('bandwidth_50%')).toBeNull();
  });

  it('discovers it alongside the moments, as points, tracks and coefficients', () => {
    const meta = discoverSpectralColumns([tok(bandRatioFields)]);
    expect(meta.available).toBe(true);
    expect(pointMoments(meta, 'release')).toEqual(['COG', 'bandratio']);
    expect(spectralMeasuresOfKind(meta, 'track', 'release').map(m => m.key)).toEqual(['bandratio']);
    expect(spectralMeasuresOfKind(meta, 'coeff', 'release').map(m => m.key)).toEqual(['bandratio']);
    expect(spectralKindsAvailable(meta, 'release')).toEqual(['point', 'track', 'coeff']);
  });

  it('reads values back through the ordinary accessors', () => {
    const t = tok(bandRatioFields);
    const meta = discoverSpectralColumns([t]);
    expect(getSpectralValue(t, meta, 'bandratio', 20, 'release')).toBeCloseTo(-12.4);
    expect(getSpectralTrackValue(t, meta, 'bandratio', 2, 'release')).toBeCloseTo(11.3);
    expect(getSpectralCoeffValue(t, meta, 'bandratio', 1, 'release')).toBeCloseTo(-4.2);
    expect(getSpectralTrack(t, meta, 'bandratio', 'release')).toEqual([-18.6, -2.0, 11.3]);
  });

  it('offers the track as a contour, which is the view it is for', () => {
    const meta = discoverSpectralColumns([tok(bandRatioFields)]);
    const contour = resolveSpectralContour('release:bandratio', '', meta);
    expect(contour).toEqual({ measure: 'bandratio', region: 'release', kind: 'track' });
    expect(spectralContourSteps(meta, contour!)).toEqual([0, 1, 2]);
  });

  it('is a spectral measure but not a moment', () => {
    expect(SPECTRAL_MEASURE_DEFS.map(d => d.key)).toContain('bandratio');
    expect(SPECTRAL_MOMENT_DEFS.map(d => d.key)).toEqual(['COG', 'SD', 'skew', 'kurt']);
    expect(getSpectralMeasureDef('bandratio')).toMatchObject({
      short: 'Ratio', unit: 'dB', isMoment: false, centredAtZero: true,
    });
    expect(SPECTRAL_MOMENT_DEFS.every(d => d.isMoment && !d.centredAtZero)).toBe(true);
  });

  it('is the only measure an axis marks a zero on', () => {
    expect(isCentredAtZero('bandratio')).toBe(true);
    for (const d of SPECTRAL_MOMENT_DEFS) expect(isCentredAtZero(d.key)).toBe(false);
  });
});

describe('band ratio labels', () => {
  it('states the bands whenever the sidecar said what they were', () => {
    expect(bandRatioBandsLabel(bands)).toBe('5.5–7.5k / 0.4–0.9k');
    expect(spectralMeasureLabel('bandratio', bands)).toBe('Band ratio 5.5–7.5k / 0.4–0.9k (dB)');
    expect(spectralAxisLabel('bandratio', 50, 'release', bands))
      .toBe('Band ratio 5.5–7.5k / 0.4–0.9k (dB) @ 50% · release');
    expect(spectralFeatureAxisLabel({ measure: 'bandratio', kind: 'track', index: 3, region: 'release' }, bands))
      .toBe('Band ratio 5.5–7.5k / 0.4–0.9k (dB) — track t3 · release');
  });

  it('says only what it knows when no sidecar came with the CSV', () => {
    expect(spectralMeasureLabel('bandratio')).toBe('Band Energy Ratio (dB)');
    expect(spectralAxisLabel('bandratio', 50)).toBe('Band Energy Ratio (dB) @ 50%');
  });

  it('leaves the moment labels untouched whether bands are known or not', () => {
    expect(spectralMeasureLabel('COG', bands)).toBe('Centre of Gravity (Hz)');
    expect(spectralAxisLabel('COG', 50, 'release', bands)).toBe('Centre of Gravity (Hz) @ 50% · release');
  });

  it('carries the bands from the dataset meta onto the discovery result', () => {
    const meta = discoverSpectralColumns([tok(bandRatioFields)], {
      fileName: 'x.csv', columnMappings: [], timePoints: [], rowCount: 1,
      provenance: { sourceFile: 'x.provenance.json', bandRatio: bands },
    });
    expect(meta.bandRatio).toEqual(bands);
    expect(discoverSpectralColumns([tok(bandRatioFields)]).bandRatio).toBeNull();
  });
});
