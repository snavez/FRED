import { describe, it, expect } from 'vitest';
import { sidecarNamesFor, isSidecarFor, parseProvenanceSidecar } from './provenance';

/** A trimmed FormantStudio sidecar, in the shape the exporter writes it. */
const sidecarJson = JSON.stringify({
  tool: 'FormantStudio',
  spectral: {
    markers_pct: [20, 50, 80],
    analysis_band_hz: [0, 11025],
    band_ratio_low_hz: [400, 900],
    band_ratio_high_hz: [5500, 7500],
    band_ratio_units: 'dB, 10*log10(P_high / P_low)',
  },
});

describe('sidecarNamesFor', () => {
  it('prefers the exporter\'s own name, then the plain one', () => {
    expect(sidecarNamesFor('acoustic_data.csv')).toEqual([
      'acoustic_data.provenance.json', 'acoustic_data.json',
    ]);
  });

  it('recognises a sidecar regardless of case, and rejects a stranger', () => {
    expect(isSidecarFor('data.csv', 'DATA.Provenance.JSON')).toBe(true);
    expect(isSidecarFor('data.csv', 'data.json')).toBe(true);
    expect(isSidecarFor('data.csv', 'other.provenance.json')).toBe(false);
    expect(isSidecarFor('data.csv', 'data.csv')).toBe(false);
  });
});

describe('parseProvenanceSidecar', () => {
  it('reads the band-ratio bands and shortens the unit to what an axis wants', () => {
    const prov = parseProvenanceSidecar(sidecarJson, 'acoustic_data.provenance.json')!;
    expect(prov.sourceFile).toBe('acoustic_data.provenance.json');
    expect(prov.bandRatio).toEqual({ low: [400, 900], high: [5500, 7500], units: 'dB' });
  });

  it('defaults the unit when the exporter did not name one', () => {
    const text = JSON.stringify({ spectral: { band_ratio_low_hz: [0, 1000], band_ratio_high_hz: [4000, 8000] } });
    expect(parseProvenanceSidecar(text, 's.json')!.bandRatio!.units).toBe('dB');
  });

  it('reports nothing rather than guessing, for a sidecar it cannot use', () => {
    expect(parseProvenanceSidecar('not json at all', 's.json')).toBeNull();
    expect(parseProvenanceSidecar('[1,2,3]', 's.json')).toBeNull();
    expect(parseProvenanceSidecar('{}', 's.json')).toBeNull();
    // An older export with no band ratio in it
    expect(parseProvenanceSidecar(JSON.stringify({ spectral: { markers_pct: [50] } }), 's.json')).toBeNull();
  });

  it('rejects band edges that are not a usable pair', () => {
    const bad = (low: unknown, high: unknown) =>
      parseProvenanceSidecar(JSON.stringify({ spectral: { band_ratio_low_hz: low, band_ratio_high_hz: high } }), 's.json');
    expect(bad([400], [5500, 7500])).toBeNull();           // incomplete
    expect(bad([900, 400], [5500, 7500])).toBeNull();       // descending
    expect(bad([-1, 900], [5500, 7500])).toBeNull();        // negative frequency
    expect(bad('400-900', [5500, 7500])).toBeNull();        // not a pair at all
    expect(bad([400, 900], [7500, 7500])).toBeNull();       // zero-width band
  });
});
