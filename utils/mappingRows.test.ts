import { describe, it, expect } from 'vitest';
import { buildMappingRows, DisplayRow } from './mappingRows';
import { ColumnMapping } from '../types';

/** The header a row stands for: a column's own, or a group's first member's. */
const headerOf = (row: DisplayRow): string =>
  row.kind === 'single' ? row.m.csvHeader : row.members[0].m.csvHeader;

const field = (csvHeader: string, isDataField: boolean): ColumnMapping =>
  ({ csvHeader, role: 'field', fieldName: csvHeader, isDataField });

const spectral = (csvHeader: string): ColumnMapping =>
  ({ csvHeader, role: 'spectral_cog', fieldName: csvHeader, isDataField: true, spectralRegion: 'release' });

describe('buildMappingRows', () => {
  const headers = ['speaker', 'word', 'stress', 'dur', 'COG_release_20%', 'COG_release_50%', 'COG_release_80%', 'notes'];
  const mappings: ColumnMapping[] = [
    { csvHeader: 'speaker', role: 'speaker' },
    field('word', false),
    field('stress', false),
    { csvHeader: 'dur', role: 'duration', isDataField: true },
    spectral('COG_release_20%'), spectral('COG_release_50%'), spectral('COG_release_80%'),
    field('notes', false),
  ];

  it('lists rows in CSV column order, with a family at its first column', () => {
    expect(buildMappingRows(mappings, headers).map(headerOf))
      .toEqual(['speaker', 'word', 'stress', 'dur', 'COG_release_20%', 'notes']);
  });

  it('does not move a column when it is switched between filter and data', () => {
    const before = buildMappingRows(mappings, headers).map(headerOf);
    // The Filter/Data toggle: 'stress' becomes a plotted measure, 'dur' becomes a label
    const toggled = mappings.map(m =>
      m.csvHeader === 'stress' ? { ...m, isDataField: true }
      : m.csvHeader === 'dur' ? { ...m, role: 'field' as const, isDataField: false }
      : m);
    expect(buildMappingRows(toggled, headers).map(headerOf)).toEqual(before);
  });

  it('does not move a column when its role is changed to a spectral measure', () => {
    const before = buildMappingRows(mappings, headers).map(headerOf);
    const reroled = mappings.map(m =>
      m.csvHeader === 'notes' ? { ...m, role: 'ignore' as const } : m);
    expect(buildMappingRows(reroled, headers).map(headerOf)).toEqual(before);
  });

  it('keeps a column in place even when its mapping was moved to the end of the array', () => {
    // The Speaker quick-assign rebuilds its mapping, which lands last in the array.
    const moved = [...mappings.filter(m => m.role !== 'speaker'), { csvHeader: 'speaker', role: 'speaker' as const }];
    expect(buildMappingRows(moved, headers).map(headerOf)[0]).toBe('speaker');
  });

  it('groups point, track and coefficient columns of one measure separately', () => {
    const trackHeaders = ['bandratio_release_t0', 'bandratio_release_t1', 'bandratio_release_t2',
      'bandratio_release_k0', 'bandratio_release_k1'];
    const trackMappings: ColumnMapping[] = trackHeaders.map(h =>
      ({ csvHeader: h, role: 'spectral_bandratio', fieldName: h, isDataField: true, spectralRegion: 'release' }));
    const rows = buildMappingRows(trackMappings, trackHeaders);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.kind)).toEqual(['group', 'group']);
    expect(rows.map(headerOf)).toEqual(['bandratio_release_t0', 'bandratio_release_k0']);
    expect((rows[0] as { label: string }).label).toBe('Spectral Band Energy Ratio track · release');
  });

  it('leaves a lone member of a would-be family as its own row', () => {
    const lone = ['COG_release_50%'];
    const rows = buildMappingRows([spectral('COG_release_50%')], lone);
    expect(rows.map(r => r.kind)).toEqual(['single']);
  });

  it('puts a column its headers do not mention at the end rather than dropping it', () => {
    const rows = buildMappingRows([...mappings, field('added_later', false)], headers);
    expect(rows.map(headerOf).at(-1)).toBe('added_later');
  });
});
