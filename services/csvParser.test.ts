import { describe, it, expect } from 'vitest';
import {
  detectDelimiter,
  splitRow,
  autoDetectMappings,
  parseWithMappings,
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

  it('wide-format normalizes per-token when tokens have variable-length trajectories', () => {
    // Token 1 has 3 timepoints, token 2 has 2 — variable length triggers normalization
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

    expect(tokens).toHaveLength(2);

    // Token 1 (3 points): remapped to 0%, 50%, 100%
    expect(tokens[0].trajectory).toHaveLength(3);
    expect(tokens[0].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[0].trajectory[1].time).toBeCloseTo(50);
    expect(tokens[0].trajectory[2].time).toBeCloseTo(100);

    // Token 2 (2 points): remapped to 0%, 100%
    expect(tokens[1].trajectory).toHaveLength(2);
    expect(tokens[1].trajectory[0].time).toBeCloseTo(0);
    expect(tokens[1].trajectory[1].time).toBeCloseTo(100);

    // UI timepoints replaced with common grid
    expect(meta.timePoints).toContain(0);
    expect(meta.timePoints).toContain(50);
    expect(meta.timePoints).toContain(100);
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
