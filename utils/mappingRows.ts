import { ColumnMapping, ColumnRole } from '../types';
import { TRAJECTORY_MIN_POINTS } from '../services/csvParser';
import {
  isSpectralRole, parseSpectralColumn, parseSpectralTimePointSuffix,
  spectralColumnRegion, SpectralKind,
} from './spectralMoments';

/**
 * The rows the Data Mapping table shows, and the order it shows them in.
 *
 * A wide export has hundreds of columns, most of them one formant or one measure
 * sampled over and over, so families of related columns collapse into a single row you
 * can expand. What survives that is the file itself: **rows stay in CSV column order,
 * always**. Ordering by role instead moves a row the moment you reclassify it — out
 * from under the cursor, away from the neighbours you were comparing it against — and
 * puts the same column in a different place depending on which view you reached it
 * from. A collapsed family sits at the position of its earliest column, so the table
 * reads top to bottom like the header does.
 */

/** One column's mapping, and where it sits in the mapping array. */
export interface MappingEntry {
  m: ColumnMapping;
  idx: number;
}

/** A collapsed family of related columns — one formant's trajectory, one measure's track. */
export interface GroupRow {
  kind: 'group';
  groupKey: string;
  label: string;
  badge: string;
  isSpectral: boolean;
  members: MappingEntry[];
}

/** A column shown on its own. */
export interface SingleRow extends MappingEntry {
  kind: 'single';
}

export type DisplayRow = GroupRow | SingleRow;

// Speaker ID & File ID are assigned via the quick-assign dropdowns at the top of the
// dialog, so they are NOT listed here — the per-row dropdown only shows these roles.
export const ROLE_OPTIONS: { value: ColumnRole, label: string }[] = [
  { value: 'formant', label: 'Formant Value' },
  { value: 'duration', label: 'Duration Value' },
  { value: 'pitch', label: 'Pitch Value' },
  { value: 'spectral_cog', label: 'Spectral COG' },
  { value: 'spectral_sd', label: 'Spectral Diffusion (SD)' },
  { value: 'spectral_skew', label: 'Spectral Skew' },
  { value: 'spectral_kurt', label: 'Spectral Kurtosis' },
  { value: 'spectral_bandratio', label: 'Spectral Band Energy Ratio' },
  { value: 'token_id', label: 'Token ID (groups rows)' },
  { value: 'timepoint', label: 'Timepoint' },
  { value: 'field', label: 'Custom Field' },
  { value: 'ignore', label: 'Ignore' },
];

export const roleLabel = (role: ColumnRole): string =>
  ROLE_OPTIONS.find(o => o.value === role)?.label ?? role;

/** Noun naming each spectral family in the mapping table's group header. */
const SPECTRAL_GROUP_NOUN: Record<SpectralKind, string> = {
  point: 'at timepoints',
  track: 'track',
  coeff: 'coefficients',
};

/**
 * Whether a spectral column carries a recognised suffix, and so belongs to a family.
 * A bare `COG` is a lone measurement and stays a standalone row.
 */
export const hasSpectralSuffix = (header: string): boolean =>
  parseSpectralTimePointSuffix(header) !== null || /_[tk]\d+$/i.test(header);

/**
 * Group the mappings into display rows and put them in CSV column order.
 * `headers` is the file's header row — the order everything is measured against.
 */
export const buildMappingRows = (mappings: ColumnMapping[], headers: string[]): DisplayRow[] => {
  const byFormant = new Map<string, MappingEntry[]>();
  // Spectral families: same role + same base name + same column kind. Point, track and
  // coefficient families group separately — they are different kinds of measurement,
  // not interchangeable positions.
  const bySpectral = new Map<string, MappingEntry[]>();
  const singles: MappingEntry[] = [];
  mappings.forEach((m, idx) => {
    if (m.role === 'formant' && !m.formantTarget && m.formant && m.timePoint !== undefined) {
      if (!byFormant.has(m.formant)) byFormant.set(m.formant, []);
      byFormant.get(m.formant)!.push({ m, idx });
    } else if (isSpectralRole(m.role) && hasSpectralSuffix(m.csvHeader)) {
      const ref = parseSpectralColumn(m.csvHeader);
      const key = `${m.role}:${ref.kind}:${ref.base.toLowerCase()}`;
      if (!bySpectral.has(key)) bySpectral.set(key, []);
      bySpectral.get(key)!.push({ m, idx });
    } else {
      singles.push({ m, idx });
    }
  });

  const groups: GroupRow[] = [];
  for (const [formant, members] of byFormant) {
    if (members.length >= TRAJECTORY_MIN_POINTS) {
      groups.push({
        kind: 'group', groupKey: formant, label: `${formant.toUpperCase()} trajectory`,
        badge: 'Formant · Data', isSpectral: false, members,
      });
    } else {
      members.forEach(mem => singles.push(mem));
    }
  }
  // Spectral families are short (often just 20/50/80%), so any repeated base name with
  // ≥2 members rolls up — unlike formant trajectories (TRAJECTORY_MIN_POINTS).
  for (const [key, members] of bySpectral) {
    if (members.length >= 2) {
      const first = members[0].m;
      const kind = parseSpectralColumn(first.csvHeader).kind;
      const region = first.spectralRegion ?? spectralColumnRegion(first.csvHeader);
      groups.push({
        kind: 'group', groupKey: key,
        label: `${roleLabel(first.role)} ${SPECTRAL_GROUP_NOUN[kind]}${region ? ` · ${region}` : ''}`,
        badge: 'Spectral · Data', isSpectral: true, members,
      });
    } else {
      members.forEach(mem => singles.push(mem));
    }
  }

  // Position of a row in the file: its own column, or a group's earliest column. The
  // mapping index breaks ties, so the two mappings one column can carry — speaker and
  // file ID on the same header — keep a stable order.
  const columnOrder = new Map(headers.map((h, i) => [h, i]));
  const at = ({ m, idx }: MappingEntry): [number, number] =>
    [columnOrder.get(m.csvHeader) ?? headers.length, idx];
  const earlier = (a: [number, number], b: [number, number]) => (a[0] - b[0] || a[1] - b[1]) <= 0 ? a : b;
  const positioned: { row: DisplayRow, at: [number, number] }[] = [
    ...singles.map(s => ({ row: { kind: 'single', ...s } as DisplayRow, at: at(s) })),
    ...groups.map(g => ({ row: g as DisplayRow, at: g.members.map(at).reduce(earlier) })),
  ];
  positioned.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  return positioned.map(p => p.row);
};
