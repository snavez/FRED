import { Layer } from '../types';

/**
 * Which fields a hover tooltip shows.
 *
 * Point Info reads as a property of the view, but the popover writes to the layer being
 * edited. Hovering a point that belongs to a *different* layer then found no fields there
 * and showed the "choose some fields" placeholder — which looks exactly like a token with
 * no data, on a plot where every token has a filename and a word.
 *
 * So a point shows the fields the user asked for, wherever they asked for them: its own
 * layer's when that layer has them, else whichever layer does.
 */
export const tooltipFieldsFor = (layers: Layer[], layer?: Layer | null): string[] => {
  const own = layer?.config.tooltipFields;
  if (own && own.length > 0) return own;
  const configured = layers.find(l => (l.config.tooltipFields?.length ?? 0) > 0);
  return configured?.config.tooltipFields ?? [];
};

/**
 * Whether a layer's individual tokens are actually on screen, and so whether hovering
 * should find them. A layer showing only its group means has no points to hover: letting
 * its tokens win the hit-test hides the points that *are* drawn behind invisible ones.
 */
export const layerShowsPoints = (layer: Layer): boolean => {
  if (!layer.visible) return false;
  const cfg = layer.config;
  return cfg.plotType === 'trajectory'
    ? (cfg.trajectoryLineOpacity ?? 0.5) > 0
    : cfg.showPoints;
};
