import { describe, it, expect } from 'vitest';
import {
  parseSpeechCSV,
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
  it('maps known aliases to built-in roles', () => {
    const headers = ['speaker', 'vowel', 'dur', 'pitch'];
    const sampleRows = [
      ['spk1', 'a', '0.12', '120'],
      ['spk2', 'i', '0.15', '130'],
    ];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings.find(m => m.csvHeader === 'speaker')?.role).toBe('file_id');
    expect(mappings.find(m => m.csvHeader === 'vowel')?.role).toBe('canonical');
    expect(mappings.find(m => m.csvHeader === 'dur')?.role).toBe('duration');
    expect(mappings.find(m => m.csvHeader === 'pitch')?.role).toBe('voice_pitch');
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

  it('classifies low-cardinality unknown columns as custom', () => {
    const headers = ['dialect'];
    const sampleRows = [['north'], ['south'], ['north'], ['east']];
    const mappings = autoDetectMappings(headers, sampleRows);

    expect(mappings[0].role).toBe('custom');
    expect(mappings[0].customFieldName).toBe('dialect');
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
  it('parses CSV into correct SpeechToken fields via mappings', () => {
    const csv = 'speaker,vowel,word\nspk1,a,cat\nspk2,i,sit';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'speaker', role: 'file_id' },
      { csvHeader: 'vowel', role: 'canonical' },
      { csvHeader: 'word', role: 'word' },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings, 'test.csv');

    expect(tokens).toHaveLength(2);
    expect(tokens[0].file_id).toBe('spk1');
    expect(tokens[0].canonical).toBe('a');
    expect(tokens[0].word).toBe('cat');
    expect(tokens[1].file_id).toBe('spk2');
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

  it('populates customFields for custom-role columns', () => {
    const csv = 'vowel,dialect,age\na,northern,young\ni,southern,old';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'vowel', role: 'canonical' },
      { csvHeader: 'dialect', role: 'custom', customFieldName: 'dialect' },
      { csvHeader: 'age', role: 'custom', customFieldName: 'age' },
    ];
    const { tokens, meta } = parseWithMappings(csv, mappings);

    expect(tokens[0].customFields).toEqual({ dialect: 'northern', age: 'young' });
    expect(tokens[1].customFields).toEqual({ dialect: 'southern', age: 'old' });
    expect(meta.customColumns).toEqual(['dialect', 'age']);
  });

  it('skips ignore-role columns', () => {
    const csv = 'vowel,junk\na,xyz\ni,abc';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'vowel', role: 'canonical' },
      { csvHeader: 'junk', role: 'ignore' },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].canonical).toBe('a');
    // 'junk' should not appear in customFields
    expect(tokens[0].customFields).toBeUndefined();
  });

  it('returns correct DatasetMeta', () => {
    const csv = 'vowel,f1_00,f2_00,f1_50,f2_50,region\na,400,1800,450,1700,east';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'vowel', role: 'canonical' },
      { csvHeader: 'f1_00', role: 'formant', formant: 'f1', timePoint: 0 },
      { csvHeader: 'f2_00', role: 'formant', formant: 'f2', timePoint: 0 },
      { csvHeader: 'f1_50', role: 'formant', formant: 'f1', timePoint: 50 },
      { csvHeader: 'f2_50', role: 'formant', formant: 'f2', timePoint: 50 },
      { csvHeader: 'region', role: 'custom', customFieldName: 'region' },
    ];
    const { meta } = parseWithMappings(csv, mappings, 'data.csv');

    expect(meta.timePoints).toEqual([0, 50]);
    expect(meta.customColumns).toEqual(['region']);
    expect(meta.rowCount).toBe(1);
    expect(meta.fileName).toBe('data.csv');
  });

  it('handles tab-delimited input', () => {
    const tsv = 'vowel\tword\na\tcat\ni\tsit';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'vowel', role: 'canonical' },
      { csvHeader: 'word', role: 'word' },
    ];
    const { tokens } = parseWithMappings(tsv, mappings);

    expect(tokens).toHaveLength(2);
    expect(tokens[0].canonical).toBe('a');
    expect(tokens[0].word).toBe('cat');
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
    const csv = 'vowel\na';
    const mappings: ColumnMapping[] = [
      { csvHeader: 'vowel', role: 'canonical' },
    ];
    const { tokens } = parseWithMappings(csv, mappings);

    expect(tokens[0].file_id).toBe('');
    expect(tokens[0].word).toBe('');
    expect(tokens[0].type).toBe('vowel');
    expect(tokens[0].canonical_type).toBe('vowel');
    expect(tokens[0].xmin).toBe(0);
    expect(tokens[0].duration).toBe(0);
    expect(tokens[0].trajectory).toEqual([]);
  });
});

// ─── parseSpeechCSV (regression) ───────────────────────────────────

describe('parseSpeechCSV', () => {
  it('parses original fixed-format CSV correctly', () => {
    const csv = [
      'file_id,word,syllable,syllable_mark,canonical_stress,lexical_stress,canonical,produced,alignment,type,canonical_type,voice_pitch,xmin,duration,f1_00,f2_00,f1_50,f2_50',
      'spk01,cat,cat,1,primary,stressed,æ,æ,correct,vowel,monophthong,low,0.5,0.12,700,1800,720,1750',
    ].join('\n');

    const tokens = parseSpeechCSV(csv);

    expect(tokens).toHaveLength(1);
    const t = tokens[0];
    expect(t.file_id).toBe('spk01');
    expect(t.word).toBe('cat');
    expect(t.canonical).toBe('æ');
    expect(t.alignment).toBe('correct');
    expect(t.type).toBe('vowel');
    expect(t.voice_pitch).toBe('low');
    expect(t.xmin).toBe(0.5);
    expect(t.duration).toBe(0.12);
    expect(t.trajectory).toHaveLength(2);
    expect(t.trajectory[0]).toMatchObject({ time: 0, f1: 700, f2: 1800 });
    expect(t.trajectory[1]).toMatchObject({ time: 50, f1: 720, f2: 1750 });
  });

  it('returns empty array for input with no data rows', () => {
    expect(parseSpeechCSV('header_only')).toEqual([]);
    expect(parseSpeechCSV('')).toEqual([]);
  });
});
