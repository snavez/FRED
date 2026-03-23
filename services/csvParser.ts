
import { SpeechToken, TrajectoryPoint, ColumnMapping, ColumnRole, DatasetMeta } from '../types';

// --- Delimiter & row utilities ---

/**
 * Detect delimiter: tab vs comma based on first line.
 */
export const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
};

/**
 * Split a row by delimiter, respecting quoted fields.
 */
export const splitRow = (line: string, delimiter: string): string[] => {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ''));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ''));
  return result;
};

// --- Alias table for auto-detection (only special roles) ---

const ALIAS_TABLE: Record<string, ColumnRole> = {};
const addAliases = (aliases: string[], role: ColumnRole) => {
  aliases.forEach(a => { ALIAS_TABLE[a.toLowerCase()] = role; });
};
addAliases(['speaker', 'speaker_id', 'participant', 'subject'], 'speaker');
addAliases(['file_id', 'fileid', 'filename', 'file'], 'file_id');
addAliases(['duration', 'dur', 'seg_dur', 'dur_phonemic', 'dur_phoneme', 'phone_dur', 'phon_dur', 'vowel_dur', 'seg_duration', 'segment_dur', 'segment_duration'], 'duration');
addAliases(['pitch', 'f0', 'voice_pitch'], 'pitch');

// Formant patterns (case-insensitive):
//   f1_50, f1_50%, f1_50_smooth, f1_50%_smooth   → numeric timepoint
//   f1, f2, f3                                      → bare (single measurement, timepoint=0)
//   f1_onset, f1_midpoint_smooth                    → named target
const FORMANT_NUMERIC_REGEX = /^(f[12345])_(\d+)%?(?:_(.+))?$/i;
const FORMANT_BARE_REGEX = /^(f[12345])$/i;
const FORMANT_NAMED_REGEX = /^(f[12345])_([a-z][a-z0-9]*)(?:_(.+))?$/i;
const PITCH_REGEX = /^f0_(\d+)%?(?:_(.+))?$/i;

/** Names that should populate SpeechToken.xmin (now detected as regular fields) */
const XMIN_NAMES = new Set(['xmin', 'onset', 'start', 'start_time']);

/**
 * Auto-detect column mappings from CSV headers + sample data.
 * Special roles (speaker, file_id, duration, pitch) detected via alias table.
 * Formant columns detected via regex:
 *   - Numeric: f1_50, f1_50%, f2_75_smooth, F1_0%  → timePoint = numeric value
 *   - Bare:    f1, F2, f3                           → timePoint = 0 (single measurement)
 *   - Named:   f1_onset, f2_midpoint_smooth         → timePoint = sequential index
 * Pitch time-point columns detected via regex (f0_50, f0_80_smooth, etc.).
 * xmin-like columns detected as regular data fields.
 * Everything else: categorical (≤50 unique, not mostly numeric) → field; else → ignore.
 */
