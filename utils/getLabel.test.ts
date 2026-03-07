import { describe, it, expect } from 'vitest';
import { getLabel } from './getLabel';
import { SpeechToken } from '../types';

const makeToken = (overrides: Partial<SpeechToken> = {}): SpeechToken => ({
  id: 'test_1',
  file_id: 'spk01',
  word: 'hello',
  syllable: 'hel',
  syllable_mark: '1',
  canonical_stress: 'primary',
  lexical_stress: 'stressed',
  canonical: 'ɛ',
  produced: 'e',
  alignment: 'correct',
  type: 'vowel',
  canonical_type: 'monophthong',
  voice_pitch: 'high',
  xmin: 0.5,
  duration: 0.12,
  trajectory: [],
  ...overrides,
});

describe('getLabel', () => {
  it('returns empty string for key "none"', () => {
    expect(getLabel(makeToken(), 'none')).toBe('');
  });

  it('returns empty string for empty key', () => {
    expect(getLabel(makeToken(), '')).toBe('');
  });

  it('returns canonical for key "phoneme"', () => {
    expect(getLabel(makeToken({ canonical: 'aɪ' }), 'phoneme')).toBe('aɪ');
  });

  describe('syllable_mark logic', () => {
    it('returns "accepted" for positive numeric syllable_mark', () => {
      expect(getLabel(makeToken({ syllable_mark: '3' }), 'syllable_mark')).toBe('accepted');
    });

    it('returns "rejected" for zero syllable_mark', () => {
      expect(getLabel(makeToken({ syllable_mark: '0' }), 'syllable_mark')).toBe('rejected');
    });

    it('returns "rejected" for negative syllable_mark', () => {
      expect(getLabel(makeToken({ syllable_mark: '-2' }), 'syllable_mark')).toBe('rejected');
    });

    it('returns raw string for non-numeric syllable_mark', () => {
      expect(getLabel(makeToken({ syllable_mark: 'maybe' }), 'syllable_mark')).toBe('maybe');
    });
  });

  it('returns built-in SpeechToken fields', () => {
    const t = makeToken({ word: 'cat', alignment: 'substitution' });
    expect(getLabel(t, 'word')).toBe('cat');
    expect(getLabel(t, 'alignment')).toBe('substitution');
    expect(getLabel(t, 'file_id')).toBe('spk01');
  });

  it('falls back to customFields when built-in field is missing', () => {
    const t = makeToken({ customFields: { dialect: 'northern', age_group: 'young' } });
    expect(getLabel(t, 'dialect')).toBe('northern');
    expect(getLabel(t, 'age_group')).toBe('young');
  });

  it('returns empty string when neither built-in nor custom matches', () => {
    expect(getLabel(makeToken(), 'nonexistent_field')).toBe('');
  });
});
