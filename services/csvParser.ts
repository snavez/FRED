
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
addAliases(['xmin', 'onset', 'start', 'start_time'], 'xmin');
addAliases(['duration', 'dur', 'seg_dur'], 'duration');

const FORMANT_REGEX = /^(f[123])_(\d+)(?:_(.+))?$/i;

/**
 * Auto-detect column mappings from CSV headers + sample data.
 * Special roles (speaker, file_id, xmin, duration) detected via alias table.
 * Formant columns detected via regex (f1_50, f2_75_smooth, etc.).
 * Everything else: categorical (≤50 unique, not mostly numeric) → field; else → ignore.
 */
export const autoDetectMappings = (headers: string[], sampleRows: string[][]): ColumnMapping[] => {
  return headers.map(header => {
    const lower = header.toLowerCase().trim();

    // 1. Check alias table for special roles
    if (ALIAS_TABLE[lower]) {
      const role = ALIAS_TABLE[lower];
      return {
        csvHeader: header,
        role,
        showInSidebar: role === 'speaker' || role === 'file_id',
      };
    }

    // 2. Check formant pattern (f1_50, f2_75_smooth, etc.)
    const formantMatch = lower.match(FORMANT_REGEX);
    if (formantMatch) {
      const formant = formantMatch[1].toLowerCase() as 'f1' | 'f2' | 'f3';
      const timePoint = parseInt(formantMatch[2], 10);
      const suffix = formantMatch[3];
      const isSmooth = !!suffix;
      const formantLabel = suffix || undefined;
      return { csvHeader: header, role: 'formant' as ColumnRole, formant, timePoint, isSmooth, formantLabel };
    }

    // 3. Remaining: check if categorical (≤50 unique values) or numeric
    const colIdx = headers.indexOf(header);
    const values = sampleRows.map(row => row[colIdx] || '').filter(v => v !== '');
    const unique = new Set(values);

    if (unique.size > 0 && unique.size <= 50) {
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
  let xminIdx: number | undefined;
  let durationIdx: number | undefined;
  const formantMappings: { colIdx: number, formant: 'f1' | 'f2' | 'f3', timePoint: number, isSmooth: boolean }[] = [];
  const fieldMappings: { colIdx: number, fieldName: string }[] = [];

  mappings.forEach(m => {
    const colIdx = headerIdxMap[m.csvHeader];
    if (colIdx === undefined) return;

    switch (m.role) {
      case 'speaker': speakerIdx = colIdx; break;
      case 'file_id': fileIdIdx = colIdx; break;
      case 'xmin': xminIdx = colIdx; break;
      case 'duration': durationIdx = colIdx; break;
      case 'formant':
        if (m.formant !== undefined && m.timePoint !== undefined) {
          formantMappings.push({ colIdx, formant: m.formant, timePoint: m.timePoint, isSmooth: m.isSmooth || false });
        }
        break;
      case 'field':
        if (m.fieldName) {
          fieldMappings.push({ colIdx, fieldName: m.fieldName });
        }
        break;
      // 'ignore' — skip
    }
  });

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
      xmin: xminIdx !== undefined ? (parseFloat(row[xminIdx]) || 0) : 0,
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

  const meta: DatasetMeta = {
    fileName,
    columnMappings: mappings,
    timePoints: sortedTimePoints,
    rowCount: tokens.length,
    formantVariants
  };

  return { tokens, meta };
};
