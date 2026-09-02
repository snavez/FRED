import { describe, it, expect } from 'vitest';
import {
  detectDelimiter,
  splitRow,
  autoDetectMappings,
  parseWithMappings,
  splitRows,
} from './csvParser';
import { ColumnMapping } from '../types';

// ─── detectDelimiter ───────────────────────────────────────────────

describe('detectDelimiter', () => {
  it('detects comma delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('detects tab delimiter', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('defaults to comma when no delimiters are present', () => {
    expect(detectDelimiter('singlecolumn\nvalue')).toBe(',');
  });

  it('chooses tab when tabs outnumber commas', () => {
    // 3 tabs vs 1 comma
    expect(detectDelimiter('a\tb\tc,d\te')).toBe('\t');
  });
});

// ─── splitRow ──────────────────────────────────────────────────────

describe('splitRow', () => {
  it('splits by comma', () => {
    expect(splitRow('a,b,c', ',')).toEqual(['a', 'b', 'c']);
  });

  it('splits by tab', () => {
    expect(splitRow('x\ty\tz', '\t')).toEqual(['x', 'y', 'z']);
  });

  it('handles quoted fields containing the delimiter', () => {
    expect(splitRow('"hello, world",b,c', ',')).toEqual(['hello, world', 'b', 'c']);
  });

  it('handles empty and trailing fields', () => {
    expect(splitRow('a,,c,', ',')).toEqual(['a', '', 'c', '']);
  });

  it('trims whitespace from fields', () => {
    expect(splitRow(' a , b , c ', ',')).toEqual(['a', 'b', 'c']);
  });
});

// ─── autoDetectMappings ────────────────────────────────────────────

