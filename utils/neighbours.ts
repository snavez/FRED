import { ColumnMapping, NeighbourBasis, NeighbourReport, SegmentRef, SpeechToken } from '../types';

export const SEGMENT_LABELS: Record<SegmentRef, string> = {
  this: 'this segment',
  prev: 'preceding segment',
  next: 'following segment',
};

/** Gap between segments tolerated as contiguous, in whatever unit the columns use. */
const TIME_TOLERANCE = 1e-6;

/** The column pair naming a token's neighbours, e.g. MAU_prev / MAU_next. */
interface LabelColumns { base: string; prev: string; next: string }

/** The column pair bounding a token in time, e.g. MAU_start / MAU_end. */
interface TimeColumns { start: string; end: string }

const columnKeys = (mappings: ColumnMapping[]): string[] =>
  mappings.filter(m => m.role !== 'ignore').map(m => m.fieldName || m.csvHeader).filter(Boolean);

/**
 * Find a `<base>_prev` / `<base>_next` pair whose base is itself a column — so `MAU_prev`
 * and `MAU_next` qualify beside `MAU`, while a stray `foo_next` with no `foo` does not.
 */
export const findLabelColumns = (mappings: ColumnMapping[]): LabelColumns | null => {
  const keys = columnKeys(mappings);
  const has = new Set(keys.map(k => k.toLowerCase()));
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (!lower.endsWith('_next')) continue;
    const base = key.slice(0, -'_next'.length);
    const prev = `${base}_prev`;
    if (has.has(base.toLowerCase()) && has.has(prev.toLowerCase())) {
      return { base, prev: keys.find(k => k.toLowerCase() === prev.toLowerCase())!, next: key };
    }
  }
  return null;
};

/** Column pairs that bound a segment in time under names other than `_start`/`_end`. */
const TIME_ALIASES: [string, string][] = [['xmin', 'xmax'], ['start', 'end'], ['begin', 'end']];

/**
 * Find the pair of columns bounding each segment in time.
 *
 * A `<base>_start` / `<base>_end` pair whose base is also a column wins, since it names
 * the very segment the rows describe (`MAU_start` beside `MAU`). Failing that, any such
 * pair, then the common bare spellings — a Praat-style export bounds its intervals with
 * `xmin` and `xmax` and would otherwise look like it had no times at all.
 */
export const findTimeColumns = (mappings: ColumnMapping[]): TimeColumns | null => {
  const keys = columnKeys(mappings);
  const has = new Set(keys.map(k => k.toLowerCase()));
  const find = (name: string) => keys.find(k => k.toLowerCase() === name.toLowerCase());
  let fallback: TimeColumns | null = null;
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (!lower.endsWith('_start')) continue;
    const base = key.slice(0, -'_start'.length);
    const end = find(`${base}_end`);
    if (!end) continue;
    const pair = { start: key, end };
    if (has.has(base.toLowerCase())) return pair;
    fallback = fallback || pair;
  }
  if (fallback) return fallback;
  for (const [start, end] of TIME_ALIASES) {
    const s = find(start), e = find(end);
    if (s && e) return { start: s, end: e };
  }
  return null;
};

const numeric = (raw: string | undefined): number | null => {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return isNaN(value) ? null : value;
};

const text = (raw: string | undefined): string => (raw ?? '').trim();

/**
 * Link each token to the segments beside it, in place, and report how it was decided.
 *
 * Row order alone is a guess: it is right whenever the file lists every segment of a
 * recording in sequence, and silently wrong wherever one is missing — an unlabelled pause
 * makes the rows either side look adjacent when they are not. Two kinds of column turn the
 * guess into a check:
 *
 *  - a **neighbour label** (`MAU_next`, `MAU_prev`) naming the segment beside this one,
 *    which must match the row it is linked to, and which is *empty* exactly where there is
 *    no neighbour — so it also says where not to link;
 *  - **start and end times** (`MAU_start`, `MAU_end`), where the next segment must begin
 *    where this one ended.
 *
 * Tokens are linked only to the adjacent row of the same recording, and only when every
 * available check agrees. Neither kind of column is required; a link resting on row order
 * alone is reported as such, so the plot can say so rather than imply a certainty it has
 * not earned.
 */
export const resolveNeighbours = (
  tokens: SpeechToken[], mappings: ColumnMapping[],
): NeighbourReport => {
  for (const token of tokens) { delete token.prevId; delete token.nextId; }

  const labels = findLabelColumns(mappings);
  const times = findTimeColumns(mappings);
  const basis: NeighbourBasis = labels && times ? 'labels+time'
    : labels ? 'labels' : times ? 'time' : 'rows';

  const suggested: string[] = [];
  if (!labels) suggested.push('a neighbour label pair such as MAU_prev / MAU_next');
  if (!times) suggested.push('segment times such as MAU_start / MAU_end');
  const used: string[] = [];
  if (labels) used.push(labels.prev, labels.next);
  if (times) used.push(times.start, times.end);

  let rejected = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i], b = tokens[i + 1];
    if (a.file_id !== b.file_id) continue;

    let ok = true;
    if (labels) {
      const aNext = text(a.fields[labels.next]);
      const bPrev = text(b.fields[labels.prev]);
      const aLabel = text(a.fields[labels.base]);
      const bLabel = text(b.fields[labels.base]);
      // An empty neighbour label says there is nothing beside it, not that it is unknown.
      if (aNext === '' || bPrev === '') ok = false;
      else if (aNext !== bLabel || bPrev !== aLabel) ok = false;
    }
    if (ok && times) {
      const end = numeric(a.fields[times.end]);
      const start = numeric(b.fields[times.start]);
      if (end === null || start === null || Math.abs(start - end) > TIME_TOLERANCE) ok = false;
    }
    if (!ok) { rejected++; continue; }
    a.nextId = b.id;
    b.prevId = a.id;
  }

  const linked = tokens.filter(t => t.prevId !== undefined || t.nextId !== undefined).length;
  return { basis, linked, rejected, suggested, used };
};

/** Index tokens by id, so a neighbour can be followed. */
export const tokenIndex = (tokens: SpeechToken[]): Map<string, SpeechToken> =>
  new Map(tokens.map(t => [t.id, t]));

/**
 * The token an axis should read, or null when the segment it asks for does not exist.
 *
 * Neighbours are looked up in the whole dataset rather than in what survived the filters:
 * you filter to choose which tokens to *plot*, and a token's neighbour is context around
 * it. Requiring the vowel to pass a filter aimed at the consonant would empty the plot.
 */
export const segmentToken = (
  token: SpeechToken, segment: SegmentRef, index: Map<string, SpeechToken>,
): SpeechToken | null => {
  if (segment === 'this') return token;
  const id = segment === 'next' ? token.nextId : token.prevId;
  return id === undefined ? null : index.get(id) ?? null;
};
