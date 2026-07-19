
import React, { useState, useMemo } from 'react';
import { ColumnMapping, ColumnRole, TrajectoryFormat, TrajectoryUnit, TrajectorySpacing } from '../types';
import {
  HeaderDetectionResult,
  TrajectoryFormatOverride,
  collectWideFormatTimepoints,
  detectTrajectoryFormat,
  detectUnitHintFromMappings,
  TRAJECTORY_MIN_POINTS,
} from '../services/csvParser';
import { X, Upload, FileText, RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  isSpectralRole,
  parseSpectralTimePointSuffix,
  spectralColumnBaseName,
  spectralRoleTimePoint,
} from '../utils/spectralMoments';

interface DataMappingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mappings: ColumnMapping[], trajectoryOverride?: TrajectoryFormatOverride) => void;
  headers: string[];
  sampleData: string[][];
  /** Full CSV text — needed for accurate trajectory detection in long format (beyond the 5 sample rows). */
  rawText?: string;
  detectedMappings: ColumnMapping[];
  fileName: string;
  isEditMode?: boolean;
  firstRowIsHeader: boolean;
  headerDetection: HeaderDetectionResult;
  onToggleFirstRowIsHeader: (isHeader: boolean) => void;
}

/** Format a spacing description for the confirmation panel. */
const describeSpacing = (spacing: TrajectorySpacing, format: TrajectoryFormat, unit?: TrajectoryUnit): string => {
  const unitLabel = format === 'time-slice' ? (unit === 'sec' ? ' sec' : unit === 'ms' ? ' ms' : '') : '%';
  if (spacing.kind === 'uniform' && spacing.medianInterval !== undefined) {
    const v = spacing.medianInterval;
    const rounded = Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : Number(v.toFixed(2));
    return `Samples ~every ${rounded}${unitLabel}`;
  }
  if (spacing.kind === 'listed' && spacing.values) {
    return `Samples at ${spacing.values.map(v => `${v}${unitLabel}`).join(', ')}`;
  }
  return 'Sampled at irregular intervals';
};

// Speaker ID & File ID are assigned via the quick-assign dropdowns at the top,
// so they are NOT listed here — the per-row dropdown only shows these roles.
const ROLE_OPTIONS: { value: ColumnRole, label: string }[] = [
  { value: 'formant', label: 'Formant Value' },
  { value: 'duration', label: 'Duration Value' },
  { value: 'pitch', label: 'Pitch Value' },
  { value: 'spectral_cog', label: 'Spectral COG' },
  { value: 'spectral_sd', label: 'Spectral Diffusion (SD)' },
  { value: 'spectral_skew', label: 'Spectral Skew' },
  { value: 'spectral_kurt', label: 'Spectral Kurtosis' },
  { value: 'token_id', label: 'Token ID (groups rows)' },
  { value: 'timepoint', label: 'Timepoint' },
  { value: 'field', label: 'Custom Field' },
  { value: 'ignore', label: 'Ignore' },
];

// These names have hardcoded property accessors in filtering (App.tsx) and
// sidebar display (Sidebar.tsx). A custom field using one of these names will
// collide and produce blank plots / broken filters.
const RESERVED_FIELD_NAMES = new Set(['duration', 'speaker', 'file_id']);

