
import { SpeechToken } from '../types';

export const getLabel = (t: SpeechToken, key: string): string => {
  if (!key || key === 'none') return '';
  if (key === 'speaker') return t.speaker;
  if (key === 'file_id') return t.file_id;
  if (key === 'duration') return t.duration != null ? String(t.duration) : '';
  return t.fields[key] ?? '';
};
