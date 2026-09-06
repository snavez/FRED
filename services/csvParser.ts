
import { SpeechToken, TrajectoryPoint, ColumnMapping, ColumnRole, DatasetMeta, TrajectoryFormat, TrajectoryUnit, TrajectorySpacing } from '../types';
import { measureNumericColumns } from '../utils/numericFields';
import { detectSpectralRole, spectralColumnRegion } from '../utils/spectralMoments';

/** Threshold: ≥ this many non-target timepoints per formant = trajectory data. */
export const TRAJECTORY_MIN_POINTS = 4;
/** Spacing uniformity tolerance: intervals within ±X of median are "uniform". */
const UNIFORM_TOLERANCE = 0.10;
/** Max distinct timepoints to list individually in the spacing description. */
const MAX_LISTED_VALUES = 8;

// --- Delimiter & row utilities ---

/**
 * Detect delimiter: tab vs comma based on first line.
 */
export const detectDelimiter = (text: string): string => {
  const firstLine = splitRows(text)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
};

/**
 * Split CSV text into rows. A newline inside a quoted field is part of the value, not the
 * end of a row — exporters write those whenever a label contains a line break, and
 * splitting the text on newlines first tears such a row in two: the tail of the row then
 * arrives as a value of the first column, which is how a file id ends up holding half a
 * row of formant numbers.
 */
export const splitRows = (text: string): string[] => {
  const rows: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not the end of one.
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue; }
      inQuotes = !inQuotes;
      cur += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      rows.push(cur);
      cur = '';
    } else {
      cur += char;
    }
  }
  rows.push(cur);
  return rows;
};

/** Split one row into cells by delimiter, respecting quoted fields. */
export const splitRow = (line: string, delimiter: string): string[] => {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  // A value that spanned lines in the file is still one value here; collapse the break so
  // it reads as a single label rather than wrapping in every menu it appears in. The
  // scanner has already consumed the quotes that delimited it, so what is left is the
  // value itself — including any quote the file escaped as "".
  const cell = (v: string) => v.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(cell(cur));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cell(cur));
  return result;
};

// --- Header detection heuristic ---

export interface HeaderDetectionResult {
  hasHeaders: boolean;
  confidence: number;
}

const isNumericValue = (v: string): boolean => {
  const trimmed = v.trim();
  return trimmed !== '' && !isNaN(Number(trimmed));
};

/**
 * Detect whether the first row of a CSV looks like column headers or data.
 * Returns a best guess + confidence score (0–1).
 */