export const autoDetectMappings = (headers: string[], sampleRows: string[][]): ColumnMapping[] => {
  // Pass 1: collect all numeric formant timepoints AND named targets in order of first appearance
  const numericTimePoints = new Set<number>();
  const namedTargetOrder: string[] = [];
  const namedTargetSet = new Set<string>();
  headers.forEach(header => {
    const lower = header.toLowerCase().trim();
    // Skip if it matches alias table, xmin, or pitch
    if (ALIAS_TABLE[lower] || XMIN_NAMES.has(lower)) return;
    if (PITCH_REGEX.test(lower)) return;

    // Collect numeric timepoints (including bare formant → 0)
    const numericMatch = lower.match(FORMANT_NUMERIC_REGEX);
    if (numericMatch) {
      numericTimePoints.add(parseInt(numericMatch[2], 10));
      return;
    }
    if (FORMANT_BARE_REGEX.test(lower)) {
      numericTimePoints.add(0);
      return;
    }

    // Collect named targets
    const namedMatch = lower.match(FORMANT_NAMED_REGEX);
    if (namedMatch) {
      const target = namedMatch[2];
      if (!namedTargetSet.has(target)) {
        namedTargetSet.add(target);
        namedTargetOrder.push(target);
      }
    }
  });
  // Build target → numeric index map, starting ABOVE all numeric timepoints to avoid collisions
  const namedTargetBase = numericTimePoints.size > 0 ? Math.max(...numericTimePoints) + 1000 : 0;
  const namedTargetIndex: Record<string, number> = {};
  namedTargetOrder.forEach((t, i) => { namedTargetIndex[t] = namedTargetBase + i; });

  // Pass 2: build mappings
  return headers.map(header => {
    const lower = header.toLowerCase().trim();

    // 1. Check alias table for special roles
    if (ALIAS_TABLE[lower]) {
      const role = ALIAS_TABLE[lower];
      const isData = role === 'duration' || role === 'pitch';
      return {
        csvHeader: header,
        role,
        fieldName: (role === 'pitch' || role === 'duration') ? header : undefined,
        showInSidebar: !isData && (role === 'speaker' || role === 'file_id'),
        isDataField: isData,
      };
    }

    // 1a. Fuzzy duration detection: columns containing "dur" as a component (e.g. dur_phonemic, vowel_dur)
    if (/^dur[_]|[_]dur$|[_]dur[_]|^duration[_]|[_]duration$/.test(lower)) {
      return {
        csvHeader: header,
        role: 'duration' as ColumnRole,
        fieldName: header,
        isDataField: true,
      };
    }

    // 1b. xmin-like columns → regular data field
    if (XMIN_NAMES.has(lower)) {
      return {
        csvHeader: header,
        role: 'field' as ColumnRole,
        fieldName: header,
        showInSidebar: false,
        isDataField: true,
      };
    }

    // 2a. Check numeric formant pattern (f1_50, f1_50%, f2_75_smooth, etc.)
    const numericMatch = lower.match(FORMANT_NUMERIC_REGEX);
    if (numericMatch) {
      const formant = numericMatch[1].toLowerCase() as 'f1' | 'f2' | 'f3';
      const timePoint = parseInt(numericMatch[2], 10);
      const suffix = numericMatch[3];
      const isSmooth = !!suffix;
      const formantLabel = suffix || undefined;
      return { csvHeader: header, role: 'formant' as ColumnRole, formant, timePoint, isSmooth, formantLabel, isDataField: true };
    }

    // 2b. Check bare formant (f1, F2, f3 — single measurement)
    const bareMatch = lower.match(FORMANT_BARE_REGEX);
    if (bareMatch) {
      const formant = bareMatch[1].toLowerCase() as 'f1' | 'f2' | 'f3';
      return { csvHeader: header, role: 'formant' as ColumnRole, formant, timePoint: 0, isSmooth: false, isDataField: true };
    }

    // 2c. Check named formant target (f1_onset, f2_midpoint_smooth, etc.)
    const namedMatch = lower.match(FORMANT_NAMED_REGEX);
    if (namedMatch) {
      const formant = namedMatch[1].toLowerCase() as 'f1' | 'f2' | 'f3';
      const target = namedMatch[2];
      const suffix = namedMatch[3];
      const isSmooth = !!suffix;
      const formantLabel = suffix || undefined;
      return {
        csvHeader: header, role: 'formant' as ColumnRole, formant,
        timePoint: namedTargetIndex[target],
        formantTarget: target,
        isSmooth, formantLabel, isDataField: true,
      };
    }

    // 2d. Check pitch time-point pattern (f0_50, f0_50%, f0_80_smooth, etc.)
    const pitchMatch = lower.match(PITCH_REGEX);
    if (pitchMatch) {
      return {
        csvHeader: header,
        role: 'pitch' as ColumnRole,
        fieldName: header,
        isDataField: true,
      };
    }

    // 3. Remaining: check if categorical (≤50 unique values) or numeric
    const colIdx = headers.indexOf(header);
    const values = sampleRows.map(row => row[colIdx] || '').filter(v => v !== '');
    const unique = new Set(values);

    // If no values in sample rows, default to field (not ignore) — full data may have values
    if (unique.size === 0) {
      return {
        csvHeader: header,
        role: 'field' as ColumnRole,
        fieldName: header,
        showInSidebar: false,
        isDataField: false,
      };
    }

    if (unique.size <= 50) {
      const numericCount = values.filter(v => !isNaN(parseFloat(v))).length;
      const mostlyNumeric = values.length > 0 && numericCount / values.length > 0.8;
      if (mostlyNumeric && unique.size > 20) {
        return { csvHeader: header, role: 'ignore' as ColumnRole };
      }
      return {
        csvHeader: header,
        role: 'field' as ColumnRole,
        fieldName: header,
        showInSidebar: !mostlyNumeric,
        isDataField: mostlyNumeric,
      };
    }

    return { csvHeader: header, role: 'ignore' as ColumnRole };
  });
};

