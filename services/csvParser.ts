
import { SpeechToken, TrajectoryPoint } from '../types';

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
