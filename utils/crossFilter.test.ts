import { describe, it, expect } from 'vitest';
import { FilterState, SpeechToken, UNDEFINED_LABEL } from '../types';
import { crossFilterOptions } from './crossFilter';

const tok = (fields: Record<string, string>): SpeechToken =>
  ({ speaker: 's1', file_id: 'f1', trajectory: [], fields } as unknown as SpeechToken);

/** Three places × two manners, plus a duration to bound. */
const data = [
  tok({ place: 'alveolar', manner: 'plosive', dur: '20' }),
  tok({ place: 'alveolar', manner: 'fricative', dur: '80' }),
  tok({ place: 'velar', manner: 'plosive', dur: '30' }),
  tok({ place: 'bilabial', manner: 'nasal', dur: '90' }),
];
const KEYS = ['place', 'manner'];
const state = (over: Partial<FilterState> = {}): FilterState => ({
  filters: { place: ['alveolar', 'velar', 'bilabial'], manner: ['plosive', 'fricative', 'nasal'] },
  ...over,
});

describe('crossFilterOptions', () => {
  it('offers every value when nothing is narrowed', () => {
    const opts = crossFilterOptions(data, KEYS, state());
    expect(opts.place).toEqual(['alveolar', 'bilabial', 'velar']);
    expect(opts.manner).toEqual(['fricative', 'nasal', 'plosive']);
  });

  it('narrows the other fields when one is narrowed', () => {
    const opts = crossFilterOptions(data, KEYS, state({
      filters: { place: ['alveolar'], manner: ['plosive', 'fricative', 'nasal'] },
    }));
    expect(opts.manner).toEqual(['fricative', 'plosive']);
  });

  it('keeps a field offering everything it could still show — a selection is not a one-way door', () => {
    // Having narrowed place to alveolar, place must still list velar and bilabial, or
    // there would be no way back to them.
    const opts = crossFilterOptions(data, KEYS, state({
      filters: { place: ['alveolar'], manner: ['plosive', 'fricative', 'nasal'] },
    }));
    expect(opts.place).toEqual(['alveolar', 'bilabial', 'velar']);
  });

  it('applies two narrowings to a third field', () => {
    const opts = crossFilterOptions(
      [...data, tok({ place: 'velar', manner: 'fricative', dur: '40' })],
      ['place', 'manner', 'dur'],
      { filters: { place: ['velar'], manner: ['fricative'], dur: ['20', '30', '40', '80', '90'] } },
    );
    expect(opts.dur).toEqual(['40']);
  });

  it('empties the other lists when a field selects nothing, but keeps its own', () => {
    const opts = crossFilterOptions(data, KEYS, {
      filters: { place: [], manner: ['plosive', 'fricative', 'nasal'] },
    });
    expect(opts.manner).toEqual([]);
    expect(opts.place).toEqual(['alveolar', 'bilabial', 'velar']);
  });

  it('narrows every list by an active bound', () => {
    const opts = crossFilterOptions(data, KEYS, state({ ranges: { dur: { min: 50 } } }));
    expect(opts.place).toEqual(['alveolar', 'bilabial']);
    expect(opts.manner).toEqual(['fricative', 'nasal']);
  });

  it('ignores a bound that constrains nothing', () => {
    const opts = crossFilterOptions(data, KEYS, state({ ranges: { dur: {} } }));
    expect(opts.place).toEqual(['alveolar', 'bilabial', 'velar']);
  });

  it('is unaffected by a filter on a field it is not listing', () => {
    // A hidden field still filters; its own values simply have nowhere to be shown.
    const opts = crossFilterOptions(data, ['manner'], {
      filters: { place: ['alveolar'], manner: ['plosive', 'fricative', 'nasal'] },
    });
    expect(opts.manner).toEqual(['fricative', 'plosive']);
  });

  it('names missing values and sorts them last', () => {
    const withGap = [...data, tok({ place: '', manner: 'plosive', dur: '10' })];
    const opts = crossFilterOptions(withGap, KEYS, {
      filters: { manner: ['plosive', 'fricative', 'nasal'] },
    });
    expect(opts.place).toEqual(['alveolar', 'bilabial', 'velar', UNDEFINED_LABEL]);
  });

  it('matches the field-by-field reading it replaced', () => {
    // The straightforward implementation: for each field, filter the data by every other
    // field's selection, then collect what is left. Same answer, far more work.
    const filters = { place: ['alveolar', 'velar'], manner: ['plosive'] };
    const naive: Record<string, string[]> = {};
    for (const key of KEYS) {
      const subset = data.filter(t => Object.entries(filters).every(([k, vals]) =>
        k === key || vals.includes(t.fields[k] || UNDEFINED_LABEL)));
      naive[key] = [...new Set(subset.map(t => t.fields[key] || UNDEFINED_LABEL))].sort();
    }
    expect(crossFilterOptions(data, KEYS, { filters })).toEqual(naive);
  });

  it('is empty for a field with no tokens at all', () => {
    expect(crossFilterOptions([], KEYS, state())).toEqual({ place: [], manner: [] });
  });
});