/**
 * Parse file text using user-confirmed column mappings.
 * Produces SpeechToken[] with generic `fields` for all 'field' role columns.
 */
export const parseWithMappings = (
  text: string,
  mappings: ColumnMapping[],
  fileName: string = ''
): { tokens: SpeechToken[], meta: DatasetMeta } => {
  const delimiter = detectDelimiter(text);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { tokens: [], meta: { fileName, columnMappings: mappings, timePoints: [], rowCount: 0 } };

  const headers = splitRow(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

  // Build header index map
  const headerIdxMap: Record<string, number> = {};
  headers.forEach((h, i) => { headerIdxMap[h] = i; });

  // Organize mappings by type
  let speakerIdx: number | undefined;
  let fileIdIdx: number | undefined;
  let durationIdx: number | undefined;
  const formantMappings: { colIdx: number, formant: 'f1' | 'f2' | 'f3' | 'f4' | 'f5', timePoint: number, isSmooth: boolean }[] = [];
  const fieldMappings: { colIdx: number, fieldName: string }[] = [];

  mappings.forEach(m => {
    const colIdx = headerIdxMap[m.csvHeader];
    if (colIdx === undefined) return;

    switch (m.role) {
      case 'speaker': speakerIdx = colIdx; break;
      case 'file_id': fileIdIdx = colIdx; break;
      case 'duration':
        if (durationIdx === undefined) durationIdx = colIdx;
        // Also store as named field so all duration columns appear in token.fields
        if (m.fieldName || m.csvHeader) {
          fieldMappings.push({ colIdx, fieldName: m.fieldName || m.csvHeader });
        }
        break;
      case 'formant':
        if (m.formant !== undefined && m.timePoint !== undefined) {
          formantMappings.push({ colIdx, formant: m.formant, timePoint: m.timePoint, isSmooth: m.isSmooth || false });
          // F4/F5 can't be stored in TrajectoryPoint (only f1-f3), so also store as named fields
          if (m.formant === 'f4' || m.formant === 'f5') {
            const fFieldName = m.csvHeader || `${m.formant}_${m.timePoint}`;
            fieldMappings.push({ colIdx, fieldName: fFieldName });
          }
        }
        break;
      case 'pitch':
      case 'field':
        if (m.fieldName) {
          fieldMappings.push({ colIdx, fieldName: m.fieldName });
        }
        break;
      // 'ignore' — skip
    }
  });

  // Find xmin-like field for SpeechToken.xmin population
  const xminFieldMapping = fieldMappings.find(fm => XMIN_NAMES.has(fm.fieldName.toLowerCase()));

  // Collect unique time points from formant mappings
  const timePointSet = new Set<number>();
  formantMappings.forEach(fm => timePointSet.add(fm.timePoint));
  const sortedTimePoints = Array.from(timePointSet).sort((a, b) => a - b);

  const tokens: SpeechToken[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = splitRow(line, delimiter);
    if (row.length === 0) continue;

    // Build trajectory from formant mappings
    const trajMap: Record<number, { f1: number, f2: number, f3: number, f1_smooth: number, f2_smooth: number, f3_smooth: number }> = {};
    sortedTimePoints.forEach(tp => {
      trajMap[tp] = { f1: NaN, f2: NaN, f3: NaN, f1_smooth: NaN, f2_smooth: NaN, f3_smooth: NaN };
    });

    formantMappings.forEach(fm => {
      const val = parseFloat(row[fm.colIdx]);
      if (isNaN(val)) return;
      const entry = trajMap[fm.timePoint];
      if (!entry) return;
      const key = fm.isSmooth ? `${fm.formant}_smooth` : fm.formant;
      (entry as any)[key] = val;
    });

    const trajectory: TrajectoryPoint[] = [];
    sortedTimePoints.forEach(tp => {
      const entry = trajMap[tp];
      const effF1S = !isNaN(entry.f1_smooth) ? entry.f1_smooth : entry.f1;
      const effF2S = !isNaN(entry.f2_smooth) ? entry.f2_smooth : entry.f2;
      const effF3S = !isNaN(entry.f3_smooth) ? entry.f3_smooth : entry.f3;
      const hasRaw = !isNaN(entry.f1) && !isNaN(entry.f2);
      const hasSmooth = !isNaN(effF1S) && !isNaN(effF2S);

      if (hasRaw || hasSmooth) {
        trajectory.push({
          time: tp,
          f1: entry.f1,
          f2: entry.f2,
          f3: isNaN(entry.f3) ? 0 : entry.f3,
          f1_smooth: effF1S,
          f2_smooth: effF2S,
          f3_smooth: isNaN(effF3S) ? (isNaN(entry.f3) ? 0 : entry.f3) : effF3S
        });
      }
    });

    // Build generic fields from all 'field' role columns
    const fields: Record<string, string> = {};
    fieldMappings.forEach(fm => {
      fields[fm.fieldName] = row[fm.colIdx] || '';
    });

    const speaker = speakerIdx !== undefined ? (row[speakerIdx] || '') : '';
    const fileId = fileIdIdx !== undefined ? (row[fileIdIdx] || '') : '';

    tokens.push({
      id: speaker ? `${speaker}_row_${i}` : (fileId ? `${fileId}_row_${i}` : `row_${i}`),
      speaker,
      file_id: fileId,
      xmin: xminFieldMapping ? (parseFloat(row[xminFieldMapping.colIdx]) || 0) : 0,
      duration: durationIdx !== undefined ? (parseFloat(row[durationIdx]) || 0) : 0,
      trajectory,
      fields,
    });
  }

  // Compute formant variants from formant-role mappings
  const formantLabelSet = new Set<string | undefined>();
  mappings.forEach(m => {
    if (m.role === 'formant') {
      formantLabelSet.add(m.formantLabel);
    }
  });
  let formantVariants: string[] | undefined;
  if (formantLabelSet.size >= 2) {
    const labels = Array.from(formantLabelSet);
    const hasRaw = labels.includes(undefined);
    const namedLabels = labels.filter((l): l is string => l !== undefined).sort();
    formantVariants = hasRaw ? ['Original', ...namedLabels] : namedLabels;
  }

  // Build timePointLabels from formant mappings
  // If any mapping has a named target, use those labels; otherwise omit (UI defaults to %)
  const hasNamedTargets = mappings.some(m => m.role === 'formant' && m.formantTarget);
  let timePointLabels: Record<number, string> | undefined;
  if (hasNamedTargets) {
    timePointLabels = {};
    mappings.forEach(m => {
      if (m.role === 'formant' && m.timePoint !== undefined && m.formantTarget) {
        timePointLabels![m.timePoint] = m.formantTarget;
      }
    });
  }

  const meta: DatasetMeta = {
    fileName,
    columnMappings: mappings,
    timePoints: sortedTimePoints,
    timePointLabels,
    rowCount: tokens.length,
    formantVariants
  };

  return { tokens, meta };
};
