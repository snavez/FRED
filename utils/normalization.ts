import type { SpeechToken } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────

export type NormalizationMethod = 'hz' | 'bark' | 'erb' | 'mel' | 'lobanov' | 'nearey1';

export interface FormantStats {
  mean: number;
  sd: number;
  meanLog: number;
}

export type SpeakerFormantStats = Record<'f1' | 'f2' | 'f3', FormantStats>;
export type SpeakerStatsMap = Record<string, SpeakerFormantStats>;

// ── Pointwise transforms ───────────────────────────────────────────────────

export function toBark(f: number): number {
  return 26.81 / (1 + 1960 / f) - 0.53;
}

export function toERB(f: number): number {
  return 21.4 * Math.log10(1 + f / 228.8);
}

export function toMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}

// ── Speaker-dependent transforms ───────────────────────────────────────────

function toLobanov(f: number, stats: FormantStats): number {
  return stats.sd === 0 ? 0 : (f - stats.mean) / stats.sd;
}

function toNearey1(f: number, stats: FormantStats): number {
  return Math.log(f) - stats.meanLog;
}

// ── Unified dispatcher ─────────────────────────────────────────────────────

export function normalizeFormant(
  f: number,
  formant: 'f1' | 'f2' | 'f3',
  method: NormalizationMethod,
  speakerStats?: SpeakerFormantStats
): number {
  switch (method) {
    case 'hz': return f;
    case 'bark': return toBark(f);
    case 'erb': return toERB(f);
    case 'mel': return toMel(f);
    case 'lobanov': return speakerStats ? toLobanov(f, speakerStats[formant]) : f;
    case 'nearey1': return speakerStats ? toNearey1(f, speakerStats[formant]) : f;
    default: return f;
  }
}

// ── Axis labels ────────────────────────────────────────────────────────────

const UNIT_LABELS: Record<NormalizationMethod, string> = {
  hz: 'Hz', bark: 'Bark', erb: 'ERB', mel: 'Mel',
  lobanov: 'z-score', nearey1: 'log',
};

export function getAxisLabel(formant: string, method: NormalizationMethod): string {
  return `${formant} (${UNIT_LABELS[method]})`;
}

// ── Tick formatting ────────────────────────────────────────────────────────

export function getTickStep(method: NormalizationMethod, span: number): number {
  switch (method) {
    case 'lobanov': return span > 6 ? 2 : span > 3 ? 1 : 0.5;
    case 'nearey1': return span > 3 ? 1 : span > 1.5 ? 0.5 : 0.2;
    case 'bark': return span > 10 ? 2 : 1;
    case 'erb': return span > 20 ? 5 : 2;
    case 'mel': return span > 2000 ? 500 : span > 800 ? 250 : 100;
    case 'hz':
    default: return span > 2000 ? 500 : span > 800 ? 200 : 100;
  }
}

export function formatTick(val: number, method: NormalizationMethod): string {
  switch (method) {
    case 'hz': case 'mel': return `${Math.round(val)}`;
    case 'lobanov': return val.toFixed(1);
    case 'nearey1': return val.toFixed(2);
    case 'bark': case 'erb': return val.toFixed(1);
    default: return `${Math.round(val)}`;
  }
}

// ── Range input step for UI ────────────────────────────────────────────────

export function getRangeStep(method: NormalizationMethod): number {
  switch (method) {
    case 'lobanov': case 'nearey1': return 0.1;
    case 'bark': case 'erb': return 0.5;
    case 'mel': return 50;
    case 'hz':
    default: return 100;
  }
}

// ── Speaker stats computation ──────────────────────────────────────────────

export function computeSpeakerStats(data: SpeechToken[], useSmoothing: boolean): SpeakerStatsMap {
  const groups: Record<string, { f1: number[]; f2: number[]; f3: number[] }> = {};

  for (const token of data) {
    const spk = token.speaker || '__all__';
    if (!groups[spk]) groups[spk] = { f1: [], f2: [], f3: [] };
    const g = groups[spk];
    for (const pt of token.trajectory) {
      const f1 = useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
      const f2 = useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
      const f3 = useSmoothing ? (pt.f3_smooth ?? pt.f3) : pt.f3;
      if (!isNaN(f1) && f1 > 0) g.f1.push(f1);
      if (!isNaN(f2) && f2 > 0) g.f2.push(f2);
      if (!isNaN(f3) && f3 > 0) g.f3.push(f3);
    }
  }

  const result: SpeakerStatsMap = {};
  for (const [spk, vals] of Object.entries(groups)) {
    const stats = {} as SpeakerFormantStats;
    for (const formant of ['f1', 'f2', 'f3'] as const) {
      const arr = vals[formant];
      if (arr.length === 0) {
        stats[formant] = { mean: 0, sd: 1, meanLog: 0 };
        continue;
      }
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
      const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
      const sd = Math.sqrt(variance) || 1;
      const meanLog = arr.reduce((s, v) => s + Math.log(v), 0) / arr.length;
      stats[formant] = { mean, sd, meanLog };
    }
    result[spk] = stats;
  }

  return result;
}

// ── Auto-range computation ─────────────────────────────────────────────────

export function computeNormalizedRange(
  data: SpeechToken[],
  formant: 'f1' | 'f2' | 'f3',
  method: NormalizationMethod,
  statsMap: SpeakerStatsMap,
  useSmoothing: boolean,
  padding = 0.05
): [number, number] {
  const vals: number[] = [];
  const smoothKey = `${formant}_smooth` as keyof import('../types').TrajectoryPoint;

  for (const token of data) {
    const stats = statsMap[token.speaker || '__all__'];
    for (const pt of token.trajectory) {
      const raw = useSmoothing ? ((pt[smoothKey] as number) ?? (pt[formant] as number)) : (pt[formant] as number);
      if (isNaN(raw) || raw <= 0) continue;
      const val = normalizeFormant(raw, formant, method, stats);
      if (isFinite(val)) vals.push(val);
    }
  }

  if (vals.length === 0) {
    if (method === 'lobanov') return [-3, 3];
    if (method === 'nearey1') return [-1, 1];
    return [0, 1000];
  }

  // Use 1st–99th percentile so outliers don't compress the bulk of data
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.01)];
  const hi = vals[Math.ceil(vals.length * 0.99) - 1];
  const span = hi - lo;
  return [
    Math.floor((lo - span * padding) * 100) / 100,
    Math.ceil((hi + span * padding) * 100) / 100,
  ];
}