const DataMappingDialog: React.FC<DataMappingDialogProps> = ({
  isOpen, onClose, onConfirm, headers, sampleData, rawText, detectedMappings, fileName, isEditMode,
  firstRowIsHeader, headerDetection, onToggleFirstRowIsHeader
}) => {
  const [mappings, setMappings] = useState<ColumnMapping[]>(detectedMappings);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sidebarHelpRect, setSidebarHelpRect] = useState<DOMRect | null>(null);
  const [speakerHelpRect, setSpeakerHelpRect] = useState<DOMRect | null>(null);
  const [fileIdHelpRect, setFileIdHelpRect] = useState<DOMRect | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  // User-confirmed trajectory format/unit (null = use auto-detected)
  const [formatOverride, setFormatOverride] = useState<TrajectoryFormat | null>(null);
  const [unitOverride, setUnitOverride] = useState<TrajectoryUnit | null>(null);
  // Expanded trajectory-group keys (e.g. "f1", "f2") — collapsed by default
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Reset mappings when dialog opens with new data
  React.useEffect(() => {
    setMappings(detectedMappings);
    setValidationError(null);
    setFormatOverride(null);
    setUnitOverride(null);
    setExpandedGroups(new Set());
  }, [detectedMappings]);

  // Live auto-detection from current mappings (wide format) or full rawText (long format)
  const trajectoryDetection = useMemo(() => {
    const tpMapping = mappings.find(m => m.role === 'timepoint');
    const tokenMapping = mappings.find(m => m.role === 'token_id');
    if (tpMapping) {
      const tpColIdx = headers.indexOf(tpMapping.csvHeader);
      const tidColIdx = tokenMapping ? headers.indexOf(tokenMapping.csvHeader) : -1;
      if (tpColIdx >= 0) {
        // Gather per-token timepoint sequences from the full rawText. Intervals are then
        // computed WITHIN each token — not across the union — because in long format
        // absolute times differ per token, which would pollute the interval distribution.
        const tokenSequences = new Map<string, number[]>();
        let maxTP = -Infinity;
        if (rawText) {
          const firstComma = rawText.indexOf(',');
          const firstTab = rawText.indexOf('\t');
          const delim = firstTab !== -1 && (firstComma === -1 || firstTab < firstComma) ? '\t' : ',';
          const lines = rawText.split(/\r?\n/);
          const start = firstRowIsHeader ? 1 : 0;
          for (let i = start; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const cols = line.split(delim);
            const tp = parseFloat(cols[tpColIdx]);
            if (isNaN(tp)) continue;
            if (tp > maxTP) maxTP = tp;
            const tid = tidColIdx >= 0 ? (cols[tidColIdx] || '').trim() : '__all__';
            if (!tokenSequences.has(tid)) tokenSequences.set(tid, []);
            tokenSequences.get(tid)!.push(tp);
          }
        } else {
          for (const row of sampleData) {
            const tp = parseFloat(row[tpColIdx]);
            if (isNaN(tp)) continue;
            if (tp > maxTP) maxTP = tp;
            const tid = tidColIdx >= 0 ? (row[tidColIdx] || '').trim() : '__all__';
            if (!tokenSequences.has(tid)) tokenSequences.set(tid, []);
            tokenSequences.get(tid)!.push(tp);
          }
        }
        // Determine format and unit up front (needed for rounding precision)
        const format: 'percentage' | 'time-slice' | 'single-point' = maxTP > 100
          ? 'time-slice'
          : 'percentage';
        const unit: 'ms' | 'sec' | undefined = format === 'time-slice'
          ? (maxTP > 10 ? 'ms' : 'sec')
          : undefined;
        // Compute raw intervals, then round the interval itself to the nearest
        // meaningful tick. This avoids rounding-boundary artefacts where two
        // values near .5 round in opposite directions and report a false 4 or 6
        // for what is really a clean 5 ms interval.
        //   - ms data   → round interval to nearest ms
        //   - seconds   → round interval to nearest 0.001 s (= 1 ms)
        //   - percent   → round interval to nearest 1%
        const roundInterval = (d: number): number => {
          if (unit === 'sec') return Math.round(d * 1000) / 1000;
          return Math.round(d);
        };
        const allIntervals: number[] = [];
        let maxPerToken = 0;
        for (const seq of tokenSequences.values()) {
          seq.sort((a, b) => a - b);
          if (seq.length > maxPerToken) maxPerToken = seq.length;
          for (let i = 1; i < seq.length; i++) {
            const d = roundInterval(seq[i] - seq[i - 1]);
            if (d > 0) allIntervals.push(d);
          }
        }
        // Downgrade to single-point if below threshold AND not time-slice
        const finalFormat = format === 'percentage' && maxPerToken < TRAJECTORY_MIN_POINTS
          ? 'single-point'
          : format;
        // Spacing: after rounding, uniform = all intervals identical
        const uniqueTPs = Array.from(new Set(Array.from(tokenSequences.values()).flat())).sort((a, b) => a - b);
        let spacing: { kind: 'uniform' | 'listed' | 'irregular'; medianInterval?: number; values?: number[] };
        if (allIntervals.length === 0) {
          spacing = { kind: 'listed', values: uniqueTPs };
        } else {
          const sorted = [...allIntervals].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
          const uniform = allIntervals.every(d => d === med);
          spacing = uniform ? { kind: 'uniform', medianInterval: med } : { kind: 'irregular' };
        }
        return { format: finalFormat, unit, spacing, pointsPerFormant: maxPerToken, uniqueTimepoints: uniqueTPs };
      }
    }
    // Wide format: derive from column headers / mappings
    const byFormant = collectWideFormatTimepoints(mappings);
    const unitHint = detectUnitHintFromMappings(mappings);
    return detectTrajectoryFormat(byFormant, unitHint);
  }, [mappings, sampleData, headers, rawText, firstRowIsHeader]);

  const effectiveFormat: TrajectoryFormat = formatOverride ?? trajectoryDetection.format;
  const effectiveUnit: TrajectoryUnit | undefined = unitOverride ?? trajectoryDetection.unit;
  const showTrajectoryPanel = trajectoryDetection.pointsPerFormant >= TRAJECTORY_MIN_POINTS
    || effectiveFormat === 'time-slice';

  const updateMapping = (idx: number, updates: Partial<ColumnMapping>) => {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, ...updates } : m));
    setValidationError(null);
  };

  // Quick-assign helper for Speaker/File ID dropdowns
  // Allows the same column to be assigned to both roles (separate mappings)
  const assignSpecialRole = (role: 'speaker' | 'file_id', csvHeader: string) => {
    const otherRole = role === 'speaker' ? 'file_id' : 'speaker';
    setMappings(prev => {
      // Remove previous mapping for this role
      let next = prev.filter(m => m.role !== role);
      // If the chosen column already exists as a non-special mapping, keep it but
      // also insert a new mapping for the special role pointing to the same column
      const existing = next.find(m => m.csvHeader === csvHeader && m.role !== otherRole);
      if (existing) {
        // Repurpose it to this role
        next = next.map(m => {
          if (m === existing) return { ...m, role, showInSidebar: true, isDataField: false, fieldName: undefined };
          return m;
        });
      } else if (!next.find(m => m.csvHeader === csvHeader && m.role === otherRole)) {
        // Column not in mappings at all (shouldn't happen), add it
        next.push({ csvHeader, role, showInSidebar: true, isDataField: false });
      } else {
        // Column is already used by the other special role — insert a duplicate mapping
        const otherIdx = next.findIndex(m => m.csvHeader === csvHeader && m.role === otherRole);
        next.splice(otherIdx + 1, 0, { csvHeader, role, showInSidebar: true, isDataField: false });
      }
      return next;
    });
    setValidationError(null);
  };

  // Currently assigned speaker/file_id columns
  const speakerCol = mappings.find(m => m.role === 'speaker')?.csvHeader || '';
  const fileIdCol = mappings.find(m => m.role === 'file_id')?.csvHeader || '';

  // Available columns for speaker/file_id selection (non-formant, non-ignore)
  const availableForSpecial = useMemo(() =>
    headers.filter(h => {
      const m = mappings.find(mm => mm.csvHeader === h);
      return m && m.role !== 'formant';
    }), [headers, mappings]);

  // Detect custom fields whose names clash with built-in reserved properties.
  // A clash only matters when the reserved role is NOT already assigned — e.g. a
  // custom field named "duration" only clashes if there's no "Duration Value" role.
  const reservedClashes = useMemo(() => {
    const clashes = new Set<number>(); // indices of offending mappings
    const assignedRoles = new Set(mappings.map(m => m.role));
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if ((m.role === 'field' || m.role === 'pitch') && m.fieldName) {
        const lower = m.fieldName.toLowerCase().trim();
        if (RESERVED_FIELD_NAMES.has(lower)) {
          // "duration" only clashes if there's also a duration-role mapping (or none — the property still defaults to 0)
          // Actually, it ALWAYS clashes because the hardcoded accessors read the property, not fields[]
          clashes.add(i);
        }
      }
    }
    return clashes;
  }, [mappings]);

  const summary = useMemo(() => {
    const formantMappings = mappings.filter(m => m.role === 'formant');
    const timePoints = new Set(formantMappings.map(m => m.timePoint).filter(t => t !== undefined));
    const fieldCount = mappings.filter(m => m.role === 'field').length;
    const assignedCount = mappings.filter(m => m.role !== 'ignore').length;
    return {
      totalCols: headers.length,
      assignedCount,
      timePointCount: timePoints.size,
      fieldCount,
      rows: sampleData.length
    };
  }, [mappings, headers]);

  /**
   * Build display rows for the mapping table. Collapses numeric-trajectory formant
   * columns (F1_0, F1_10, …, F1_100) into one summary row per formant. Named targets
   * and other columns render as individual rows.
   * Order: speaker/file_id/token_id/timepoint → filter fields → trajectory groups
   *        → named-target formants → data fields → ignored.
   */
  type GroupRow = {
    kind: 'group'; groupKey: string; label: string; badge: string;
    isSpectral: boolean; members: { m: ColumnMapping; idx: number }[];
  };
  type SingleRow = { kind: 'single'; m: ColumnMapping; idx: number };
  type DisplayRow = GroupRow | SingleRow;
  const displayRows: DisplayRow[] = useMemo(() => {
    const byFormant = new Map<string, { m: ColumnMapping; idx: number }[]>();
    // Spectral trajectory families: same role + same base name, numeric timepoint
    // suffixes (COG_20%, COG_50%, COG_80% → one "Spectral COG trajectory" group).
    const bySpectral = new Map<string, { m: ColumnMapping; idx: number }[]>();
    const singles: { m: ColumnMapping; idx: number }[] = [];
    mappings.forEach((m, idx) => {
      if (m.role === 'formant' && !m.formantTarget && m.formant && m.timePoint !== undefined) {
        if (!byFormant.has(m.formant)) byFormant.set(m.formant, []);
        byFormant.get(m.formant)!.push({ m, idx });
      } else if (isSpectralRole(m.role) && parseSpectralTimePointSuffix(m.csvHeader) !== null) {
        const key = `${m.role}:${spectralColumnBaseName(m.csvHeader).toLowerCase()}`;
        if (!bySpectral.has(key)) bySpectral.set(key, []);
        bySpectral.get(key)!.push({ m, idx });
      } else {
        singles.push({ m, idx });
      }
    });
    const roleLabel = (role: ColumnRole): string =>
      ROLE_OPTIONS.find(o => o.value === role)?.label ?? role;
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
    // Spectral families are short (typically 20/50/80%), so any repeated base name
    // with ≥2 timepoints rolls up — unlike formant trajectories (TRAJECTORY_MIN_POINTS).
    for (const [key, members] of bySpectral) {
      if (members.length >= 2) {
        groups.push({
          kind: 'group', groupKey: key, label: `${roleLabel(members[0].m.role)} trajectory`,
          badge: 'Spectral · Data', isSpectral: true, members,
        });
      } else {
        members.forEach(mem => singles.push(mem));
      }
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));

    const priority = (m: ColumnMapping): number => {
      if (m.role === 'speaker') return 0;
      if (m.role === 'file_id') return 1;
      if (m.role === 'token_id') return 2;
      if (m.role === 'timepoint') return 3;
      if (m.role === 'field' && m.isDataField === false) return 4;
      if (m.role === 'formant' && m.formantTarget) return 6;
      if (m.role === 'duration') return 7;
      if (m.role === 'pitch') return 8;
      if (isSpectralRole(m.role)) return 9;
      if (m.role === 'field' && m.isDataField === true) return 9;
      if (m.role === 'ignore') return 10;
      return 11;
    };
    singles.sort((a, b) => priority(a.m) - priority(b.m) || a.idx - b.idx);

    const result: DisplayRow[] = [];
    let groupsInserted = false;
    for (const s of singles) {
      if (!groupsInserted && priority(s.m) >= 5) {
        groups.forEach(g => result.push(g));
        groupsInserted = true;
      }
      result.push({ kind: 'single', ...s });
    }
    if (!groupsInserted) groups.forEach(g => result.push(g));
    return result;
  }, [mappings]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const describeGroup = (members: { m: ColumnMapping; idx: number }[], isSpectral: boolean): string => {
    const tps = members
      .map(mem => isSpectral ? spectralRoleTimePoint(mem.m.csvHeader) : mem.m.timePoint as number)
      .sort((a, b) => a - b);
    const min = tps[0], max = tps[tps.length - 1];
    const unitLabel = !isSpectral && effectiveFormat === 'time-slice' ? (effectiveUnit ?? '') : '%';
    return `${members.length} columns · ${min}${unitLabel} to ${max}${unitLabel}`;
  };

  /** Render a single mapping row — reused for standalone rows and expanded group members. */
  const renderMappingRow = (m: ColumnMapping, idx: number, indent: boolean) => {
    const colIdx = headers.indexOf(m.csvHeader);
    const samples = sampleData.map(row => row[colIdx] || '').filter(v => v !== '').slice(0, 4);
    const isIgnored = m.role === 'ignore';
    const isData = m.isDataField === true;

    return (
      <tr key={`${m.csvHeader}_${idx}`} className={`border-b border-slate-100 ${isIgnored ? 'opacity-50' : ''}`}>
        <td className={`py-2 pr-2 ${indent ? 'pl-6' : ''}`}>
          <span className="font-mono text-xs font-bold text-slate-700">{m.csvHeader}</span>
        </td>
        <td className="py-2 pr-2">
          <div className="flex flex-wrap gap-1">
            {samples.map((s, i) => (
              <span key={i} className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 truncate max-w-[70px]">{s}</span>
            ))}
          </div>
        </td>
        <td className="py-2 pr-2">
          {(m.role === 'speaker' || m.role === 'file_id') ? (
            <span className="text-xs text-slate-500 italic">
              {m.role === 'speaker' ? 'Speaker ID' : 'File ID'}
              <span className="text-[10px] text-slate-400 ml-1">↑ set above</span>
            </span>
          ) : (
            <select
              className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white"
              value={m.role}
              onChange={e => {
                const role = e.target.value as ColumnRole;
                const updates: Partial<ColumnMapping> = { role };
                if (role === 'formant' || role === 'duration' || role === 'pitch' || isSpectralRole(role)) {
                  updates.isDataField = true;
                  updates.showInSidebar = false;
                } else if (role === 'ignore' || role === 'token_id' || role === 'timepoint') {
                  updates.isDataField = false;
                  updates.showInSidebar = false;
                } else {
                  updates.isDataField = false;
                  updates.showInSidebar = true;
                }
                if (role === 'field' || role === 'pitch' || isSpectralRole(role)) {
                  updates.fieldName = m.fieldName || m.csvHeader;
                }
                if (role === 'formant') {
                  updates.formant = m.formant || 'f1';
                  updates.timePoint = m.timePoint ?? 50;
                  updates.isSmooth = m.isSmooth || false;
                }
                updateMapping(idx, updates);
              }}
            >
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </td>
        <td className="py-2 pr-2">
          {m.role === 'formant' && (
            <div className="flex items-center gap-2">
              <select
                className="text-xs p-1 border border-slate-200 rounded w-14"
                value={m.formant || 'f1'}
                onChange={e => updateMapping(idx, { formant: e.target.value as 'f1' | 'f2' | 'f3' | 'f4' | 'f5' })}
              >
                <option value="f1">F1</option>
                <option value="f2">F2</option>
                <option value="f3">F3</option>
                <option value="f4">F4</option>
                <option value="f5">F5</option>
              </select>
              {m.formantTarget ? (
                <>
                  <span className="text-[11px] text-slate-400">@</span>
                  <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">{m.formantTarget}</span>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-slate-400">@</span>
                  <input
                    type="number"
                    className="text-xs p-1 border border-slate-200 rounded w-14"
                    value={m.timePoint ?? 50}
                    onChange={e => updateMapping(idx, { timePoint: parseInt(e.target.value) || 0 })}
                    min={0}
                    max={100}
                  />
                  <span className="text-[11px] text-slate-400">%</span>
                </>
              )}
              {m.formantLabel && (
                <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">{m.formantLabel}</span>
              )}
            </div>
          )}
          {(m.role === 'field' || m.role === 'pitch') && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className={`text-xs p-1 border rounded w-36 ${reservedClashes.has(idx) ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200'}`}
                value={m.fieldName ?? m.csvHeader}
                onChange={e => updateMapping(idx, { fieldName: e.target.value })}
                placeholder="Display name"
              />
              {reservedClashes.has(idx) && (
                <span className="text-[10px] text-red-600 font-bold whitespace-nowrap">Reserved name — please rename</span>
              )}
            </div>
          )}
          {isSpectralRole(m.role) && (
            <div className="flex items-center gap-1" title="Timepoint parsed from the column name; bare names default to the 50% midpoint">
              <span className="text-[11px] text-slate-400">@</span>
              <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">{spectralRoleTimePoint(m.csvHeader)}%</span>
            </div>
          )}
          {(m.role === 'speaker' || m.role === 'file_id' || m.role === 'duration' || m.role === 'token_id' || m.role === 'timepoint') && (
            <span className="text-[11px] text-slate-400 italic">auto-detected</span>
          )}
        </td>
        <td className="py-2 text-center">
          {!isIgnored && m.role !== 'token_id' && m.role !== 'timepoint' && (
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={() => updateMapping(idx, { isDataField: false, showInSidebar: true })}
                className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${!isData ? 'bg-sky-100 border-sky-300 text-sky-700 font-bold' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                title="Filter field: categorical labels for filtering data"
              >
                Filter
              </button>
              <button
                onClick={() => updateMapping(idx, { isDataField: true, showInSidebar: false })}
                className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${isData ? 'bg-amber-100 border-amber-300 text-amber-700 font-bold' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                title="Data field: numeric values to be plotted"
              >
                Data
              </button>
            </div>
          )}
        </td>
        <td className="py-2 text-center">
          {!isIgnored && !isData && (
            <input
              type="checkbox"
              checked={m.showInSidebar === true}
              onChange={e => updateMapping(idx, { showInSidebar: e.target.checked })}
              className="rounded text-sky-700"
              title="Show as filter in sidebar"
            />
          )}
        </td>
      </tr>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[940px] max-h-[85vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText size={20} className="text-sky-700" />
              Data Mapping
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isEditMode
                ? `Reviewing column mappings for ${fileName}`
                : `${fileName} — ${summary.totalCols} columns, ${summary.rows} sample rows — ${summary.assignedCount} mapped, ${summary.timePointCount} time points, ${summary.fieldCount} fields`
              }
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Header detection banner */}
        {!isEditMode && (
          <div className={`px-5 py-2 border-b shrink-0 flex items-center gap-3 text-xs ${headerDetection.confidence < 0.7 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
            {headerDetection.confidence < 0.7 && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
            <span className={`font-semibold ${headerDetection.confidence < 0.7 ? 'text-amber-800' : 'text-slate-600'}`}>
              {headerDetection.confidence < 0.7 ? 'Does your first row contain column headers?' : 'First row:'}
            </span>
            <div className="flex rounded overflow-hidden border border-slate-300">
              <button
                onClick={() => onToggleFirstRowIsHeader(true)}
                className={`px-3 py-1 text-[11px] font-bold transition-colors ${firstRowIsHeader ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >Headers</button>
              <button
                onClick={() => onToggleFirstRowIsHeader(false)}
                className={`px-3 py-1 text-[11px] font-bold transition-colors border-l border-slate-300 ${!firstRowIsHeader ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >Data</button>
            </div>
            {!firstRowIsHeader && <span className="text-slate-500 italic">Column names auto-generated (Col_1, Col_2, ...)</span>}
          </div>
        )}

        {/* Quick-assign: Speaker & File ID */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600 whitespace-nowrap cursor-help border-b border-dashed border-slate-300"
                onMouseEnter={e => setSpeakerHelpRect(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setSpeakerHelpRect(null)}
              >Speaker ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={speakerCol}
                onChange={e => {
                  if (e.target.value === '') {
                    setMappings(prev => {
                      const speakerMapping = prev.find(m => m.role === 'speaker');
                      if (!speakerMapping) return prev;
                      const hasDuplicate = prev.some(m => m.csvHeader === speakerMapping.csvHeader && m.role !== 'speaker');
                      if (hasDuplicate) return prev.filter(m => m.role !== 'speaker');
                      // Avoid reserved name clash when converting to a regular field
                      const safeName = RESERVED_FIELD_NAMES.has(speakerMapping.csvHeader.toLowerCase().trim())
                        ? speakerMapping.csvHeader + '_col'
                        : speakerMapping.csvHeader;
                      return prev.map(m => m.role === 'speaker' ? { ...m, role: 'field' as ColumnRole, fieldName: safeName, showInSidebar: true, isDataField: false } : m);
                    });
                  } else {
                    assignSpecialRole('speaker', e.target.value);
                  }
                }}
              >
                <option value="">None</option>
                {availableForSpecial.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600 whitespace-nowrap cursor-help border-b border-dashed border-slate-300"
                onMouseEnter={e => setFileIdHelpRect(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setFileIdHelpRect(null)}
              >File ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={fileIdCol}
                onChange={e => {
                  if (e.target.value === '') {
                    setMappings(prev => {
                      const fileIdMapping = prev.find(m => m.role === 'file_id');
                      if (!fileIdMapping) return prev;
                      const hasDuplicate = prev.some(m => m.csvHeader === fileIdMapping.csvHeader && m.role !== 'file_id');
                      if (hasDuplicate) return prev.filter(m => m.role !== 'file_id');
                      // Avoid reserved name clash when converting to a regular field
                      const safeName = RESERVED_FIELD_NAMES.has(fileIdMapping.csvHeader.toLowerCase().trim())
                        ? fileIdMapping.csvHeader + '_col'
                        : fileIdMapping.csvHeader;
                      return prev.map(m => m.role === 'file_id' ? { ...m, role: 'field' as ColumnRole, fieldName: safeName, showInSidebar: true, isDataField: false } : m);
                    });
                  } else {
                    assignSpecialRole('file_id', e.target.value);
                  }
                }}
              >
                <option value="">None</option>
                {availableForSpecial.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Both can be None, or point at the same CSV column. Hover over the labels above for more info.
          </p>
        </div>

        {/* Long-format detection banner */}
        {mappings.some(m => m.role === 'token_id') && (
          <div className="mx-5 mt-3 mb-1 p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg shrink-0">
            <p className="text-xs text-indigo-900 leading-relaxed">
              <span className="font-bold">Long format detected:</span> Multiple rows per token.
              Rows will be grouped by{' '}
              <code className="font-mono bg-indigo-100 px-1 rounded text-[11px] font-bold">
                {mappings.find(m => m.role === 'token_id')?.csvHeader}
              </code>{' '}
              into individual tokens.
              {mappings.some(m => m.role === 'timepoint') && (
                <> Timepoint from{' '}
                  <code className="font-mono bg-indigo-100 px-1 rounded text-[11px] font-bold">
                    {mappings.find(m => m.role === 'timepoint')?.csvHeader}
                  </code>, normalized to 0–100%.
                </>
              )}
            </p>
          </div>
        )}

        {/* Trajectory Confirmation panel */}
        {showTrajectoryPanel && (
          <div className="mx-5 mt-3 mb-1 p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg shrink-0">
            <div className="text-xs text-emerald-900 leading-relaxed space-y-2">
              <div className="font-bold">Trajectory data detected</div>

              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold">These samples are separated by:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="trajFormat"
                    checked={effectiveFormat === 'percentage'}
                    onChange={() => { setFormatOverride('percentage'); setUnitOverride(null); }}
                  />
                  <span>Percentages of vowel duration</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="trajFormat"
                    checked={effectiveFormat === 'time-slice'}
                    onChange={() => setFormatOverride('time-slice')}
                  />
                  <span>Time values</span>
                </label>
              </div>

              {effectiveFormat === 'time-slice' && (
                <div className="flex items-center gap-3 flex-wrap pl-4 border-l-2 border-emerald-200">
                  <span className="font-semibold">Unit:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="trajUnit"
                      checked={effectiveUnit === 'ms'}
                      onChange={() => setUnitOverride('ms')}
                    />
                    <span>milliseconds (ms)</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="trajUnit"
                      checked={effectiveUnit === 'sec'}
                      onChange={() => setUnitOverride('sec')}
                    />
                    <span>seconds</span>
                  </label>
                  {effectiveUnit === undefined && (
                    <span className="text-amber-700 font-semibold flex items-center gap-1">
                      <AlertTriangle size={11} /> Please choose a unit
                    </span>
                  )}
                </div>
              )}

              <div className="text-emerald-800/80 italic pl-1">
                {describeSpacing(trajectoryDetection.spacing, effectiveFormat, effectiveUnit)}
              </div>
            </div>
          </div>
        )}

        {/* Filter vs Data explanation */}
        <div className="mx-5 mt-3 mb-1 p-3 bg-amber-50/60 border border-amber-100 rounded-lg shrink-0">
          <p className="text-xs text-amber-900 leading-relaxed">
            <span className="font-bold">Filter fields</span> contain categorical labels for filtering your data (e.g. phoneme, stress, gender, speaker). They can appear in the sidebar for interactive filtering.
            <br />
            <span className="font-bold">Data fields</span> contain values to be plotted (e.g. formant measurements, duration). Data fields are not available as sidebar filters.
          </p>
          <p className="text-xs text-amber-800/70 mt-1 italic">
            Toggle any field between filter and data below. Sidebar visibility can also be changed after import.
          </p>
        </div>

        {/* Collapsible CSV Format Guide */}
        <div className="mx-5 mt-1 mb-1 shrink-0">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="text-xs text-sky-700 font-bold hover:text-sky-800 flex items-center gap-1"
          >
            {showGuide ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            CSV Format Guide
          </button>
          {showGuide && (
            <div className="mt-2 p-3 bg-sky-50/60 border border-sky-100 rounded-lg text-xs text-slate-700 leading-relaxed space-y-1.5">
              <p>
                <span className="font-bold text-slate-800">Formants:</span>{' '}
                Use <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F2</code> ...{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F5</code> for single measurements.
                For time-points: <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_50</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_50%</code>, or{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_50ms</code>.
                Named targets: <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_onset</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_midpoint</code>.
                You can tag different versions with{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">_tag</code>, e.g.{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1_target</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F2_50_smoothed</code>.
              </p>
              <p>
                <span className="font-bold text-slate-800">Duration:</span>{' '}
                Auto-detected from column names containing{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">duration</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">dur</code>, or compounds like{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">vowel_dur</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">dur_phonemic</code>.
                Multiple duration columns are supported — each appears as a separate plottable variable.
              </p>
              <p>
                <span className="font-bold text-slate-800">Pitch:</span>{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">pitch</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">f0</code>, or time-point variants like{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">f0_50</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">f0_80%</code>.
              </p>
              <p>
                <span className="font-bold text-slate-800">Speaker / File ID:</span>{' '}
                Auto-detected from{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">speaker</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">participant</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">subject</code> /{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">file_id</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">filename</code>.
                Also assignable via the dropdowns above.
              </p>
              <p>
                <span className="font-bold text-slate-800">Long format (multiple rows per token):</span>{' '}
                If your data has one row per formant measurement (e.g. from R/emuR), assign a{' '}
                <span className="font-semibold">Token ID</span> column (groups rows into tokens) and a{' '}
                <span className="font-semibold">Timepoint</span> column (measurement time).
                Formants use bare <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F1</code>,{' '}
                <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">F2</code> columns.
                Timepoints are normalized to 0–100% on import.
              </p>
              <p>
                <span className="font-bold text-slate-800">Other columns:</span>{' '}
                Auto-classified as <span className="font-semibold">Filter</span> (categorical, for sidebar filtering and grouping)
                or <span className="font-semibold">Data</span> (numeric, for plotting). You can change the role of any column in the table below.
              </p>
            </div>
          )}
        </div>

        {/* Scrollable table */}
        <div className="flex-1 overflow-y-auto p-5 pt-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-slate-200">
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-36">CSV Column</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-40">Sample Values</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-36">Map To</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2">Field Name</th>
                <th className="text-center text-[11px] font-bold text-slate-400 uppercase py-2 w-24">Type</th>
                <th className="text-center text-[11px] font-bold text-slate-400 uppercase py-2 w-16">
                  <span
                    className="cursor-help border-b border-dashed border-slate-300"
                    onMouseEnter={e => setSidebarHelpRect(e.currentTarget.getBoundingClientRect())}
                    onMouseLeave={() => setSidebarHelpRect(null)}
                  >Sidebar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map(row => {
                if (row.kind === 'group') {
                  const isExpanded = expandedGroups.has(row.groupKey);
                  return (
                    <React.Fragment key={`group_${row.groupKey}`}>
                      <tr className="border-b border-slate-100 bg-emerald-50/40">
                        <td colSpan={6} className="py-1">
                          <button
                            onClick={() => toggleGroup(row.groupKey)}
                            className="flex items-center gap-2 hover:bg-emerald-100/50 rounded px-2 py-1 w-full text-left transition-colors"
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <span className="font-mono text-xs font-bold text-slate-700">
                              {row.label}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {describeGroup(row.members, row.isSpectral)}
                            </span>
                            <span className="ml-auto text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">
                              {row.badge}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {isExpanded && row.members.map(mem => renderMappingRow(mem.m, mem.idx, true))}
                    </React.Fragment>
                  );
                }
                return renderMappingRow(row.m, row.idx, false);
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            {validationError && (
              <span className="text-xs text-red-600 font-medium">{validationError}</span>
            )}
          </div>
          <button
            onClick={() => {
              const emptyField = mappings.filter(m => m.role === 'field' && !m.fieldName?.trim());
              if (emptyField.length > 0) {
                setValidationError(`${emptyField.length} field(s) have empty names`);
                return;
              }
              if (reservedClashes.size > 0) {
                const names = [...reservedClashes].map(i => `"${mappings[i].fieldName}"`).join(', ');
                setValidationError(`Reserved name clash: ${names} — please rename to avoid conflicts`);
                return;
              }
              const hasTokenId = mappings.some(m => m.role === 'token_id');
              const hasTimepoint = mappings.some(m => m.role === 'timepoint');
              if (hasTokenId !== hasTimepoint) {
                setValidationError('Token ID and Timepoint must both be assigned for long-format data');
                return;
              }
              // Time-slice must have a unit chosen
              if (showTrajectoryPanel && effectiveFormat === 'time-slice' && !effectiveUnit) {
                setValidationError('Please choose a unit (ms or seconds) for your time-slice data');
                return;
              }
              const trajectoryOverride: TrajectoryFormatOverride | undefined = showTrajectoryPanel
                ? { format: effectiveFormat, unit: effectiveFormat === 'time-slice' ? effectiveUnit : undefined }
                : undefined;
              onConfirm(mappings, trajectoryOverride);
            }}
            className="px-6 py-2 text-xs font-bold text-white bg-slate-600 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            {isEditMode ? <RefreshCw size={14} /> : <Upload size={14} />}
            {isEditMode ? 'Apply Changes' : 'Import Data'}
          </button>
        </div>

        {/* Fixed-position tooltips */}
        {sidebarHelpRect && (
          <div
            className="fixed w-48 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: sidebarHelpRect.bottom + 4, left: sidebarHelpRect.left + sidebarHelpRect.width / 2 - 96 }}
          >
            Tick to show this field as a filter in the sidebar. Can be changed after import.
          </div>
        )}
        {speakerHelpRect && (
          <div
            className="fixed w-56 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: speakerHelpRect.bottom + 4, left: speakerHelpRect.left + speakerHelpRect.width / 2 - 112 }}
          >
            Used for speaker normalisation (Lobanov, Nearey). If no Speaker ID is specified, normalisation functionality will not be accessible.
          </div>
        )}
        {fileIdHelpRect && (
          <div
            className="fixed w-56 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: fileIdHelpRect.bottom + 4, left: fileIdHelpRect.left + fileIdHelpRect.width / 2 - 112 }}
          >
            The audio filename helps you identify and trace individual tokens back to their source recording. Useful for tracking down outliers.
          </div>
        )}
      </div>
    </div>
  );
};

export default DataMappingDialog;
