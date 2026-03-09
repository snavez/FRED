import { describe, it, expect } from 'vitest';
import { getLabel } from './getLabel';
import { SpeechToken } from '../types';

const makeToken = (overrides: Partial<SpeechToken> = {}): SpeechToken => ({
  id: 'test_1',
  speaker: 'spk01',
  file_id: 'file_001',
  xmin: 0.5,
  duration: 0.12,
  trajectory: [],
  fields: {
    phoneme: 'ɛ',
    word: 'hello',
    produced: 'e',
    alignment: 'correct',
    type: 'vowel',
    voice_pitch: 'high',
  },
  ...overrides,
});

describe('getLabel', () => {
  it('returns empty string for key "none"', () => {
    expect(getLabel(makeToken(), 'none')).toBe('');
  });

  it('returns empty string for empty key', () => {
    expect(getLabel(makeToken(), '')).toBe('');
  });

  it('returns speaker for key "speaker"', () => {
    expect(getLabel(makeToken({ speaker: 'spk02' }), 'speaker')).toBe('spk02');
  });

  it('returns file_id for key "file_id"', () => {
    expect(getLabel(makeToken({ file_id: 'file_xyz' }), 'file_id')).toBe('file_xyz');
  });

  it('returns fields values for generic field keys', () => {
    const t = makeToken({ fields: { phoneme: 'aɪ', word: 'cat', alignment: 'substitution', dialect: 'northern' } });
    expect(getLabel(t, 'phoneme')).toBe('aɪ');
    expect(getLabel(t, 'word')).toBe('cat');
    expect(getLabel(t, 'alignment')).toBe('substitution');
    expect(getLabel(t, 'dialect')).toBe('northern');
  });

  it('returns empty string when field does not exist', () => {
    expect(getLabel(makeToken(), 'nonexistent_field')).toBe('');
  });
});
