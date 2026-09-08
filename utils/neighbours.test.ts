import { describe, it, expect } from 'vitest';
import { ColumnMapping, SpeechToken } from '../types';
import {
  findLabelColumns,
  findTimeColumns,
  resolveNeighbours,
  segmentToken,
  tokenIndex,
} from './neighbours';

const tok = (id: string, file: string, fields: Record<string, string>): SpeechToken =>
  ({ id, speaker: 's', file_id: file, xmin: 0, duration: 0, trajectory: [], fields } as SpeechToken);

const col = (csvHeader: string): ColumnMapping => ({ csvHeader, role: 'field', fieldName: csvHeader });
const MAPPINGS = ['MAU', 'MAU_prev', 'MAU_next', 'MAU_start', 'MAU_end'].map(col);

/** Three contiguous segments of one recording: t → e → k. */
const run = (): SpeechToken[] => [
  tok('1', 'f1', { MAU: 't', MAU_prev: '', MAU_next: 'e', MAU_start: '0.0', MAU_end: '0.1' }),
  tok('2', 'f1', { MAU: 'e', MAU_prev: 't', MAU_next: 'k', MAU_start: '0.1', MAU_end: '0.3' }),
  tok('3', 'f1', { MAU: 'k', MAU_prev: 'e', MAU_next: '', MAU_start: '0.3', MAU_end: '0.4' }),
];

describe('findLabelColumns', () => {
  it('finds a prev/next pair whose base is also a column', () => {
    expect(findLabelColumns(MAPPINGS)).toEqual({ base: 'MAU', prev: 'MAU_prev', next: 'MAU_next' });
  });

  it('ignores a _next column with no base and no _prev', () => {
    expect(findLabelColumns([col('word'), col('foo_next')])).toBeNull();
    expect(findLabelColumns([col('MAU'), col('MAU_next')])).toBeNull();
  });
});

describe('findTimeColumns', () => {
  it('finds a start/end pair', () => {
    expect(findTimeColumns(MAPPINGS)).toEqual({ start: 'MAU_start', end: 'MAU_end' });
  });

  it('recognises the bare xmin/xmax spelling a Praat export uses', () => {
    expect(findTimeColumns([col('MAU'), col('xmin'), col('xmax')]))
      .toEqual({ start: 'xmin', end: 'xmax' });
  });

  it('prefers the pair named after the segment column', () => {
    const both = [col('MAU'), col('MAU_start'), col('MAU_end'), col('xmin'), col('xmax')];
    expect(findTimeColumns(both)).toEqual({ start: 'MAU_start', end: 'MAU_end' });
  });

  it('has nothing to find without one', () => {
    expect(findTimeColumns([col('MAU'), col('duration')])).toBeNull();
  });
});

describe('resolveNeighbours', () => {
  it('links each segment to the ones beside it', () => {
    const tokens = run();
    const report = resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBe('2');
    expect(tokens[1].prevId).toBe('1');
    expect(tokens[1].nextId).toBe('3');
    expect(report.basis).toBe('labels+time');
    expect(report.linked).toBe(3);
  });

  it('leaves the ends of a recording unlinked', () => {
    const tokens = run();
    resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].prevId).toBeUndefined();
    expect(tokens[2].nextId).toBeUndefined();
  });

  it('never links across recordings', () => {
    const tokens = [
      tok('1', 'f1', { MAU: 't', MAU_prev: '', MAU_next: '', MAU_start: '0.0', MAU_end: '0.1' }),
      tok('2', 'f2', { MAU: 'e', MAU_prev: '', MAU_next: '', MAU_start: '0.0', MAU_end: '0.2' }),
    ];
    resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBeUndefined();
    expect(tokens[1].prevId).toBeUndefined();
  });

  it('refuses to link across an unlabelled pause — the reported case', () => {
    // A missing <p:> row: the two segments sit next to each other in the file but are
    // 48 ms apart, and the extraction already says neither has a neighbour.
    const tokens = [
      tok('1', 'f1', { MAU: 'o', MAU_prev: 'k', MAU_next: '', MAU_start: '14.8', MAU_end: '14.964' }),
      tok('2', 'f1', { MAU: 'p_h', MAU_prev: '', MAU_next: 'a', MAU_start: '15.0127', MAU_end: '15.1' }),
    ];
    const report = resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBeUndefined();
    expect(tokens[1].prevId).toBeUndefined();
    expect(report.rejected).toBe(1);
  });

  it('refuses when the neighbour label names a different segment', () => {
    const tokens = run();
    tokens[0].fields.MAU_next = 'a';
    resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBeUndefined();
  });

  it('refuses when the segments are not contiguous in time', () => {
    const tokens = run();
    tokens[1].fields.MAU_start = '0.2';
    resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBeUndefined();
    expect(tokens[1].nextId).toBe('3');
  });

  it('falls back to row order, and says so, when neither check is available', () => {
    const bare = [col('MAU')];
    const tokens = [
      tok('1', 'f1', { MAU: 't' }),
      tok('2', 'f1', { MAU: 'e' }),
    ];
    const report = resolveNeighbours(tokens, bare);
    expect(tokens[0].nextId).toBe('2');
    expect(report.basis).toBe('rows');
    expect(report.suggested.length).toBe(2);
  });

  it('reports labels alone when there are no segment times', () => {
    const noTimes = ['MAU', 'MAU_prev', 'MAU_next'].map(col);
    const report = resolveNeighbours(run(), noTimes);
    expect(report.basis).toBe('labels');
    expect(report.suggested.join(' ')).toMatch(/MAU_start/);
  });

  it('clears links from a previous resolution', () => {
    const tokens = run();
    resolveNeighbours(tokens, MAPPINGS);
    tokens[0].fields.MAU_next = 'a';
    resolveNeighbours(tokens, MAPPINGS);
    expect(tokens[0].nextId).toBeUndefined();
  });
});

describe('segmentToken', () => {
  it('follows a link to the segment beside it', () => {
    const tokens = run();
    resolveNeighbours(tokens, MAPPINGS);
    const index = tokenIndex(tokens);
    expect(segmentToken(tokens[0], 'this', index)).toBe(tokens[0]);
    expect(segmentToken(tokens[0], 'next', index)).toBe(tokens[1]);
    expect(segmentToken(tokens[1], 'prev', index)).toBe(tokens[0]);
  });

  it('has nothing to return where there is no neighbour', () => {
    const tokens = run();
    resolveNeighbours(tokens, MAPPINGS);
    const index = tokenIndex(tokens);
    expect(segmentToken(tokens[0], 'prev', index)).toBeNull();
    expect(segmentToken(tokens[2], 'next', index)).toBeNull();
  });

  it('finds a neighbour that the filters removed', () => {
    // The point of looking up in the whole dataset: filtering to consonants must not
    // strip the vowel an axis is reading.
    const tokens = run();
    resolveNeighbours(tokens, MAPPINGS);
    const index = tokenIndex(tokens);
    const filtered = tokens.filter(t => t.fields.MAU === 't');
    expect(filtered).toHaveLength(1);
    expect(segmentToken(filtered[0], 'next', index)).toBe(tokens[1]);
  });
});
