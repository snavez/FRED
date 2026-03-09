
import { SpeechToken, TrajectoryPoint, ColumnMapping, ColumnRole, DatasetMeta } from '../types';

/**
 * Parses CSV text into SpeechToken objects.
 * Handles quoted fields with internal commas and missing values.
 */
export const parseSpeechCSV = (csvText: string): SpeechToken[] => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  // Extract headers and remove quotes/whitespace, convert to lowercase for case-insensitive matching
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const tokens: SpeechToken[] = [];

  const getIdx = (name: string) => headers.indexOf(name.toLowerCase());

  // Helper to split CSV row correctly (handling quotes and commas)
  const splitCSVRow = (line: string): string[] => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, ''));
    return result;
  };

  const fileIdIdx = getIdx('file_id');
  const wordIdx = getIdx('word');
  const syllableIdx = getIdx('syllable');
  const sylMarkIdx = getIdx('syllable_mark');
  const canStressIdx = getIdx('canonical_stress');
  const lexStressIdx = getIdx('lexical_stress');
  const canonicalIdx = getIdx('canonical');
  const producedIdx = getIdx('produced');
  const alignIdx = getIdx('alignment');
  const typeIdx = getIdx('type');
  const canTypeIdx = getIdx('canonical_type');
  const pitchIdx = getIdx('voice_pitch');
  const xminIdx = getIdx('xmin');
  const durIdx = getIdx('duration');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const row = splitCSVRow(line);
    // Relaxed length check: row should have enough data but strict length match might fail with trailing empty cols
    if (row.length === 0) continue; 

    // Map trajectory points (f1, f2, f3)
    const trajectory: TrajectoryPoint[] = [];
    for (let p = 0; p <= 100; p += 10) {
      const pStr = p.toString().padStart(2, '0');
      
      const f1Idx = getIdx(`f1_${pStr}`);
      const f2Idx = getIdx(`f2_${pStr}`);
      const f3Idx = getIdx(`f3_${pStr}`);
      
      const f1SIdx = getIdx(`f1_${pStr}_smooth`);
      const f2SIdx = getIdx(`f2_${pStr}_smooth`);
      const f3SIdx = getIdx(`f3_${pStr}_smooth`);
      
      const f1Val = f1Idx > -1 ? parseFloat(row[f1Idx]) : NaN;
      const f2Val = f2Idx > -1 ? parseFloat(row[f2Idx]) : NaN;
      const f3Val = f3Idx > -1 ? parseFloat(row[f3Idx]) : NaN;

      const f1SVal = f1SIdx > -1 ? parseFloat(row[f1SIdx]) : NaN;
      const f2SVal = f2SIdx > -1 ? parseFloat(row[f2SIdx]) : NaN;
      const f3SVal = f3SIdx > -1 ? parseFloat(row[f3SIdx]) : NaN;
      
      // Effective Smooth Values: if missing in CSV, fallback to raw, else NaN
      const effF1S = !isNaN(f1SVal) ? f1SVal : f1Val;
      const effF2S = !isNaN(f2SVal) ? f2SVal : f2Val;
      const effF3S = !isNaN(f3SVal) ? f3SVal : f3Val;

      // Include point if either Raw or Smooth data exists for F1/F2
      const hasRaw = !isNaN(f1Val) && !isNaN(f2Val);
      const hasSmooth = !isNaN(effF1S) && !isNaN(effF2S);
      
      if (hasRaw || hasSmooth) {
        trajectory.push({ 
            time: p, 
            f1: f1Val, 
            f2: f2Val,
            f3: isNaN(f3Val) ? 0 : f3Val,
            f1_smooth: effF1S,
            f2_smooth: effF2S,
            f3_smooth: isNaN(effF3S) ? (isNaN(f3Val) ? 0 : f3Val) : effF3S
        });
      }
    }

    // Determine type/canonical_type defaults to ensure visibility
    const rawType = typeIdx > -1 ? row[typeIdx] : '';
    const rawCanType = canTypeIdx > -1 ? row[canTypeIdx] : '';
    const effectiveType = rawType || 'vowel'; 
    const effectiveCanType = rawCanType || effectiveType;

    tokens.push({
      id: fileIdIdx > -1 ? `${row[fileIdIdx]}_row_${i}` : `row_${i}`,
      file_id: fileIdIdx > -1 ? row[fileIdIdx] : '',
      word: wordIdx > -1 ? row[wordIdx] : '',
      syllable: syllableIdx > -1 ? row[syllableIdx] : '',
      syllable_mark: sylMarkIdx > -1 ? row[sylMarkIdx] : '',
      canonical_stress: canStressIdx > -1 ? row[canStressIdx] : '',
      lexical_stress: lexStressIdx > -1 ? row[lexStressIdx] : '',
      canonical: canonicalIdx > -1 ? row[canonicalIdx] : '?',
      produced: producedIdx > -1 ? row[producedIdx] : '',
      alignment: alignIdx > -1 ? row[alignIdx] : '',
      type: effectiveType,
      canonical_type: effectiveCanType,
      voice_pitch: pitchIdx > -1 ? row[pitchIdx] : '',
      xmin: xminIdx > -1 ? (parseFloat(row[xminIdx]) || 0) : 0,
      duration: durIdx > -1 ? (parseFloat(row[durIdx]) || 0) : 0,
      trajectory
    });
  }

  return tokens;
};

