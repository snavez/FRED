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
    expect(mappings.find(m => m.csvHeader === 'onset')?.role).toBe('xmin');
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
