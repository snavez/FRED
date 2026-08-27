import { describe, expect, it } from 'vitest';
import { ExportConfig } from '../types';
import { computeExportPlotSize } from './exportLayout';

const config = (scale: number): ExportConfig => ({
  scale, graphScaleX: 1.25, graphScaleY: 0.75,
  xAxisLabelSize: 20, yAxisLabelSize: 20, tickLabelSize: 12, dataLabelSize: 12,
  showLegend: true, legendTitleSize: 16, legendItemSize: 12,
  showColorLegend: true, colorLegendTitle: 'Colour',
  showShapeLegend: true, shapeLegendTitle: 'Shape',
  showTextureLegend: true, textureLegendTitle: 'Texture',
  showLineTypeLegend: true, lineTypeLegendTitle: 'Line',
});

describe('computeExportPlotSize', () => {
  it('keeps logical composition fixed while resolution multiplies every pixel dimension', () => {
    const one = computeExportPlotSize(config(1), 2400, 1600);
    const four = computeExportPlotSize(config(4), 2400, 1600);

    expect(four.logicalWidth).toBe(one.logicalWidth);
    expect(four.logicalHeight).toBe(one.logicalHeight);
    expect(four.width).toBe(one.width * 4);
    expect(four.height).toBe(one.height * 4);
  });
});