/**
 * Phonetic rule for identifying monophthongs.
 */
export const isMonophthong = (canonical: string): boolean => {
  if (!canonical) return false;
  // Monophthongs: single character or 2 chars where second is a length mark (:)
  return canonical.length === 1 || (canonical.length === 2 && canonical[1] === ':');
};

// --- Flexible file parsing ---

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

// Alias table for auto-detection
const ALIAS_TABLE: Record<string, ColumnRole> = {};
const addAliases = (aliases: string[], role: ColumnRole) => {
  aliases.forEach(a => { ALIAS_TABLE[a.toLowerCase()] = role; });
};
addAliases(['file_id', 'fileid', 'speaker', 'speaker_id', 'participant', 'subject'], 'file_id');
addAliases(['word', 'words'], 'word');
addAliases(['syllable', 'syl'], 'syllable');
addAliases(['syllable_mark', 'syl_mark'], 'syllable_mark');
addAliases(['canonical_stress', 'can_stress', 'expected_stress'], 'canonical_stress');
addAliases(['lexical_stress', 'lex_stress', 'transcribed_stress'], 'lexical_stress');
addAliases(['canonical', 'phoneme', 'target', 'target_phoneme', 'vowel', 'segment'], 'canonical');
addAliases(['produced', 'allophone', 'actual', 'realised', 'realized', 'transcribed'], 'produced');
addAliases(['alignment', 'align', 'align_type'], 'alignment');
addAliases(['type', 'segment_type'], 'type');
addAliases(['canonical_type', 'can_type', 'vowel_type', 'vowel_category', 'vowel_cat'], 'canonical_type');
addAliases(['duration', 'dur', 'seg_dur'], 'duration');
addAliases(['xmin', 'onset', 'start', 'start_time'], 'xmin');
addAliases(['voice_pitch', 'pitch'], 'voice_pitch');

const FORMANT_REGEX = /^(f[123])_(\d+)(?:_(.+))?$/i;

/** Built-in roles that can appear as sidebar filter sections */
export const SIDEBAR_ELIGIBLE_ROLES = new Set<ColumnRole>([
  'file_id', 'type', 'canonical_type', 'canonical', 'word', 'alignment', 'produced',
  'canonical_stress', 'lexical_stress', 'syllable_mark', 'voice_pitch'
]);

/**
 * Auto-detect column mappings from CSV headers + sample data.
 */
export const autoDetectMappings = (headers: string[], sampleRows: string[][]): ColumnMapping[] => {
  return headers.map(header => {
    const lower = header.toLowerCase().trim();

    // 1. Check alias table
    if (ALIAS_TABLE[lower]) {
      const role = ALIAS_TABLE[lower];
      return {
        csvHeader: header,
        role,
        showInSidebar: SIDEBAR_ELIGIBLE_ROLES.has(role)
      };
    }

    // 2. Check formant pattern
    const formantMatch = lower.match(FORMANT_REGEX);
    if (formantMatch) {
      const formant = formantMatch[1].toLowerCase() as 'f1' | 'f2' | 'f3';
      const timePoint = parseInt(formantMatch[2], 10);
      const suffix = formantMatch[3];
      const isSmooth = !!suffix;
      const formantLabel = suffix || undefined;
      return { csvHeader: header, role: 'formant' as ColumnRole, formant, timePoint, isSmooth, formantLabel };
    }

    // 3. Remaining: check if categorical (<=50 unique values) or numeric
    const colIdx = headers.indexOf(header);
    const values = sampleRows.map(row => row[colIdx] || '').filter(v => v !== '');
    const unique = new Set(values);

    if (unique.size > 0 && unique.size <= 50) {
      // Check if mostly numeric
      const numericCount = values.filter(v => !isNaN(parseFloat(v))).length;
      const mostlyNumeric = values.length > 0 && numericCount / values.length > 0.8;
      if (mostlyNumeric && unique.size > 20) {
        return { csvHeader: header, role: 'ignore' as ColumnRole };
      }
      return { csvHeader: header, role: 'custom' as ColumnRole, customFieldName: header, showInSidebar: !mostlyNumeric };
    }

    return { csvHeader: header, role: 'ignore' as ColumnRole };
  });
};

