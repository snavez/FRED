import { ExportConfig, Layer } from '../types';

/**
 * The rows of an exported legend: a heading naming the variable, then one row per value.
 *
 * Plots used to build these ad hoc and disagreed about the shape. Some drew a heading and
 * plain labels; one drew no heading and prefixed every label with the variable name
 * (`MAU: t`, `MAU: k`), repeating on every row what a heading says once; another drew no
 * heading at all and appended the layer name instead. The reader met a different legend on
 * each tab. One builder, so a legend reads the same wherever it came from — and so the
 * heading is the editable title from the export overlay rather than a hardcoded string.
 */

export interface LegendEntry {
  /** A heading names the variable; an item names one of its values. */
  kind: 'heading' | 'item';
  label: string;
  /** Items only: the swatch to draw beside the label. */
  color?: string;
  dash?: number[];
  texture?: number;
}

/** The encoding maps a legend reads, as `computeEncodingMaps` returns them. */
interface EncodingLike {
  colorKey?: string | null;
  colorMap?: Record<string, string>;
  colorCounts?: Record<string, number>;
  shapeKey?: string | null;
  shapeMap?: Record<string, string>;
  shapeCounts?: Record<string, number>;
  lineTypeKey?: string | null;
  lineTypePatternMap?: Record<string, number[]>;
  lineTypeCounts?: Record<string, number>;
  textureKey?: string | null;
  textureMap?: Record<string, number>;
  textureCounts?: Record<string, number>;
}

export interface LegendLayer {
  layer: Layer;
  enc: EncodingLike;
}

/** The title for one channel: the user's own, else the export default, else the field. */
const titleFor = (
  layerId: string, channel: 'color' | 'shape' | 'lineType' | 'texture',
  key: string, cfg?: ExportConfig,
): string => {
  const perLayer = cfg?.layerLegends?.find(l => l.layerId === layerId);
  const own = perLayer && (
    channel === 'color' ? perLayer.colorTitle
    : channel === 'shape' ? perLayer.shapeTitle
    : channel === 'lineType' ? perLayer.lineTypeTitle
    : perLayer.textureTitle);
  const fallback = channel === 'color' ? cfg?.colorLegendTitle
    : channel === 'shape' ? cfg?.shapeLegendTitle
    : channel === 'lineType' ? cfg?.lineTypeLegendTitle
    : cfg?.textureLegendTitle;
  return own || fallback || key.toUpperCase();
};

/** Whether a channel is shown, honouring the per-layer switch then the global one. */
const shows = (layerId: string, global: boolean | undefined, cfg?: ExportConfig): boolean => {
  const perLayer = cfg?.layerLegends?.find(l => l.layerId === layerId);
  if (perLayer) return perLayer.show;
  return global !== false;
};

/**
 * Build the legend rows for an export.
 *
 * A value's label is the value and its count — never the variable name, which the heading
 * above it already gives. With more than one layer in the legend, each layer's block is
 * headed by its name, so the layer is said once rather than repeated on every row.
 */
export const buildLegendEntries = (
  legendLayers: LegendLayer[], cfg?: ExportConfig,
): LegendEntry[] => {
  const entries: LegendEntry[] = [];
  const namesLayers = legendLayers.length > 1;

  for (const { layer, enc } of legendLayers) {
    const included = !cfg?.legendLayers || cfg.legendLayers.includes(layer.id);
    if (!included) continue;
    const before = entries.length;
    if (namesLayers) entries.push({ kind: 'heading', label: layer.name });

    const channel = (
      key: string | null | undefined,
      name: 'color' | 'shape' | 'lineType' | 'texture',
      global: boolean | undefined,
      values: string[],
      counts: Record<string, number> | undefined,
      item: (k: string) => Omit<LegendEntry, 'kind' | 'label'>,
    ) => {
      if (!key || !shows(layer.id, global, cfg) || values.length === 0) return;
      entries.push({ kind: 'heading', label: titleFor(layer.id, name, key, cfg) });
      for (const k of values.slice().sort()) {
        entries.push({ kind: 'item', label: `${k} (n=${counts?.[k] || 0})`, ...item(k) });
      }
    };

    channel(enc.colorKey, 'color', cfg?.showColorLegend, Object.keys(enc.colorMap || {}),
      enc.colorCounts, k => ({ color: enc.colorMap?.[k] || '#334155' }));
    channel(enc.lineTypeKey, 'lineType', cfg?.showLineTypeLegend, Object.keys(enc.lineTypePatternMap || {}),
      enc.lineTypeCounts, k => ({ color: '#475569', dash: enc.lineTypePatternMap?.[k] }));
    channel(enc.textureKey, 'texture', cfg?.showTextureLegend, Object.keys(enc.textureMap || {}),
      enc.textureCounts, k => ({ color: '#475569', texture: enc.textureMap?.[k] }));

    // A layer name with nothing under it says nothing worth the space.
    if (namesLayers && entries.length === before + 1) entries.pop();
  }
  return entries;
};

/**
 * How wide the legend column has to be to hold its longest row.
 *
 * A heading is set larger than the values beneath it, so measuring the items alone leaves
 * the heading clipped — which is exactly what a fixed-width gutter did. Rough character
 * widths are enough: the column only has to be wide enough, and canvas text measurement
 * would need the font loaded before the size could be chosen.
 */
export const legendWidth = (
  entries: LegendEntry[], itemSize: number, titleSize: number, minimum = 0,
): number => {
  const CHAR = 0.62;
  const widths = entries.map(e => e.kind === 'heading'
    ? titleSize * CHAR * e.label.length
    : itemSize * (2 + e.label.length * CHAR));
  return Math.max(minimum, 0, ...widths);
};