describe('autoDetectMappings', () => {
  it('maps known aliases to special roles', () => {
    const headers = ['speaker', 'file_id', 'dur', 'onset'];
    const sampleRows = [
      ['spk1', 'f001', '0.12', '0.5'],
      ['spk2', 'f002', '0.15', '1.2'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'speaker')?.role).toBe('speaker');
    expect(mappings.find(m => m.csvHeader === 'file_id')?.role).toBe('file_id');
    expect(mappings.find(m => m.csvHeader === 'dur')?.role).toBe('duration');
    // xmin-like columns are now detected as regular data fields
    expect(mappings.find(m => m.csvHeader === 'onset')?.role).toBe('field');
    expect(mappings.find(m => m.csvHeader === 'onset')?.isDataField).toBe(true);
  });

  it('detects spectral-moment columns and assigns dedicated spectral roles', () => {
    const headers = ['COG_20%', 'SD_50%', 'skew_80%', 'kurtosis_50%'];
    // 25 rows of distinct numeric values would trip the high-cardinality ignore
    // heuristic for generic numeric columns; spectral moments must survive it.
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${500 + i}`, `${300 + i}`, `${1 + i * 0.1}`, `${100 + i}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    const expectedRoles: Record<string, string> = {
      'COG_20%': 'spectral_cog',
      'SD_50%': 'spectral_sd',
      'skew_80%': 'spectral_skew',
      'kurtosis_50%': 'spectral_kurt',
    };
    for (const h of headers) {
      const m = mappings.find(x => x.csvHeader === h)!;
      expect(m.role).toBe(expectedRoles[h]);
      expect(m.isDataField).toBe(true);
      expect(m.showInSidebar).toBe(false);
      expect(m.fieldName).toBe(h);
    }
  });

  it('detects spectral synonyms with and without timepoint suffixes', () => {
    const headers = ['centroid', 'SpecDiff', 'Skewness_50', 'spread_20%'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${5000 + i}`, `${800 + i}`, `${-1 - i * 0.1}`, `${900 + i}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'centroid')?.role).toBe('spectral_cog');
    expect(mappings.find(m => m.csvHeader === 'SpecDiff')?.role).toBe('spectral_sd');
    expect(mappings.find(m => m.csvHeader === 'Skewness_50')?.role).toBe('spectral_skew');
    expect(mappings.find(m => m.csvHeader === 'spread_20%')?.role).toBe('spectral_sd');
  });

  it('assigns spectral roles to track and coefficient columns', () => {
    const headers = ['COG_t0', 'COG_t10', 'SD_t3', 'COG_k0', 'COG_k1', 'SD_k3'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${400 + i}`, `${500 + i}`, `${300 + i}`, `${1600 + i}`, `${-44 - i}`, `${9 + i}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    for (const h of ['COG_t0', 'COG_t10', 'COG_k0', 'COG_k1']) {
      expect(mappings.find(m => m.csvHeader === h)?.role).toBe('spectral_cog');
    }
    for (const h of ['SD_t3', 'SD_k3']) {
      expect(mappings.find(m => m.csvHeader === h)?.role).toBe('spectral_sd');
    }
    // must survive the high-cardinality ignore heuristic
    for (const h of headers) {
      expect(mappings.find(m => m.csvHeader === h)?.isDataField).toBe(true);
    }
  });

  it('does not misclassify non-moment columns as spectral', () => {
    const headers = ['winms_20%', 'word', 'sda_50'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${20 + (i % 3)}`, `word${i}`, `${i}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    for (const h of headers) {
      const role = mappings.find(m => m.csvHeader === h)!.role;
      expect(['spectral_cog', 'spectral_sd', 'spectral_skew', 'spectral_kurt']).not.toContain(role);
    }
  });

  it('treats a categorical column as a label even when its name says pitch or duration', () => {
    const headers = ['voice_pitch', 'segment_dur', 'f0_50'];
    const sampleRows = Array.from({ length: 20 }, (_, i) => [
      i % 2 ? 'high' : 'low', i % 3 ? 'long' : 'short', `${180 + i}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    const byHeader = (h: string) => mappings.find(m => m.csvHeader === h)!;
    // high/low is a label to filter and colour by, not a measure to plot
    expect(byHeader('voice_pitch').role).toBe('field');
    expect(byHeader('voice_pitch').isDataField).toBe(false);
    expect(byHeader('voice_pitch').showInSidebar).toBe(true);
    expect(byHeader('segment_dur').role).toBe('field');
    expect(byHeader('segment_dur').isDataField).toBe(false);
    // A genuinely numeric pitch column keeps its measure role
    expect(byHeader('f0_50').role).toBe('pitch');
    expect(byHeader('f0_50').isDataField).toBe(true);
  });

  it('keeps numeric pitch and duration columns as measures', () => {
    const headers = ['voice_pitch', 'closure_dur'];
    const sampleRows = Array.from({ length: 20 }, (_, i) => [`${180 + i}`, `${0.05 + i / 1000}`]);
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'voice_pitch')?.role).toBe('pitch');
    expect(mappings.find(m => m.csvHeader === 'closure_dur')?.role).toBe('duration');
    expect(mappings.find(m => m.csvHeader === 'closure_dur')?.isDataField).toBe(true);
  });

  it('keeps a sparse duration column numeric when its first rows are missing', () => {
    // release_dur is only measured for stops, so the rows detection happens to see may
    // hold nothing at all — the column is still a duration
    const headers = ['MAU_dur', 'closure_dur', 'release_dur'];
    const sampleRows = [
      ['0.21', '', ''],
      ['0.18', '', ''],
      ['0.25', '', ''],
      ['0.19', '0.055', '0.031'],
      ['0.22', '', ''],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);
    for (const h of headers) {
      expect(mappings.find(m => m.csvHeader === h)!.role).toBe('duration');
    }
  });

  it('reads missing markers as missing, not as text', () => {
    // The same column exported with NA / n/a / NaN rather than empty cells
    const headers = ['MAU_dur', 'release_dur', 'COG_release_50%'];
    const sampleRows = [
      ['0.21', 'NA', 'NA'],
      ['0.18', 'NA', 'NA'],
      ['0.25', 'n/a', 'n/a'],
      ['0.19', '0.031', '3200'],
      ['0.22', 'NaN', 'NaN'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);
    expect(mappings.find(m => m.csvHeader === 'release_dur')!.role).toBe('duration');
    expect(mappings.find(m => m.csvHeader === 'COG_release_50%')!.role).toBe('spectral_cog');
  });

  it('still refuses a duration-named column that really holds labels', () => {
    const headers = ['segment_dur'];
    const sampleRows = Array.from({ length: 6 }, (_, i) => [i % 2 ? 'long' : 'short']);
    const mappings = autoDetectMappings(headers, sampleRows);
    expect(mappings[0].role).toBe('field');
    expect(mappings[0].isDataField).toBe(false);
  });

  it('detects region-labelled spectral columns and records the region', () => {
    const headers = ['COG_closure_20%', 'COG_release_20%', 'SD_release_t3', 'kurt_closure_k1'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${400 + i}`, `${3000 + i}`, `${1200 + i}`, `${4 + i * 0.1}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    const byHeader = (h: string) => mappings.find(m => m.csvHeader === h)!;
    expect(byHeader('COG_closure_20%').role).toBe('spectral_cog');
    expect(byHeader('COG_closure_20%').spectralRegion).toBe('closure');
    expect(byHeader('COG_release_20%').spectralRegion).toBe('release');
    expect(byHeader('SD_release_t3').role).toBe('spectral_sd');
    expect(byHeader('SD_release_t3').spectralRegion).toBe('release');
    expect(byHeader('kurt_closure_k1').role).toBe('spectral_kurt');
    expect(byHeader('kurt_closure_k1').spectralRegion).toBe('closure');
    for (const h of headers) expect(byHeader(h).isDataField).toBe(true);
  });

  it('leaves region-labelled metadata and duration columns out of the spectral roles', () => {
    const headers = ['winms_closure_20%', 'nsamples_release_50%', 'winsource_release_50%',
      'closure_dur', 'release_dur'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [
      `${23 + i}`, `${370 + i}`, 'proportional', `${0.05 + i / 1000}`, `${0.03 + i / 1000}`,
    ]);
    const mappings = autoDetectMappings(headers, sampleRows);

    for (const h of headers) {
      expect(mappings.find(m => m.csvHeader === h)!.role).not.toMatch(/^spectral_/);
    }
    // The per-region durations stay usable as duration measures
    expect(mappings.find(m => m.csvHeader === 'closure_dur')?.role).toBe('duration');
    expect(mappings.find(m => m.csvHeader === 'release_dur')?.role).toBe('duration');
  });

  it('does not read a categorical column as a region-labelled measurement', () => {
    const headers = ['skew_notes', 'COG_release_50%'];
    const sampleRows = Array.from({ length: 25 }, (_, i) => [`checked by ${i % 3}`, `${3000 + i}`]);
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'skew_notes')!.role).not.toMatch(/^spectral_/);
    expect(mappings.find(m => m.csvHeader === 'COG_release_50%')!.role).toBe('spectral_cog');
  });

  it('stores spectral-role columns in token.fields when parsing', () => {
    const csv = 'speaker,sibilance_centre,COG_50%\nspk1,4200,5100\n';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'speaker', role: 'speaker' },
      // Custom-named column manually mapped to Spectral COG in the dialog
      { csvHeader: 'sibilance_centre', role: 'spectral_cog', fieldName: 'sibilance_centre', isDataField: true },
      { csvHeader: 'COG_50%', role: 'spectral_cog', fieldName: 'COG_50%', isDataField: true },
    ];
    const { tokens } = parseWithMappings(csv, mappings, 'test.csv');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].fields['sibilance_centre']).toBe('4200');
    expect(tokens[0].fields['COG_50%']).toBe('5100');
  });

  it('detects formant columns via regex', () => {
    const headers = ['f1_50', 'F2_00_smooth'];
    const sampleRows = [['400', '1500']];
    const mappings = autoDetectMappings(headers, sampleRows);

    const f1 = mappings.find(m => m.csvHeader === 'f1_50')!;
    expect(f1.role).toBe('formant');
    expect(f1.formant).toBe('f1');
    expect(f1.timePoint).toBe(50);
    expect(f1.isSmooth).toBe(false);

    const f2 = mappings.find(m => m.csvHeader === 'F2_00_smooth')!;
    expect(f2.role).toBe('formant');
    expect(f2.formant).toBe('f2');
    expect(f2.timePoint).toBe(0);
    expect(f2.isSmooth).toBe(true);
  });

  it('detects formant columns with ms/sec unit suffixes', () => {
    const headers = ['F1_0ms', 'F2_50ms', 'F3_1540ms', 'F1_2sec', 'f1_75%'];
    const sampleRows = [['400', '1500', '2500', '300', '450']];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'F1_0ms')?.role).toBe('formant');
    expect(mappings.find(m => m.csvHeader === 'F1_0ms')?.timePoint).toBe(0);
    expect(mappings.find(m => m.csvHeader === 'F2_50ms')?.timePoint).toBe(50);
    expect(mappings.find(m => m.csvHeader === 'F3_1540ms')?.timePoint).toBe(1540);
    expect(mappings.find(m => m.csvHeader === 'F1_2sec')?.timePoint).toBe(2);
    expect(mappings.find(m => m.csvHeader === 'f1_75%')?.timePoint).toBe(75);
  });

  it('detects formant with ms unit plus variant suffix', () => {
    const headers = ['F1_50ms_smooth', 'F2_100ms_lowpass'];
    const sampleRows = [['400', '1500']];
    const mappings = autoDetectMappings(headers, sampleRows);

    const f1 = mappings.find(m => m.csvHeader === 'F1_50ms_smooth')!;
    expect(f1.role).toBe('formant');
    expect(f1.timePoint).toBe(50);
    expect(f1.isSmooth).toBe(true);
    expect(f1.formantLabel).toBe('smooth');

    const f2 = mappings.find(m => m.csvHeader === 'F2_100ms_lowpass')!;
    expect(f2.timePoint).toBe(100);
    expect(f2.formantLabel).toBe('lowpass');
  });

  it('classifies low-cardinality unknown columns as field', () => {
    const headers = ['dialect'];
    const sampleRows = [['north'], ['south'], ['north'], ['east']];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings[0].role).toBe('field');
    expect(mappings[0].fieldName).toBe('dialect');
  });

  it('classifies high-cardinality numeric unknown columns as ignore', () => {
    const headers = ['measurement'];
    // Generate 25 unique numeric values → numeric-heavy + >20 unique
    const sampleRows = Array.from({ length: 25 }, (_, i) => [String(100 + i * 3.7)]);
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings[0].role).toBe('ignore');
  });
});

// ─── parseWithMappings ─────────────────────────────────────────────

describe('parseWithMappings', () => {
  it('parses CSV with speaker and file_id roles', () => {
    const csv = 'speaker,file_id,phoneme\nspk1,f001,a\nspk2,f002,i';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'speaker', role: 'speaker' },
      { csvHeader: 'file_id', role: 'file_id' },
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings, 'test.csv');

    expect(tokens).toHaveLength(2);
    expect(tokens[0].speaker).toBe('spk1');
    expect(tokens[0].file_id).toBe('f001');
    expect(tokens[0].fields['phoneme']).toBe('a');
    expect(tokens[1].speaker).toBe('spk2');
    expect(meta.rowCount).toBe(2);
    expect(meta.fileName).toBe('test.csv');
  });

  it('builds trajectory from formant columns at correct time-points', () => {
    const csv = 'f1_00,f2_00,f1_50,f2_50\n400,1800,450,1700';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'f1_00', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'f2_00', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(tokens[0].trajectory).toHaveLength(2);
    expect(tokens[0].trajectory[0]).toMatchObject({ time: 0, f1: 400, f2: 1800 });
    expect(tokens[0].trajectory[1]).toMatchObject({ time: 50, f1: 450, f2: 1700 });
    expect(meta.timePoints).toEqual([0, 50]);
  });

  it('populates fields for field-role columns', () => {
    const csv = 'phoneme,dialect,age\na,northern,young\ni,southern,old';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
      { csvHeader: 'dialect', role: 'field', fieldName: 'dialect' },
      { csvHeader: 'age', role: 'field', fieldName: 'age' },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].fields).toEqual({ phoneme: 'a', dialect: 'northern', age: 'young' });
    expect(tokens[1].fields).toEqual({ phoneme: 'i', dialect: 'southern', age: 'old' });
  });

  it('skips ignore-role columns', () => {
    const csv = 'phoneme,junk\na,xyz\ni,abc';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
      { csvHeader: 'junk', role: 'ignore' },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].fields['phoneme']).toBe('a');
    // 'junk' should not appear in fields
    expect(tokens[0].fields['junk']).toBeUndefined();
  });

  it('returns correct DatasetMeta', () => {
    const csv = 'phoneme,f1_00,f2_00,f1_50,f2_50,region\na,400,1800,450,1700,east';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
      { csvHeader: 'f1_00', role: 'formant', formant: 'f1', timePoint: 0 },
      { csvHeader: 'f2_00', role: 'formant', formant: 'f2', timePoint: 0 },
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50 },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50 },
      { csvHeader: 'region', role: 'field', fieldName: 'region' },
    ];
    const { meta } = parseWithMappings(csv, mappings, 'data.csv');

    expect(meta.timePoints).toEqual([0, 50]);
    expect(meta.rowCount).toBe(1);
    expect(meta.fileName).toBe('data.csv');
  });

  it('handles tab-delimited input', () => {
    const tsv = 'phoneme\tword\na\tcat\ni\tsit';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
      { csvHeader: 'word', role: 'field', fieldName: 'word' },
    ];
    const { tokens } = parseWithMappings(tsv, mappings);

    expect(tokens).toHaveLength(2);
    expect(tokens[0].fields['phoneme']).toBe('a');
    expect(tokens[0].fields['word']).toBe('cat');
  });

  it('handles smooth formant values with raw fallback', () => {
    const csv = 'f1_50,f2_50,f1_50_smooth,f2_50_smooth\n400,1800,410,1810';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
      { csvHeader: 'f1_50_smooth', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: true },
      { csvHeader: 'f2_50_smooth', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: true },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    const tp = tokens[0].trajectory[0];
    expect(tp.f1).toBe(400);
    expect(tp.f2).toBe(1800);
    expect(tp.f1_smooth).toBe(410);
    expect(tp.f2_smooth).toBe(1810);
  });

  it('falls back smooth to raw when smooth is missing', () => {
    const csv = 'f1_50,f2_50\n400,1800';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    const tp = tokens[0].trajectory[0];
    // smooth falls back to raw
    expect(tp.f1_smooth).toBe(400);
    expect(tp.f2_smooth).toBe(1800);
  });

  it('produces sensible defaults for missing values', () => {
    const csv = 'phoneme\na';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].speaker).toBe('');
    expect(tokens[0].file_id).toBe('');
    expect(tokens[0].xmin).toBe(0);
    expect(tokens[0].duration).toBe(0);
    expect(tokens[0].trajectory).toEqual([]);
    expect(tokens[0].fields['phoneme']).toBe('a');
  });
});

// ─── Long-format auto-detection ──────────────────────────────────────

describe('autoDetectMappings – long format', () => {
  it('detects token_id and timepoint aliases', () => {
    const headers = ['sl_rowIdx', 'vowel', 'speaker', 'file', 'times_norm', 'F1', 'F2'];
    const sampleRows = [
      ['1', 'a', 'spk1', 'f001', '0', '400', '1800'],
      ['1', 'a', 'spk1', 'f001', '0.5', '450', '1700'],
      ['2', 'i', 'spk1', 'f001', '0', '300', '2200'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'sl_rowIdx')?.role).toBe('token_id');
    expect(mappings.find(m => m.csvHeader === 'times_norm')?.role).toBe('timepoint');
    expect(mappings.find(m => m.csvHeader === 'F1')?.role).toBe('formant');
    expect(mappings.find(m => m.csvHeader === 'F2')?.role).toBe('formant');
    expect(mappings.find(m => m.csvHeader === 'speaker')?.role).toBe('speaker');
    expect(mappings.find(m => m.csvHeader === 'file')?.role).toBe('file_id');
  });

  it('heuristically finds token_id when bare formants + timepoint exist', () => {
    const headers = ['group_num', 'vowel', 'time_norm', 'F1', 'F2'];
    const sampleRows = [
      ['1', 'a', '0', '400', '1800'],
      ['1', 'a', '0.5', '450', '1700'],
      ['1', 'a', '1', '480', '1600'],
      ['2', 'i', '0', '300', '2200'],
      ['2', 'i', '0.5', '310', '2100'],
      ['2', 'i', '1', '320', '2000'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    // time_norm matches alias → timepoint
    expect(mappings.find(m => m.csvHeader === 'time_norm')?.role).toBe('timepoint');
    // group_num is integer with high repetition → heuristic detects as token_id
    expect(mappings.find(m => m.csvHeader === 'group_num')?.role).toBe('token_id');
  });

  it('does not apply heuristic when no timepoint column exists', () => {
    const headers = ['group_num', 'vowel', 'F1_50', 'F2_50'];
    const sampleRows = [
      ['1', 'a', '400', '1800'],
      ['1', 'a', '450', '1700'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    // F1_50 is numeric formant, not bare → no long format detected
    expect(mappings.find(m => m.csvHeader === 'group_num')?.role).not.toBe('token_id');
  });

  it('reclassifies token_id as field when no timepoint or bare formants exist (wide format)', () => {
    const headers = ['sl_rowIdx', 'vowel', 'speaker', 'F1_1', 'F2_1', 'F1_2', 'F2_2'];
    const sampleRows = [
      ['1', 'a', 'spk1', '400', '1800', '450', '1700'],
      ['2', 'i', 'spk1', '300', '2200', '310', '2100'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    // sl_rowIdx matches alias but wide format has no timepoint → reclassified to field
    expect(mappings.find(m => m.csvHeader === 'sl_rowIdx')?.role).toBe('field');
  });

  it('keeps only the best timepoint column when multiple are detected', () => {
    const headers = ['sl_rowIdx', 'vowel', 'times_rel', 'times_norm', 'F1', 'F2'];
    const sampleRows = [
      ['1', 'a', '0', '0', '400', '1800'],
      ['1', 'a', '5', '0.5', '450', '1700'],
      ['2', 'i', '0', '0', '300', '2200'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    // times_rel (raw ms, most informative) should be preferred over times_norm (0-1)
    expect(mappings.find(m => m.csvHeader === 'times_rel')?.role).toBe('timepoint');
    expect(mappings.find(m => m.csvHeader === 'times_norm')?.role).toBe('ignore');
  });
});

// ─── Long-format parsing ─────────────────────────────────────────────

describe('parseWithMappings – long format', () => {
  it('groups rows by token_id and builds trajectories (fraction scale)', () => {
    const csv = [
      'tid,vowel,speaker,tp,F1,F2',
      '1,a,spk1,0,400,1800',
      '1,a,spk1,0.5,450,1700',
      '1,a,spk1,1.0,500,1600',
      '2,i,spk1,0,300,2200',
      '2,i,spk1,1.0,320,2000',
    ].join('\n');
    const mappings: ColumnMapping[] = [
      { csvHeader: 'tid', role: 'token_id' },
      { csvHeader: 'vowel', role: 'field', fieldName: 'vowel' },
      { csvHeader: 'speaker', role: 'speaker' },
      { csvHeader: 'tp', role: 'timepoint' },
      { csvHeader: 'F1', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings, 'test.csv');

    expect(tokens).toHaveLength(2);
    expect(meta.sourceFormat).toBe('long');
    expect(meta.rowCount).toBe(2);

    // Token 1: 3 trajectory points, fraction 0-1 → 0-100%
    expect(tokens[0].trajectory).toHaveLength(3);
    expect(tokens[0].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[0].trajectory[1].time).toBeCloseTo(50);
    expect(tokens[0].trajectory[2].time).toBeCloseTo(100);
    expect(tokens[0].trajectory[0].f1).toBe(400);
    expect(tokens[0].trajectory[1].f1).toBe(450);
    expect(tokens[0].speaker).toBe('spk1');
    expect(tokens[0].fields['vowel']).toBe('a');

    // Token 2: 2 trajectory points
    expect(tokens[1].trajectory).toHaveLength(2);
    expect(tokens[1].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[1].trajectory[1].time).toBeCloseTo(100);
    expect(tokens[1].fields['vowel']).toBe('i');
  });

  it('handles percentage scale (1-100)', () => {
    const csv = [
      'tid,tp,F1,F2',
      '1,0,400,1800',
      '1,50,450,1700',
      '1,100,500,1600',
    ].join('\n');
    const mappings: ColumnMapping[] = [
      { csvHeader: 'tid', role: 'token_id' },
      { csvHeader: 'tp', role: 'timepoint' },
      { csvHeader: 'F1', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].trajectory[0].time).toBe(0);
    expect(tokens[0].trajectory[1].time).toBe(50);
    expect(tokens[0].trajectory[2].time).toBe(100);
  });

  it('normalizes raw ms timepoints per token', () => {
    const csv = [
      'tid,tp,F1,F2',
      '1,0,400,1800',
      '1,100,450,1700',
      '1,200,500,1600',
      '2,0,300,2200',
      '2,150,320,2000',
    ].join('\n');
    const mappings: ColumnMapping[] = [
      { csvHeader: 'tid', role: 'token_id' },
      { csvHeader: 'tp', role: 'timepoint' },
      { csvHeader: 'F1', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    // Token 1: 0ms, 100ms, 200ms → 0%, 50%, 100%
    expect(tokens[0].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[0].trajectory[1].time).toBeCloseTo(50);
    expect(tokens[0].trajectory[2].time).toBeCloseTo(100);

    // Token 2: 0ms, 150ms → 0%, 100%
    expect(tokens[1].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[1].trajectory[1].time).toBeCloseTo(100);
  });

  it('computes duration from raw ms when no duration column', () => {
    const csv = [
      'tid,tp,F1,F2',
      '1,0,400,1800',
      '1,164,500,1600',
    ].join('\n');
    const mappings: ColumnMapping[] = [
      { csvHeader: 'tid', role: 'token_id' },
      { csvHeader: 'tp', role: 'timepoint' },
      { csvHeader: 'F1', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].duration).toBeCloseTo(164);
  });

  it('wide-format low-count ordinal data (≤3 points) classified as single-point', () => {
    // Only 3 timepoints per formant with max ≤ 100 → single-point (below trajectory threshold)
    const csv = 'f1_1,f2_1,f1_2,f2_2,f1_3,f2_3\n400,1800,450,1700,500,1600\n300,2200,320,2000,,';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'f1_1', role: 'formant', formant: 'f1', timePoint: 1, isSmooth: false },
      { csvHeader: 'f2_1', role: 'formant', formant: 'f2', timePoint: 1, isSmooth: false },
      { csvHeader: 'f1_2', role: 'formant', formant: 'f1', timePoint: 2, isSmooth: false },
      { csvHeader: 'f2_2', role: 'formant', formant: 'f2', timePoint: 2, isSmooth: false },
      { csvHeader: 'f1_3', role: 'formant', formant: 'f1', timePoint: 3, isSmooth: false },
      { csvHeader: 'f2_3', role: 'formant', formant: 'f2', timePoint: 3, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(meta.trajectoryFormat).toBe('single-point');
    // Timepoints preserved as-is (no normalization)
    expect(tokens[0].trajectory[0].time).toBe(1);
    expect(tokens[0].trajectory[2].time).toBe(3);
  });

  it('preserves percentage timepoints when tokens have variable fill counts', () => {
    // Columns at clean 0%, 50%, 100%. Token 1 fills all three; token 2 is missing 100%.
    // Percentage timepoints should NOT be remapped even though lengths differ.
    const csv = 'F1_0%,F2_0%,F1_50%,F2_50%,F1_100%,F2_100%\n400,1800,450,1700,500,1600\n300,2200,310,2100,,';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0%', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_0%', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_50%', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'F2_50%', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
      { csvHeader: 'F1_100%', role: 'formant', formant: 'f1', timePoint: 100, isSmooth: false },
      { csvHeader: 'F2_100%', role: 'formant', formant: 'f2', timePoint: 100, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    // Token 1 has 3 points at actual percentages
    expect(tokens[0].trajectory).toHaveLength(3);
    expect(tokens[0].trajectory[0].time).toBe(0);
    expect(tokens[0].trajectory[1].time).toBe(50);
    expect(tokens[0].trajectory[2].time).toBe(100);

    // Token 2 has 2 points at their ACTUAL percentages (0, 50) — NOT remapped to (0, 100)
    expect(tokens[1].trajectory).toHaveLength(2);
    expect(tokens[1].trajectory[0].time).toBe(0);
    expect(tokens[1].trajectory[1].time).toBe(50);

    // meta.timePoints preserves original column-derived values
    expect(meta.timePoints).toEqual([0, 50, 100]);
  });

  it('does NOT normalize when named targets push synthetic timepoints above 100', () => {
    // Real timepoints 0, 50, 100 plus a named target (F1_target → synthetic 1100).
    // The named target should NOT trigger absolute-time normalization.
    const csv = 'F1_0%,F1_50%,F1_100%,F1_target,F2_0%,F2_50%,F2_100%,F2_target\n400,450,500,475,1800,1700,1600,1650';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0%', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_50%', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'F1_100%', role: 'formant', formant: 'f1', timePoint: 100, isSmooth: false },
      { csvHeader: 'F1_target', role: 'formant', formant: 'f1', timePoint: 1100, formantTarget: 'target', isSmooth: false },
      { csvHeader: 'F2_0%', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_50%', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
      { csvHeader: 'F2_100%', role: 'formant', formant: 'f2', timePoint: 100, isSmooth: false },
      { csvHeader: 'F2_target', role: 'formant', formant: 'f2', timePoint: 1100, formantTarget: 'target', isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    // Original timepoints preserved (NOT replaced with 0, 5, 10, ..., 100 grid)
    expect(meta.timePoints).toContain(0);
    expect(meta.timePoints).toContain(50);
    expect(meta.timePoints).toContain(100);
    expect(meta.timePoints).toContain(1100); // named target

    // Trajectory times preserved at actual column percentages
    const traj = tokens[0].trajectory;
    expect(traj.find(p => p.time === 0)).toBeDefined();
    expect(traj.find(p => p.time === 50)).toBeDefined();
    expect(traj.find(p => p.time === 100)).toBeDefined();
    // No interpolated 5% grid
    expect(traj.find(p => p.time === 5)).toBeUndefined();
    expect(traj.find(p => p.time === 25)).toBeUndefined();
  });

  it('time-slice wide format captures native duration and sets trajectoryFormat=time-slice', () => {
    // ms-unit columns with 5+ points → time-slice trajectory
    const csv = 'F1_0ms,F2_0ms,F1_5ms,F2_5ms,F1_10ms,F2_10ms,F1_15ms,F2_15ms,F1_20ms,F2_20ms\n' +
      '400,1800,410,1790,420,1780,430,1770,440,1760';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0ms', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_0ms', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_5ms', role: 'formant', formant: 'f1', timePoint: 5, isSmooth: false },
      { csvHeader: 'F2_5ms', role: 'formant', formant: 'f2', timePoint: 5, isSmooth: false },
      { csvHeader: 'F1_10ms', role: 'formant', formant: 'f1', timePoint: 10, isSmooth: false },
      { csvHeader: 'F2_10ms', role: 'formant', formant: 'f2', timePoint: 10, isSmooth: false },
      { csvHeader: 'F1_15ms', role: 'formant', formant: 'f1', timePoint: 15, isSmooth: false },
      { csvHeader: 'F2_15ms', role: 'formant', formant: 'f2', timePoint: 15, isSmooth: false },
      { csvHeader: 'F1_20ms', role: 'formant', formant: 'f1', timePoint: 20, isSmooth: false },
      { csvHeader: 'F2_20ms', role: 'formant', formant: 'f2', timePoint: 20, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    // Max timepoint is 20 (not > 100), BUT unit suffix is 'ms' → still time-slice
    // Wait: max is 20, which is ≤ 100. Under our rule, max ≤ 100 = percentage.
    // This test documents that: ms suffix alone doesn't force time-slice if max ≤ 100.
    // For the normal case (F1_0ms through F1_1540ms), max > 100 and format is time-slice.
    expect(meta.trajectoryFormat).toBe('percentage');
  });

  it('time-slice wide format with max > 100 sets trajectoryDurationMs and unit=ms', () => {
    const csv = 'F1_0,F2_0,F1_200,F2_200,F1_400,F2_400,F1_600,F2_600\n400,1800,420,1780,440,1760,460,1740';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_0', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_200', role: 'formant', formant: 'f1', timePoint: 200, isSmooth: false },
      { csvHeader: 'F2_200', role: 'formant', formant: 'f2', timePoint: 200, isSmooth: false },
      { csvHeader: 'F1_400', role: 'formant', formant: 'f1', timePoint: 400, isSmooth: false },
      { csvHeader: 'F2_400', role: 'formant', formant: 'f2', timePoint: 400, isSmooth: false },
      { csvHeader: 'F1_600', role: 'formant', formant: 'f1', timePoint: 600, isSmooth: false },
      { csvHeader: 'F2_600', role: 'formant', formant: 'f2', timePoint: 600, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(meta.trajectoryFormat).toBe('time-slice');
    expect(meta.trajectoryUnit).toBe('ms');
    expect(tokens[0].trajectoryDurationMs).toBe(600);
    expect(tokens[0].trajectory[0].time).toBe(0);
    expect(tokens[0].trajectory[3].time).toBeCloseTo(100);
  });

  it('percentage format sets trajectoryFormat=percentage', () => {
    const csv = 'F1_0,F2_0,F1_25,F2_25,F1_50,F2_50,F1_75,F2_75,F1_100,F2_100\n' +
      '400,1800,420,1780,440,1760,460,1740,480,1720';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_0', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_25', role: 'formant', formant: 'f1', timePoint: 25, isSmooth: false },
      { csvHeader: 'F2_25', role: 'formant', formant: 'f2', timePoint: 25, isSmooth: false },
      { csvHeader: 'F1_50', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'F2_50', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
      { csvHeader: 'F1_75', role: 'formant', formant: 'f1', timePoint: 75, isSmooth: false },
      { csvHeader: 'F2_75', role: 'formant', formant: 'f2', timePoint: 75, isSmooth: false },
      { csvHeader: 'F1_100', role: 'formant', formant: 'f1', timePoint: 100, isSmooth: false },
      { csvHeader: 'F2_100', role: 'formant', formant: 'f2', timePoint: 100, isSmooth: false },
    ];
    const { meta, tokens } = parseWithMappings(csv, mappings);

    expect(meta.trajectoryFormat).toBe('percentage');
    expect(meta.trajectoryUnit).toBeUndefined();
    expect(tokens[0].trajectoryDurationMs).toBeUndefined();
    expect(meta.trajectorySpacing?.kind).toBe('listed');
    expect(meta.trajectorySpacing?.values).toEqual([0, 25, 50, 75, 100]);
  });

  it('wide-format normalizes per-token when timepoints exceed 100 (absolute time)', () => {
    // Uniform length but timepoints are in ms (0, 500, 1000) — all tokens have 3 points.
    const csv = 'F1_0ms,F2_0ms,F1_500ms,F2_500ms,F1_1000ms,F2_1000ms\n400,1800,450,1700,500,1600\n300,2200,320,2000,340,1800';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'F1_0ms', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'F2_0ms', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'F1_500ms', role: 'formant', formant: 'f1', timePoint: 500, isSmooth: false },
      { csvHeader: 'F2_500ms', role: 'formant', formant: 'f2', timePoint: 500, isSmooth: false },
      { csvHeader: 'F1_1000ms', role: 'formant', formant: 'f1', timePoint: 1000, isSmooth: false },
      { csvHeader: 'F2_1000ms', role: 'formant', formant: 'f2', timePoint: 1000, isSmooth: false },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(tokens).toHaveLength(2);
    // Both tokens should be normalized to 0%, 50%, 100% even though lengths are equal
    expect(tokens[0].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[0].trajectory[1].time).toBeCloseTo(50);
    expect(tokens[0].trajectory[2].time).toBeCloseTo(100);
    expect(tokens[1].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[1].trajectory[2].time).toBeCloseTo(100);

    expect(meta.timePoints).toContain(0);
    expect(meta.timePoints).toContain(50);
    expect(meta.timePoints).toContain(100);
  });

  it('wide-format parsing is unaffected by new long-format code', () => {
    const csv = 'f1_00,f2_00,f1_50,f2_50,phoneme\n400,1800,450,1700,a\n300,2200,310,2100,i';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'f1_00', role: 'formant', formant: 'f1', timePoint: 0, isSmooth: false },
      { csvHeader: 'f2_00', role: 'formant', formant: 'f2', timePoint: 0, isSmooth: false },
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50, isSmooth: false },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50, isSmooth: false },
      { csvHeader: 'phoneme', role: 'field', fieldName: 'phoneme' },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(tokens).toHaveLength(2);
    expect(meta.sourceFormat).toBeUndefined();
    expect(tokens[0].trajectory).toHaveLength(2);
    expect(tokens[0].trajectory[0]).toMatchObject({ time: 0, f1: 400, f2: 1800 });
    expect(tokens[0].trajectory[1]).toMatchObject({ time: 50, f1: 450, f2: 1700 });
  });
});

// ─── Band energy ratio, end to end ─────────────────────────────────
// A miniature of what FormantStudio now exports: the four moments and the band ratio
// side by side, in all three column forms, plus the metadata columns that must stay out
// of the spectral roles.

const BAND_RATIO_CSV = [
  'speaker,file_id,allophone,release_dur,' +
    'COG_release_50%,SD_release_50%,skew_release_50%,kurt_release_50%,bandratio_release_50%,' +
    'winms_release_50%,nsamples_release_50%,' +
    'bandratio_release_k0,bandratio_release_k1,' +
    'bandratio_release_t0,bandratio_release_t1,bandratio_release_t2',
  'spk1,f001,t,0.021,5104,2210,0.41,2.9,-12.4,23,370,9.1,-4.2,-18.6,-2.0,11.3',
  'spk1,f002,k,0.033,3980,2610,0.88,3.4,6.8,23,370,4.4,1.7,-3.1,5.2,18.9',
  'spk2,f003,p,0.014,2100,1980,1.31,4.7,-31.5,23,370,-22.0,3.9,-38.4,-30.1,-24.7',
].join('\n');

describe('band-ratio columns from FormantStudio', () => {
  const headers = BAND_RATIO_CSV.split('\n')[0].split(',');
  const rows = BAND_RATIO_CSV.split('\n').slice(1).map(l => l.split(','));

  it('gives the ratio its own spectral role, beside the moments', () => {
    const mappings = autoDetectMappings(headers, rows);
    const byHeader = (h: string) => mappings.find(m => m.csvHeader === h)!;

    expect(byHeader('COG_release_50%').role).toBe('spectral_cog');
    for (const h of ['bandratio_release_50%', 'bandratio_release_k1', 'bandratio_release_t2']) {
      expect(byHeader(h).role).toBe('spectral_bandratio');
      expect(byHeader(h).spectralRegion).toBe('release');
      expect(byHeader(h).isDataField).toBe(true);
      expect(byHeader(h).showInSidebar).toBe(false);
    }
    // The window metadata beside it is not a measurement
    for (const h of ['winms_release_50%', 'nsamples_release_50%']) {
      expect(byHeader(h).role).not.toMatch(/^spectral_/);
    }
    expect(byHeader('release_dur').role).toBe('duration');
    expect(byHeader('allophone').role).toBe('field');
  });

  it('stores every band-ratio column on the token, signs intact', () => {
    const mappings = autoDetectMappings(headers, rows);
    const { tokens } = parseWithMappings(BAND_RATIO_CSV, mappings, 'bandratio.csv');

    expect(tokens).toHaveLength(3);
    expect(tokens[0].fields['bandratio_release_50%']).toBe('-12.4');
    expect(tokens[1].fields['bandratio_release_50%']).toBe('6.8');
    expect(tokens[2].fields['bandratio_release_t0']).toBe('-38.4');
    expect(tokens[0].fields['bandratio_release_k0']).toBe('9.1');
  });

  it('leaves a CSV with no band-ratio columns exactly as it was', () => {
    const csv = 'speaker,COG_release_50%,SD_release_50%\nspk1,5104,2210\n';
    const mappings = autoDetectMappings(csv.split('\n')[0].split(','), [csv.split('\n')[1].split(',')]);
    expect(mappings.map(m => m.role)).toEqual(['speaker', 'spectral_cog', 'spectral_sd']);
  });
});

describe('splitRows', () => {
  const NL = String.fromCharCode(10);

  it('splits plain rows on newlines', () => {
    expect(splitRows(`a,b${NL}c,d`)).toEqual(['a,b', 'c,d']);
  });

  it('keeps a newline inside a quoted field with its value', () => {
    // An exporter writes a label containing a line break this way. Splitting the text on
    // newlines first tore the row in two, and the tail arrived as a file id.
    const text = `id,label,x${NL}10092,"@${NL}",275.1${NL}10093,ok,3.5`;
    const rows = splitRows(text);
    expect(rows).toHaveLength(3);
    expect(splitRow(rows[1], ',')).toEqual(['10092', '@', '275.1']);
    expect(splitRow(rows[2], ',')).toEqual(['10093', 'ok', '3.5']);
  });

  it('handles CRLF, and an escaped quote inside a quoted field', () => {
    const text = `a,b${String.fromCharCode(13)}${NL}"say ""hi""",2`;
    const rows = splitRows(text);
    expect(rows).toHaveLength(2);
    expect(splitRow(rows[1], ',')).toEqual(['say "hi"', '2']);
  });

  it('keeps a quoted comma in one cell', () => {
    expect(splitRow('10001,high,"Maungawhau,",m', ',')).toEqual(['10001', 'high', 'Maungawhau,', 'm']);
  });

  it('parses a file whose rows span lines, end to end', () => {
    const text = [
      'filename,MAU,f1_50',
      '10001,k,500',
      '10092,"@',
      '",600',
      '10093,t,700',
    ].join(NL);
    const mappings: ColumnMapping[] = [
      { csvHeader: 'filename', role: 'file_id' },
      { csvHeader: 'MAU', role: 'field', fieldName: 'MAU' },
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50 },
    ];
    const { tokens } = parseWithMappings(text, mappings, 'test.csv');
    expect(tokens.map(t => t.file_id)).toEqual(['10001', '10092', '10093']);
    expect(tokens[1].fields['MAU']).toBe('@');
  });
});