export const detectHeaderRow = (firstRow: string[], restRows: string[][]): HeaderDetectionResult => {
  if (firstRow.length === 0) return { hasHeaders: true, confidence: 0.5 };

  let score = 0;
  const nonEmpty = firstRow.filter(v => v.trim() !== '');

  // 1. Numeric ratio: headers are usually non-numeric; data rows are often numeric
  const firstRowNumericRatio = nonEmpty.length > 0
    ? nonEmpty.filter(isNumericValue).length / nonEmpty.length
    : 0;
  const dataNumericRatios = restRows.map(row => {
    const ne = row.filter(v => v.trim() !== '');
    return ne.length > 0 ? ne.filter(isNumericValue).length / ne.length : 0;
  });
  const avgDataNumericRatio = dataNumericRatios.length > 0
    ? dataNumericRatios.reduce((a, b) => a + b, 0) / dataNumericRatios.length
    : 0;
  if (firstRowNumericRatio < avgDataNumericRatio - 0.2) score += 3;
  else if (firstRowNumericRatio > 0.5 && firstRowNumericRatio >= avgDataNumericRatio - 0.1) score -= 3;

  // 2. No duplicates in first row (headers should be unique)
  const uniqueVals = new Set(nonEmpty.map(v => v.toLowerCase()));
  if (uniqueVals.size === nonEmpty.length) score += 1;

  // 3. Identifier-like pattern (letters, underscores, %, hyphens)
  const identifierPattern = /^[a-zA-Z_][\w%.#\-\s()]*$/;
  const identifierCount = nonEmpty.filter(v => identifierPattern.test(v.trim())).length;
  if (nonEmpty.length > 0 && identifierCount / nonEmpty.length > 0.6) score += 2;

  // 4. Short strings (headers tend to be concise)
  const avgFirstLen = nonEmpty.reduce((s, v) => s + v.length, 0) / Math.max(nonEmpty.length, 1);
  const allDataCells = restRows.flat().filter(v => v.trim() !== '');
  const avgDataLen = allDataCells.reduce((s, v) => s + v.length, 0) / Math.max(allDataCells.length, 1);
  if (avgFirstLen < 20 && avgFirstLen <= avgDataLen) score += 1;

  // 5. File path or very long values penalty
  if (nonEmpty.some(v => v.length > 50 || /[/\\]/.test(v))) score -= 2;

  // Confidence mapping
  const absScore = Math.abs(score);
  let confidence: number;
  if (absScore >= 4) confidence = 0.95;
  else if (absScore >= 2) confidence = 0.7;
  else confidence = 0.4;

  return { hasHeaders: score > 0, confidence };
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
addAliases(['token_id', 'tokenid', 'sl_rowidx', 'row_idx', 'rowidx', 'segment_id', 'segmentid', 'obs_id', 'group_id', 'item_id'], 'token_id');
addAliases(['times_norm', 'time_norm', 'times_rel', 'time_rel', 'timepoint', 'time_point', 'norm_time', 'prop_time', 'measurement_time'], 'timepoint');

// Formant patterns (case-insensitive):
//   f1_50, f1_50%, f1_50ms, f1_50sec              → numeric timepoint (unit suffix ignored)
//   f1_50_smooth, f1_50%_smooth, f1_50ms_smooth   → numeric timepoint with named variant
//   f1, f2, f3                                      → bare (single measurement, timepoint=0)
//   f1_onset, f1_midpoint_smooth                    → named target
const FORMANT_NUMERIC_REGEX = /^(f[12345])_(\d+)(?:%|ms|sec)?(?:_(.+))?$/i;
const FORMANT_BARE_REGEX = /^(f[12345])$/i;
const FORMANT_NAMED_REGEX = /^(f[12345])_([a-z][a-z0-9]*)(?:_(.+))?$/i;
const PITCH_REGEX = /^f0_(\d+)(?:%|ms|sec)?(?:_(.+))?$/i;

/**
 * Cells that mean "no value here". Exporters disagree about how to write a measurement
 * that was not taken — an empty cell, NA, NaN, a lone dash — and a column measured only
 * for some segments (a release duration, say) is mostly these. Reading them as text would
 * make such a column look categorical and hide it from every numeric menu.
 */
const MISSING_VALUES = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '--', '.', '--undefined--']);

/** Whether a cell holds an actual value, as opposed to a marker for a missing one. */
export const hasValue = (raw: string): boolean => !MISSING_VALUES.has(raw.trim().toLowerCase());

/** Names that should populate SpeechToken.xmin (now detected as regular fields) */
const XMIN_NAMES = new Set(['xmin', 'onset', 'start', 'start_time']);

// --- Trajectory format detection ---

export interface TrajectoryFormatDetection {
  format: TrajectoryFormat;
  unit?: TrajectoryUnit;              // Only meaningful for 'time-slice'
  spacing: TrajectorySpacing;
  pointsPerFormant: number;           // Max count across formants (for ≥4 threshold)
  uniqueTimepoints: number[];         // Sorted distinct timepoints observed
}

