
import { SpeechToken } from '../types';

export const getLabel = (t: SpeechToken, key: string): string => {
  if (!key || key === 'none') return '';
  if (key === 'phoneme') return t.canonical;
  if (key === 'syllable_mark') {
    const val = parseInt(t.syllable_mark, 10);
    if (isNaN(val)) return t.syllable_mark;
    return val > 0 ? 'accepted' : 'rejected';
  }
  const builtIn = (t as any)[key];
  if (builtIn !== undefined && builtIn !== null) return String(builtIn);
  if (t.customFields?.[key] !== undefined) return String(t.customFields[key]);
  return '';
};
