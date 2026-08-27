import { describe, expect, it } from 'vitest';
import { PlotConfig, SpeechToken, StyleOverrides } from '../types';
import { computeEncodingMaps } from './plotEncoding';

const token = (id: string, colour: string, fill: string): SpeechToken => ({
  id, speaker: 's1', file_id: id, xmin: 0, duration: 0.1, trajectory: [],
  fields: { colour, fill },
});

describe('computeEncodingMaps texture channel', () => {
  it('maps, counts, and honours saved fill-pattern overrides', () => {
    const data = [
      token('a', 'stop', 'striped'),
      token('b', 'stop', 'solid'),
      token('c', 'fricative', 'striped'),
    ];
    const config = {
      colorBy: 'colour', shapeBy: 'none', lineTypeBy: 'none', textureBy: 'fill', bwMode: false,
    } as PlotConfig;
    const styles: StyleOverrides = {
      colors: {}, shapes: {}, lineTypes: {}, textures: { striped: 7 },
    };

    const maps = computeEncodingMaps(data, config, styles);

    expect(maps.textureKey).toBe('fill');
    expect(maps.textureMap).toEqual({ solid: 0, striped: 7 });
    expect(maps.textureCounts).toEqual({ striped: 2, solid: 1 });
    expect(maps.colorCounts).toEqual({ stop: 2, fricative: 1 });
  });
});
