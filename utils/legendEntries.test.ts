import { describe, it, expect } from 'vitest';
import { ExportConfig, Layer } from '../types';
import { buildLegendEntries, legendWidth, LegendLayer } from './legendEntries';

const layer = (id: string, name: string): Layer => ({ id, name } as Layer);

const colourEnc = {
  colorKey: 'MAU',
  colorMap: { t: '#ef4444', k: '#3b82f6' },
  colorCounts: { t: 12, k: 7 },
};

const one: LegendLayer[] = [{ layer: layer('bg', 'Background'), enc: colourEnc }];

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({ ...over } as ExportConfig);

describe('buildLegendEntries', () => {
  it('heads each variable once and leaves the values unprefixed', () => {
    expect(buildLegendEntries(one, cfg())).toEqual([
      { kind: 'heading', label: 'MAU' },
      { kind: 'item', label: 'k (n=7)', color: '#3b82f6' },
      { kind: 'item', label: 't (n=12)', color: '#ef4444' },
    ]);
  });

  it('never repeats the variable name on a value — the reported "MAU: t"', () => {
    const labels = buildLegendEntries(one, cfg()).filter(e => e.kind === 'item').map(e => e.label);
    expect(labels.every(l => !l.includes('MAU'))).toBe(true);
  });

  it('carries the count with every value', () => {
    const items = buildLegendEntries(one, cfg()).filter(e => e.kind === 'item');
    expect(items.map(e => e.label)).toEqual(['k (n=7)', 't (n=12)']);
  });

  it('uses the title the user typed in the export overlay', () => {
    const withTitle = cfg({
      layerLegends: [{ layerId: 'bg', show: true, colorTitle: 'Consonant', shapeTitle: '', lineTypeTitle: '', textureTitle: '' }],
    });
    expect(buildLegendEntries(one, withTitle)[0]).toEqual({ kind: 'heading', label: 'Consonant' });
  });

  it('falls back to the shared title, then to the field name', () => {
    expect(buildLegendEntries(one, cfg({ colorLegendTitle: 'Segment' }))[0].label).toBe('Segment');
    expect(buildLegendEntries(one, cfg())[0].label).toBe('MAU');
  });

  it('names the layer once, not on every row', () => {
    const two: LegendLayer[] = [
      { layer: layer('bg', 'Background'), enc: colourEnc },
      { layer: layer('l2', 'Overlay'), enc: { colorKey: 'MAU', colorMap: { p: '#000' }, colorCounts: { p: 3 } } },
    ];
    const entries = buildLegendEntries(two, cfg());
    expect(entries.filter(e => e.kind === 'heading').map(e => e.label))
      .toEqual(['Background', 'MAU', 'Overlay', 'MAU']);
    expect(entries.filter(e => e.kind === 'item').every(e => !e.label.includes('Overlay'))).toBe(true);
  });

  it('does not name the layer when there is only one', () => {
    expect(buildLegendEntries(one, cfg()).map(e => e.label)).not.toContain('Background');
  });

  it('omits a channel the overlay switched off', () => {
    expect(buildLegendEntries(one, cfg({ showColorLegend: false }))).toEqual([]);
  });

  it('omits a layer the overlay left out of the legend', () => {
    expect(buildLegendEntries(one, cfg({ legendLayers: ['l2'] }))).toEqual([]);
  });

  it('drops a layer heading with nothing under it', () => {
    const two: LegendLayer[] = [
      { layer: layer('bg', 'Background'), enc: colourEnc },
      { layer: layer('l2', 'Empty'), enc: {} },
    ];
    expect(buildLegendEntries(two, cfg()).map(e => e.label)).not.toContain('Empty');
  });

  it('heads line types and textures too, each with its own swatch', () => {
    const rich: LegendLayer[] = [{
      layer: layer('bg', 'Background'),
      enc: {
        lineTypeKey: 'stress', lineTypePatternMap: { primary: [5, 5] }, lineTypeCounts: { primary: 4 },
        textureKey: 'voicing', textureMap: { voiced: 2 }, textureCounts: { voiced: 9 },
      },
    }];
    const entries = buildLegendEntries(rich, cfg());
    // A heading falls back to the field name in caps, as the other plots have always drawn it.
    expect(entries.map(e => e.label)).toEqual(['STRESS', 'primary (n=4)', 'VOICING', 'voiced (n=9)']);
    expect(entries[1].dash).toEqual([5, 5]);
    expect(entries[3].texture).toBe(2);
  });

  it('is empty for a layer with no encodings', () => {
    expect(buildLegendEntries([{ layer: layer('bg', 'Background'), enc: {} }], cfg())).toEqual([]);
  });
});

describe('legendWidth', () => {
  const entries = buildLegendEntries(one, cfg({ colorLegendTitle: 'A very long legend heading' }));

  it('is wide enough for a heading set larger than the values — the clipped case', () => {
    // The heading is the longest row here and is set at the title size, so measuring the
    // items alone would leave it running off the edge.
    const width = legendWidth(entries, 24, 96);
    const headingWidth = 96 * 0.62 * 'A very long legend heading'.length;
    expect(width).toBeGreaterThanOrEqual(headingWidth);
  });

  it('is wide enough for the longest value row', () => {
    const items = buildLegendEntries(one, cfg());
    expect(legendWidth(items, 24, 10)).toBeGreaterThanOrEqual(24 * (2 + 'k (n=7)'.length * 0.62));
  });

  it('never falls below the minimum it is given', () => {
    expect(legendWidth([], 24, 96, 460)).toBe(460);
  });

  it('is the minimum for an empty legend', () => {
    expect(legendWidth([], 24, 96)).toBe(0);
  });
});
