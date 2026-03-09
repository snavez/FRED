
import { SpeechToken } from '../types';

export const getLabel = (t: SpeechToken, key: string): string => {
  if (!key || key === 'none') return '';
  if (key === 'speaker') return t.speaker;
  if (key === 'file_id') return t.file_id;
  return t.fields[key] ?? '';
};