/**
 * Parse file text using user-confirmed column mappings.
 */
export const parseWithMappings = (
  text: string,
  mappings: ColumnMapping[],
  fileName: string = ''
): { tokens: SpeechToken[], meta: DatasetMeta } => {
  const delimiter = detectDelimiter(text);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { tokens: [], meta: { fileName, columnMappings: mappings, timePoints: [], customColumns: [], rowCount: 0 } };

  const headers = splitRow(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

  // Build header index map
  const headerIdxMap: Record<string, number> = {};
  headers.forEach((h, i) => { headerIdxMap[h] = i; });

  // Organize mappings by role for fast access
  const builtInMap: Record<string, number> = {};
  const formantMappings: { colIdx: number, formant: 'f1' | 'f2' | 'f3', timePoint: number, isSmooth: boolean }[] = [];
  const customMappings: { colIdx: number, fieldName: string }[] = [];

  const builtInRoles: ColumnRole[] = ['file_id', 'word', 'syllable', 'syllable_mark', 'canonical_stress', 'lexical_stress', 'canonical', 'produced', 'alignment', 'type', 'canonical_type', 'voice_pitch', 'xmin', 'duration'];

  mappings.forEach(m => {
    const colIdx = headerIdxMap[m.csvHeader];
    if (colIdx === undefined) return;

    if (m.role === 'formant' && m.formant !== undefined && m.timePoint !== undefined) {
      formantMappings.push({ colIdx, formant: m.formant, timePoint: m.timePoint, isSmooth: m.isSmooth || false });
    } else if (m.role === 'custom' && m.customFieldName) {
      customMappings.push({ colIdx, fieldName: m.customFieldName });
    } else if (builtInRoles.includes(m.role)) {
      builtInMap[m.role] = colIdx;
    }
  });

  // Collect unique time points from formant mappings
  const timePointSet = new Set<number>();
  formantMappings.forEach(fm => timePointSet.add(fm.timePoint));
  const sortedTimePoints = Array.from(timePointSet).sort((a, b) => a - b);

  // Collect custom column names
  const customColumns = customMappings.map(cm => cm.fieldName);

  const tokens: SpeechToken[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = splitRow(line, delimiter);
    if (row.length === 0) continue;

    const getVal = (role: string): string => {
      const idx = builtInMap[role];
      return idx !== undefined ? (row[idx] || '') : '';
    };

    // Build trajectory from formant mappings
    // Group by timePoint
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
      // Smooth fallback to raw
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

    // Build custom fields
    const customFields: Record<string, string> = {};
    customMappings.forEach(cm => {
      customFields[cm.fieldName] = row[cm.colIdx] || '';
    });

    const rawType = getVal('type');
    const rawCanType = getVal('canonical_type');
    const effectiveType = rawType || 'vowel';
    const effectiveCanType = rawCanType || effectiveType;

    const fileId = getVal('file_id');

    tokens.push({
      id: fileId ? `${fileId}_row_${i}` : `row_${i}`,
      file_id: fileId,
      word: getVal('word'),
      syllable: getVal('syllable'),
      syllable_mark: getVal('syllable_mark'),
      canonical_stress: getVal('canonical_stress'),
      lexical_stress: getVal('lexical_stress'),
      canonical: getVal('canonical') || '?',
      produced: getVal('produced'),
      alignment: getVal('alignment'),
      type: effectiveType,
      canonical_type: effectiveCanType,
      voice_pitch: getVal('voice_pitch'),
      xmin: parseFloat(getVal('xmin')) || 0,
      duration: parseFloat(getVal('duration')) || 0,
      trajectory,
      customFields: customColumns.length > 0 ? customFields : undefined
    });
  }

  // Compute formant variants from formant-role mappings
  const formantLabelSet = new Set<string | undefined>();
  mappings.forEach(m => {
    if (m.role === 'formant') {
      formantLabelSet.add(m.formantLabel); // undefined for unlabeled
    }
  });
  let formantVariants: string[] | undefined;
  if (formantLabelSet.size >= 2) {
    const labels = Array.from(formantLabelSet);
    // Put unlabeled (raw/original) first, then named variants alphabetically
    const hasRaw = labels.includes(undefined);
    const namedLabels = labels.filter((l): l is string => l !== undefined).sort();
    formantVariants = hasRaw ? ['Original', ...namedLabels] : namedLabels;
  }

  const meta: DatasetMeta = {
    fileName,
    columnMappings: mappings,
    timePoints: sortedTimePoints,
    customColumns,
    rowCount: tokens.length,
    formantVariants
  };

  return { tokens, meta };
};
