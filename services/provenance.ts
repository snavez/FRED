import { BandRatioBands, DatasetProvenance } from '../types';

/**
 * The JSON provenance sidecar an exporter writes beside a CSV.
 *
 * The CSV alone does not say how its numbers were measured, and for some columns that
 * is not a detail. Two exports can carry identically-named `bandratio_*` columns taken
 * over different frequency bands: the values are not comparable, nothing in the header
 * says so, and plotted together they look like one variable. So FRED reads the sidecar
 * when it can get one, and puts what it finds into the labels.
 *
 * Everything here is defensive. A sidecar is optional, may come from an older exporter,
 * and is user-supplied JSON: a missing, partial or malformed file must leave FRED
 * exactly as it would be with no sidecar at all, never guessing a value it did not read.
 */

/** Sidecar names FormantStudio writes, in the order they are preferred. */
export const sidecarNamesFor = (csvFileName: string): string[] => {
  const stem = csvFileName.replace(/\.[^./\\]+$/, '');
  return [`${stem}.provenance.json`, `${stem}.json`];
};

/** Whether a file is the sidecar belonging to a given CSV. */
export const isSidecarFor = (csvFileName: string, candidateName: string): boolean =>
  sidecarNamesFor(csvFileName).some(n => n.toLowerCase() === candidateName.toLowerCase());

/** A `[low, high]` pair of finite, ascending, non-negative frequencies, or null. */
const readBand = (raw: unknown): [number, number] | null => {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [lo, hi] = [Number(raw[0]), Number(raw[1])];
  if (!isFinite(lo) || !isFinite(hi) || lo < 0 || hi <= lo) return null;
  return [lo, hi];
};

/** The band-ratio bands a sidecar's `spectral` block describes, or null when it has none. */
const readBandRatio = (spectral: Record<string, unknown> | undefined): BandRatioBands | null => {
  if (!spectral) return null;
  const low = readBand(spectral.band_ratio_low_hz);
  const high = readBand(spectral.band_ratio_high_hz);
  if (!low || !high) return null;
  // The exporter writes a sentence ('dB, 10*log10(P_high / P_low)'); an axis wants the
  // unit alone, and 'dB' is the only unit a power ratio is reported in.
  const units = typeof spectral.band_ratio_units === 'string' && spectral.band_ratio_units.trim()
    ? spectral.band_ratio_units.split(',')[0].trim()
    : 'dB';
  return { low, high, units };
};

/**
 * Read a sidecar's text into the provenance FRED uses. Returns null for anything it
 * cannot make sense of — unparseable JSON, or a file carrying nothing FRED reads —
 * so a bad sidecar is simply no sidecar.
 */
export const parseProvenanceSidecar = (text: string, sourceFile: string): DatasetProvenance | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const spectral = (parsed as Record<string, unknown>).spectral;
  const bandRatio = readBandRatio(
    spectral && typeof spectral === 'object' && !Array.isArray(spectral)
      ? spectral as Record<string, unknown>
      : undefined,
  );
  if (!bandRatio) return null;
  return { sourceFile, bandRatio };
};
