import { describe, it, expect } from 'vitest';
import { layerShowsPoints, tooltipFieldsFor } from './pointInfo';
import type { Layer, PlotConfig } from '../types';

const layer = (id: string, config: Partial<PlotConfig>, visible = true): Layer => ({
  id,
  name: id,
  visible,
  isBackground: id === 'bg',
  config: { showPoints: true, plotType: 'point', ...config } as PlotConfig,
  filters: { filters: {} },
  styleOverrides: { colors: {}, shapes: {}, textures: {}, lineTypes: {} },
});

describe('tooltipFieldsFor', () => {
  it('uses the hovered layer’s own fields', () => {
    const l1 = layer('bg', { tooltipFields: ['file_id'] });
    const l2 = layer('p1', { tooltipFields: ['word', 'xmin'] });
    expect(tooltipFieldsFor([l1, l2], l2)).toEqual(['word', 'xmin']);
  });

  it('falls back to the fields chosen on another layer', () => {
    // The reported bug: Point Info is set on the layer being edited, so hovering a point
    // on a different layer showed the "choose some fields" placeholder — which reads as a
    // token with no data at all
    const bg = layer('bg', { tooltipFields: [] });
    const overlay = layer('p1', { tooltipFields: ['file_id', 'word'] });
    expect(tooltipFieldsFor([bg, overlay], bg)).toEqual(['file_id', 'word']);
  });

  it('is empty only when no layer has any fields', () => {
    const bg = layer('bg', { tooltipFields: [] });
    expect(tooltipFieldsFor([bg], bg)).toEqual([]);
    expect(tooltipFieldsFor([bg], undefined)).toEqual([]);
    expect(tooltipFieldsFor([], null)).toEqual([]);
  });

  it('handles a layer that has never had the setting', () => {
    const bare = layer('bg', {});
    const other = layer('p1', { tooltipFields: ['speaker'] });
    expect(tooltipFieldsFor([bare, other], bare)).toEqual(['speaker']);
  });
});

describe('layerShowsPoints', () => {
  it('is true for a point layer drawing its points', () => {
    expect(layerShowsPoints(layer('p1', { showPoints: true }))).toBe(true);
  });

  it('is false for a layer showing only its means', () => {
    // Its tokens must not win the hit-test: they are not on screen to be hovered
    expect(layerShowsPoints(layer('bg', { showPoints: false, showCentroids: true }))).toBe(false);
  });

  it('is false for a hidden layer, whatever it would draw', () => {
    expect(layerShowsPoints(layer('p1', { showPoints: true }, false))).toBe(false);
  });

  it('reads a trajectory layer by its line opacity', () => {
    expect(layerShowsPoints(layer('t1', { plotType: 'trajectory', trajectoryLineOpacity: 0.4 }))).toBe(true);
    expect(layerShowsPoints(layer('t1', { plotType: 'trajectory', trajectoryLineOpacity: 0 }))).toBe(false);
    // No setting yet: trajectories are drawn by default
    expect(layerShowsPoints(layer('t1', { plotType: 'trajectory' }))).toBe(true);
  });
});