const median = (arr: number[]): number => {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Extract 'ms' or 'sec' suffix from a formant column header, if present. */
export const detectUnitFromHeader = (header: string): TrajectoryUnit | undefined => {
  const m = header.toLowerCase().trim().match(/^f[12345]_\d+(%|ms|sec)(?:_.+)?$/i);
  if (!m) return undefined;
  const unit = m[1].toLowerCase();
  if (unit === 'ms') return 'ms';
  if (unit === 'sec') return 'sec';
  return undefined; // '%' is not a time unit
};

/**
 * Detect trajectory format from a set of timepoint values and optional unit hint.
 *
 * Rules:
 *   - Fewer than TRAJECTORY_MIN_POINTS distinct timepoints per formant → single-point
 *   - Max timepoint > 100                                              → time-slice
 *   - Otherwise                                                         → percentage
 *
 * Unit:
 *   - Explicit hint (from 'ms'/'sec' suffix in column names)            → use as-is
 *   - All integer-like values with max > 10                             → ms
 *   - Decimal values with max ≤ 10                                      → sec
 *   - Otherwise                                                          → undefined (ambiguous, user confirms)
 *
 * Spacing:
 *   - ≤ MAX_LISTED_VALUES distinct timepoints                           → 'listed' (enumerate)
 *   - All intervals within UNIFORM_TOLERANCE of median                  → 'uniform'
 *   - Otherwise                                                          → 'irregular'
 */
export const detectTrajectoryFormat = (
  timepointsByFormant: Map<string, number[]>,
  unitHint?: TrajectoryUnit,
): TrajectoryFormatDetection => {
  // Collect unique timepoints across all formants
  const allTP = new Set<number>();
  let pointsPerFormant = 0;
  for (const [, tps] of timepointsByFormant) {
    const distinct = new Set(tps);
    pointsPerFormant = Math.max(pointsPerFormant, distinct.size);
    for (const t of distinct) allTP.add(t);
  }
  const unique = Array.from(allTP).sort((a, b) => a - b);
  const count = unique.length;

  const max = count > 0 ? unique[count - 1] : 0;
  // max > 100 is always time-slice (absolute times matter even for few points).
  // Otherwise: need ≥4 points per formant to be called trajectory.
  let format: TrajectoryFormat;
  if (max > 100) {
    format = 'time-slice';
  } else if (pointsPerFormant < TRAJECTORY_MIN_POINTS) {
    format = 'single-point';
  } else {
    format = 'percentage';
  }

  if (format === 'single-point') {
    return {
      format,
      spacing: { kind: 'listed', values: unique },
      pointsPerFormant,
      uniqueTimepoints: unique,
    };
  }

  // Unit detection (time-slice only)
  let unit: TrajectoryUnit | undefined;
  if (format === 'time-slice') {
    if (unitHint) {
      unit = unitHint;
    } else {
      const allIntegerLike = unique.every(v => Math.abs(v - Math.round(v)) < 0.001);
      if (allIntegerLike && max > 10) unit = 'ms';
      else if (!allIntegerLike && max <= 10) unit = 'sec';
      // else: ambiguous — user must choose
    }
  }

  // Spacing description
  let spacing: TrajectorySpacing;
  if (count <= MAX_LISTED_VALUES) {
    spacing = { kind: 'listed', values: unique };
  } else {
    const intervals: number[] = [];
    for (let i = 1; i < unique.length; i++) intervals.push(unique[i] - unique[i - 1]);
    const med = median(intervals);
    const uniform = med > 0 && intervals.every(d => Math.abs(d - med) / med <= UNIFORM_TOLERANCE);
    spacing = uniform ? { kind: 'uniform', medianInterval: med } : { kind: 'irregular' };
  }

  return { format, unit, spacing, pointsPerFormant, uniqueTimepoints: unique };
};

/** Collect non-target numeric timepoints grouped by formant letter, for wide-format mappings. */
export const collectWideFormatTimepoints = (mappings: ColumnMapping[]): Map<string, number[]> => {
  const byFormant = new Map<string, number[]>();
  for (const m of mappings) {
    if (m.role !== 'formant') continue;
    if (m.formantTarget) continue;          // named targets excluded
    if (m.timePoint === undefined) continue;
    if (!m.formant) continue;
    const key = m.formant;
    if (!byFormant.has(key)) byFormant.set(key, []);
    byFormant.get(key)!.push(m.timePoint);
  }
  return byFormant;
};

/** Aggregate unit hints from wide-format column headers (first wins; conflicts → undefined). */
export const detectUnitHintFromMappings = (mappings: ColumnMapping[]): TrajectoryUnit | undefined => {
  const units = new Set<TrajectoryUnit>();
  for (const m of mappings) {
    if (m.role !== 'formant' || m.formantTarget) continue;
    const u = detectUnitFromHeader(m.csvHeader);
    if (u) units.add(u);
  }
  if (units.size === 1) return units.values().next().value;
  return undefined;
};

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

  /** A column of labels: filterable in the sidebar, never plotted as a measure. */
  const categoricalField = (header: string): ColumnMapping => ({
    csvHeader: header,
    role: 'field' as ColumnRole,
    fieldName: header,
    showInSidebar: true,
    isDataField: false,
  });

  /**
   * Whether a column's sampled values are numbers. Missing values are ignored rather than
   * counted against it: a column measured for only some segments is still numeric, and a
   * sample that happens to catch none of its values says nothing either way.
   */
  const isMostlyNumeric = (header: string): boolean => {
    const colIdx = headers.indexOf(header);
    const values = sampleRows.map(row => row[colIdx] || '').filter(hasValue);
    if (values.length === 0) return true;
    return values.filter(v => !isNaN(parseFloat(v))).length / values.length > 0.8;
  };

  // Pass 2: build mappings
  const result: ColumnMapping[] = headers.map(header => {
    const lower = header.toLowerCase().trim();

    // 1. Check alias table for special roles
    if (ALIAS_TABLE[lower]) {
      const role = ALIAS_TABLE[lower];
      const isData = role === 'duration' || role === 'pitch';
      // A measure role only fits a column of numbers: `voice_pitch` holding high/low is a
      // label, whatever its name suggests.
      if (isData && !isMostlyNumeric(header)) return categoricalField(header);
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
      if (!isMostlyNumeric(header)) return categoricalField(header);
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

    // 2c-bis. Spectral-measure columns (COG/SD/skew/kurt/bandratio and synonyms) → dedicated
    // spectral role feeding the Spectral Moments tab. The name may carry a region
    // label and a position: COG_20%, COG_closure_20%, SD_release_t3, kurt_k1.
    // A region-labelled name is only accepted when the column really holds numbers,
    // so a categorical column such as `skew_notes` is not swept up as a measurement.
    const spectralRole = detectSpectralRole(header);
    if (spectralRole) {
      const region = spectralColumnRegion(header);
      if (!region || isMostlyNumeric(header)) {
        return {
          csvHeader: header,
          role: spectralRole,
          fieldName: header,
          spectralRegion: region || undefined,
          showInSidebar: false,
          isDataField: true,
        };
      }
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
    const values = sampleRows.map(row => row[colIdx] || '').filter(hasValue);
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

    // A column of numbers is kept whatever its cardinality: it is a measure, hidden from
    // the sidebar until asked for, and filtered there by range rather than by value. Only
    // free text with too many distinct values to pick from is dropped.
    if (isMostlyNumeric(header)) {
      return {
        csvHeader: header,
        role: 'field' as ColumnRole,
        fieldName: header,
        showInSidebar: false,
        isDataField: true,
      };
    }

    if (unique.size <= 50) {
      return {
        csvHeader: header,
        role: 'field' as ColumnRole,
        fieldName: header,
        showInSidebar: true,
        isDataField: false,
      };
    }

    return { csvHeader: header, role: 'ignore' as ColumnRole };
  });

  // Post-pass: long-format heuristics
  const hasBareFormants = result.some(m => m.role === 'formant' && m.timePoint === 0);
  const timepointIndices = result.reduce<number[]>((acc, m, i) => { if (m.role === 'timepoint') acc.push(i); return acc; }, []);
  const hasTimepoint = timepointIndices.length > 0;
  const hasTokenId = result.some(m => m.role === 'token_id');

  // If token_id detected but no timepoint and no bare formants, it's a false positive
  // (e.g. sl_rowIdx in a wide-format file) — reclassify as field
  if (hasTokenId && !hasTimepoint && !hasBareFormants) {
    for (let ci = 0; ci < result.length; ci++) {
      if (result[ci].role === 'token_id') {
        result[ci] = { csvHeader: result[ci].csvHeader, role: 'field', fieldName: result[ci].csvHeader, showInSidebar: false, isDataField: false };
      }
    }
  }

  // If multiple timepoint columns detected, keep only the best one (prefer raw ms — most informative)
  if (timepointIndices.length > 1) {
    // Score each: prefer raw ms (gives us both normalized trajectories AND duration)
    let bestIdx = timepointIndices[0];
    let bestScore = -1;
    for (const ci of timepointIndices) {
      const vals = sampleRows.map(row => parseFloat(row[ci] || '')).filter(v => !isNaN(v));
      const max = Math.max(...vals);
      // Prefer raw ms (score 2), then 0-100 percent (score 1), then 0-1 fraction (score 0)
      const score = max > 100 ? 2 : max > 1.0 ? 1 : 0;
      if (score > bestScore) { bestScore = score; bestIdx = ci; }
    }
    for (const ci of timepointIndices) {
      if (ci !== bestIdx) {
        result[ci] = { csvHeader: result[ci].csvHeader, role: 'ignore' as ColumnRole };
      }
    }
  }

  // If bare formants + timepoint detected but no token_id, try to find a grouper
  if (hasBareFormants && hasTimepoint && !hasTokenId) {
    const totalRows = sampleRows.length;
    for (let ci = 0; ci < result.length; ci++) {
      const m = result[ci];
      if (m.role !== 'field' && m.role !== 'ignore') continue;
      const vals = sampleRows.map(row => row[ci] || '').filter(v => v !== '');
      if (vals.length === 0) continue;
      const allInteger = vals.every(v => /^\d+$/.test(v.trim()));
      if (!allInteger) continue;
      const unique = new Set(vals);
      // High repetition: unique count < 50% of rows (multiple rows per group)
      if (unique.size < totalRows * 0.5 && unique.size >= 1) {
        result[ci] = { csvHeader: m.csvHeader, role: 'token_id', showInSidebar: false, isDataField: false };
        break;
      }
    }
  }

  return result;
};

/**
 * Parse long-format CSV where multiple rows belong to one token.
 * Groups rows by token_id column, reads timepoint + formant values per row,
 * normalizes timepoints to 0–100%, and emits one SpeechToken per group.
 */
function parseLongFormat(
  lines: string[],
  delimiter: string,
  dataStartLine: number,
  headerIdxMap: Record<string, number>,
  mappings: ColumnMapping[],
  tokenIdMapping: ColumnMapping,
  timepointMapping: ColumnMapping,
  speakerIdx: number | undefined,
  fileIdIdx: number | undefined,
  durationIdx: number | undefined,
  formantMappings: { colIdx: number, formant: 'f1' | 'f2' | 'f3' | 'f4' | 'f5', timePoint: number, isSmooth: boolean }[],
  fieldMappings: { colIdx: number, fieldName: string }[],
  fileName: string,
): { tokens: SpeechToken[], meta: DatasetMeta } {
  const tokenIdIdx = headerIdxMap[tokenIdMapping.csvHeader];
  const timepointIdx = headerIdxMap[timepointMapping.csvHeader];
  if (tokenIdIdx === undefined || timepointIdx === undefined) {
    return { tokens: [], meta: { fileName, columnMappings: mappings, timePoints: [], rowCount: 0, sourceFormat: 'long' } };
  }

  // Group rows by token_id
  const groups = new Map<string, string[][]>();
  const groupOrder: string[] = [];
  for (let i = dataStartLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = splitRow(line, delimiter);
    if (row.length === 0) continue;
    const tid = (row[tokenIdIdx] || '').trim();
    if (!tid) continue;
    if (!groups.has(tid)) {
      groups.set(tid, []);
      groupOrder.push(tid);
    }
    groups.get(tid)!.push(row);
  }

  // Detect timepoint scale from all timepoint values
  let maxTP = -Infinity;
  let minTP = Infinity;
  for (const rows of groups.values()) {
    for (const row of rows) {
      const v = parseFloat(row[timepointIdx]);
      if (!isNaN(v)) {
        if (v > maxTP) maxTP = v;
        if (v < minTP) minTP = v;
      }
    }
  }
  // fraction (0–1) | percent (1–100) | ms (>100)
  const scale: 'fraction' | 'percent' | 'ms' = maxTP <= 1.0 ? 'fraction' : maxTP <= 100 ? 'percent' : 'ms';

  const xminFieldMapping = fieldMappings.find(fm => XMIN_NAMES.has(fm.fieldName.toLowerCase()));
  const tokens: SpeechToken[] = [];

  for (const tid of groupOrder) {
    const rows = groups.get(tid)!;

    // Sort rows by timepoint value
    rows.sort((a, b) => parseFloat(a[timepointIdx]) - parseFloat(b[timepointIdx]));

    // Metadata from first row
    const firstRow = rows[0];
    const speaker = speakerIdx !== undefined ? (firstRow[speakerIdx] || '') : '';
    const fileId = fileIdIdx !== undefined ? (firstRow[fileIdIdx] || '') : '';

    // Build fields from first row (metadata columns repeat across rows)
    const fields: Record<string, string> = {};
    fieldMappings.forEach(fm => {
      fields[fm.fieldName] = firstRow[fm.colIdx] || '';
    });

    // Per-group time range (always computed — used for ms normalization AND trajectoryDurationMs)
    let groupMinT = Infinity, groupMaxT = -Infinity;
    for (const row of rows) {
      const v = parseFloat(row[timepointIdx]);
      if (!isNaN(v)) {
        if (v < groupMinT) groupMinT = v;
        if (v > groupMaxT) groupMaxT = v;
      }
    }

    // Build trajectory from all rows in the group
    const trajectory: TrajectoryPoint[] = [];
    for (const row of rows) {
      const rawTime = parseFloat(row[timepointIdx]);
      if (isNaN(rawTime)) continue;

      // Normalize time to 0–100%
      let time: number;
      if (scale === 'fraction') {
        time = rawTime * 100;
      } else if (scale === 'percent') {
        time = rawTime;
      } else {
        const span = groupMaxT - groupMinT;
        time = span > 0 ? ((rawTime - groupMinT) / span) * 100 : 0;
      }

      // Read formant values from this row (bare formants: all have timePoint=0)
      let f1 = NaN, f2 = NaN, f3 = NaN;
      let f1s = NaN, f2s = NaN, f3s = NaN;
      for (const fm of formantMappings) {
        const val = parseFloat(row[fm.colIdx]);
        if (isNaN(val)) continue;
        if (fm.isSmooth) {
          if (fm.formant === 'f1') f1s = val;
          else if (fm.formant === 'f2') f2s = val;
          else if (fm.formant === 'f3') f3s = val;
        } else {
          if (fm.formant === 'f1') f1 = val;
          else if (fm.formant === 'f2') f2 = val;
          else if (fm.formant === 'f3') f3 = val;
        }
      }

      const effF1S = !isNaN(f1s) ? f1s : f1;
      const effF2S = !isNaN(f2s) ? f2s : f2;
      const effF3S = !isNaN(f3s) ? f3s : f3;
      const hasRaw = !isNaN(f1) && !isNaN(f2);
      const hasSmooth = !isNaN(effF1S) && !isNaN(effF2S);

      if (hasRaw || hasSmooth) {
        trajectory.push({
          time,
          f1, f2, f3: isNaN(f3) ? 0 : f3,
          f1_smooth: effF1S, f2_smooth: effF2S,
          f3_smooth: isNaN(effF3S) ? (isNaN(f3) ? 0 : f3) : effF3S,
        });
      }
    }

    if (trajectory.length === 0) continue;

    // Duration: prefer explicit column, otherwise compute from raw time range
    let duration = 0;
    if (durationIdx !== undefined) {
      duration = parseFloat(firstRow[durationIdx]) || 0;
    } else if (scale === 'ms') {
      duration = groupMaxT - groupMinT;
    }

    // Native extraction range for time-slice absolute plotting (in ms)
    let trajectoryDurationMs: number | undefined;
    if (scale === 'ms' && groupMaxT > groupMinT) {
      trajectoryDurationMs = groupMaxT - groupMinT;
    }

    tokens.push({
      id: speaker ? `${speaker}_token_${tid}` : (fileId ? `${fileId}_token_${tid}` : `token_${tid}`),
      speaker,
      file_id: fileId,
      xmin: xminFieldMapping ? (parseFloat(firstRow[xminFieldMapping.colIdx]) || 0) : 0,
      duration,
      trajectory,
      trajectoryDurationMs,
      fields,
    });
  }

  // Compute formant variants
  const formantLabelSet = new Set<string | undefined>();
  mappings.forEach(m => {
    if (m.role === 'formant') formantLabelSet.add(m.formantLabel);
  });
  let formantVariants: string[] | undefined;
  if (formantLabelSet.size >= 2) {
    const labels = Array.from(formantLabelSet);
    const hasRaw = labels.includes(undefined);
    const namedLabels = labels.filter((l): l is string => l !== undefined).sort();
    formantVariants = hasRaw ? ['Original', ...namedLabels] : namedLabels;
  }

  // Derive format/unit/spacing from detected scale + observed timepoints
  const uniqueTimepoints: number[] = [];
  {
    const tpSet = new Set<number>();
    for (const rows of groups.values()) for (const row of rows) {
      const v = parseFloat(row[timepointIdx]);
      if (!isNaN(v)) tpSet.add(v);
    }
    uniqueTimepoints.push(...Array.from(tpSet).sort((a, b) => a - b));
  }
  const maxPointsPerToken = Math.max(...Array.from(groups.values()).map(r => r.length), 0);
  const longFormat: TrajectoryFormat = scale === 'ms' ? 'time-slice' : 'percentage';
  const longUnit: TrajectoryUnit | undefined = scale === 'ms' ? 'ms' : undefined;
  const longSpacing: TrajectorySpacing = uniqueTimepoints.length <= MAX_LISTED_VALUES
    ? { kind: 'listed', values: uniqueTimepoints }
    : (() => {
        const intervals: number[] = [];
        for (let i = 1; i < uniqueTimepoints.length; i++) intervals.push(uniqueTimepoints[i] - uniqueTimepoints[i - 1]);
        const med = median(intervals);
        const uniform = med > 0 && intervals.every(d => Math.abs(d - med) / med <= UNIFORM_TOLERANCE);
        return uniform ? { kind: 'uniform', medianInterval: med } : { kind: 'irregular' };
      })();

  // Common time grid for UI (21 points: 0, 5, 10, ..., 100)
  const commonGrid: number[] = [];
  for (let t = 0; t <= 100; t += 5) commonGrid.push(t);

  return {
    tokens,
    meta: {
      fileName,
      columnMappings: measureNumericColumns(tokens, mappings),
      timePoints: commonGrid,
      rowCount: tokens.length,
      formantVariants,
      sourceFormat: 'long',
      trajectoryFormat: maxPointsPerToken < TRAJECTORY_MIN_POINTS ? 'single-point' : longFormat,
      trajectoryUnit: longUnit,
      trajectorySpacing: longSpacing,
    },
  };
}

/**
 * Parse file text using user-confirmed column mappings.
 * Produces SpeechToken[] with generic `fields` for all 'field' role columns.
 */
export interface TrajectoryFormatOverride {
  format: TrajectoryFormat;
  unit?: TrajectoryUnit;
}

export const parseWithMappings = (
  text: string,
  mappings: ColumnMapping[],
  fileName: string = '',
  firstRowIsData: boolean = false,
  formatOverride?: TrajectoryFormatOverride,
): { tokens: SpeechToken[], meta: DatasetMeta } => {
  const delimiter = detectDelimiter(text);
  const lines = splitRows(text);
  const minLines = firstRowIsData ? 1 : 2;
  if (lines.length < minLines) return { tokens: [], meta: { fileName, columnMappings: mappings, timePoints: [], rowCount: 0 } };

  // When first row is data, use synthetic headers from mapping csvHeader values
  const headers = firstRowIsData
    ? mappings.map(m => m.csvHeader)
    : splitRow(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

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
      case 'spectral_cog':
      case 'spectral_sd':
      case 'spectral_skew':
      case 'spectral_kurt':
      case 'spectral_bandratio':
        if (m.fieldName || m.csvHeader) {
          fieldMappings.push({ colIdx, fieldName: m.fieldName || m.csvHeader });
        }
        break;
      // 'ignore' — skip
    }
  });

  const dataStartLine = firstRowIsData ? 0 : 1;

  // Detect long-format mode: token_id + timepoint roles both present
  const tokenIdMapping = mappings.find(m => m.role === 'token_id');
  const timepointMapping = mappings.find(m => m.role === 'timepoint');
  if (tokenIdMapping && timepointMapping) {
    return parseLongFormat(lines, delimiter, dataStartLine, headerIdxMap, mappings, tokenIdMapping, timepointMapping, speakerIdx, fileIdIdx, durationIdx, formantMappings, fieldMappings, fileName);
  }

  // Find xmin-like field for SpeechToken.xmin population
  const xminFieldMapping = fieldMappings.find(fm => XMIN_NAMES.has(fm.fieldName.toLowerCase()));

  // Collect unique time points from formant mappings
  const timePointSet = new Set<number>();
  formantMappings.forEach(fm => timePointSet.add(fm.timePoint));
  const sortedTimePoints = Array.from(timePointSet).sort((a, b) => a - b);

  const tokens: SpeechToken[] = [];
  for (let i = dataStartLine; i < lines.length; i++) {
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

  // Detect trajectory format (auto) or use override from the Data Mapping dialog.
  const timepointsByFormant = collectWideFormatTimepoints(mappings);
  const unitHint = formatOverride?.unit ?? detectUnitHintFromMappings(mappings);
  const detection = detectTrajectoryFormat(timepointsByFormant, unitHint);
  const format: TrajectoryFormat = formatOverride?.format ?? detection.format;
  const unit: TrajectoryUnit | undefined = formatOverride?.unit ?? detection.unit;

  // For 'time-slice' format, normalize each token's trajectory to 0–100% based on
  // position AND capture the native extraction range (for absolute time-series plots).
  // For 'percentage' and 'single-point', trajectory times are kept as column values.
  if (format === 'time-slice') {
    for (const token of tokens) {
      const n = token.trajectory.length;
      if (n < 2) continue;
      const nativeMin = token.trajectory[0].time;
      const nativeMax = token.trajectory[n - 1].time;
      const nativeRange = nativeMax - nativeMin;
      if (unit === 'ms') {
        token.trajectoryDurationMs = nativeRange;
      } else if (unit === 'sec') {
        token.trajectoryDurationMs = nativeRange * 1000;
      }
      for (let j = 0; j < n; j++) {
        token.trajectory[j].time = (j / (n - 1)) * 100;
      }
    }
    // Replace column-derived timepoints with the common 0–100% grid for UI
    sortedTimePoints.length = 0;
    for (let t = 0; t <= 100; t += 5) sortedTimePoints.push(t);
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
    columnMappings: measureNumericColumns(tokens, mappings),
    timePoints: sortedTimePoints,
    timePointLabels,
    rowCount: tokens.length,
    formantVariants,
    trajectoryFormat: format,
    trajectoryUnit: format === 'time-slice' ? unit : undefined,
    trajectorySpacing: detection.spacing,
  };

  return { tokens, meta };
};
