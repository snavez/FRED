import { describe, expect, it } from 'vitest';
import { ExportConfig } from '../types';
import { composeExport, computeExportPlotSize } from './exportLayout';

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

const base = {
  drawScale: 1,
  pad: 40,
  titleH: 0,
  plotW: 1000,
  plotH: 700,
  legendW: 300,
  legendH: 200,
  hasLegend: true,
};

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({ ...over } as ExportConfig);
const compose = (over: Partial<ExportConfig> = {}, rest: Partial<typeof base> = {}) =>
  composeExport({ ...base, ...rest, config: cfg(over) });

describe('composeExport', () => {
  it('puts the legend beside the plot by default, widening the canvas for it', () => {
    const c = compose();
    expect(c.legendX).toBe(c.plotX + base.plotW + base.pad);
    expect(c.canvasW).toBe(c.legendX + base.legendW + base.pad);
  });

  it('leaves the legend exactly where it was when custom is first chosen', () => {
    // The reported jump: as an absolute coordinate, choosing custom sent the legend to
    // (0,0) or off the canvas, and it had to be nudged back blindly.
    const before = compose();
    const after = compose({ legendPosition: 'custom' });
    expect(after.legendX).toBe(before.legendX);
    expect(after.legendY).toBe(before.legendY);
  });

  it('nudges from where the legend already was', () => {
    const before = compose();
    const nudged = compose({ legendPosition: 'custom', legendX: -120, legendY: 60 });
    expect(nudged.legendX).toBe(before.legendX - 120);
    expect(nudged.legendY).toBe(before.legendY + 60);
  });

  it('keeps a nudged legend on the canvas', () => {
    const c = compose({ legendPosition: 'custom', legendX: 500, legendY: 400 });
    expect(c.canvasW).toBeGreaterThanOrEqual(c.legendX + base.legendW);
    expect(c.canvasH).toBeGreaterThanOrEqual(c.legendY + base.legendH);
  });

  it('places the legend below the plot, and grows the canvas down', () => {
    const c = compose({ legendPosition: 'bottom' });
    expect(c.legendY).toBe(c.plotY + base.plotH + base.pad);
    expect(c.canvasH).toBe(c.legendY + base.legendH + base.pad);
  });

  it('tucks an inside legend within the plot', () => {
    const left = compose({ legendPosition: 'inside-top-left' });
    expect(left.legendX).toBeGreaterThan(left.plotX);
    expect(left.legendX).toBeLessThan(left.plotX + base.plotW);
    const right = compose({ legendPosition: 'inside-top-right' });
    expect(right.legendX + base.legendW).toBeLessThanOrEqual(right.plotX + base.plotW);
  });

  it('moves the plot by the graph offset', () => {
    const plain = compose();
    const shifted = compose({ graphX: 150, graphY: 30 });
    expect(shifted.plotX).toBe(plain.plotX + 150);
    expect(shifted.plotY).toBe(plain.plotY + 30);
  });

  it('grows the canvas so an offset plot is not cut off', () => {
    const shifted = compose({ graphX: 150 });
    expect(shifted.canvasW).toBeGreaterThan(compose().canvasW);
  });

  it('carries the legend along when the plot is offset', () => {
    const shifted = compose({ graphX: 150 });
    expect(shifted.legendX).toBe(shifted.plotX + base.plotW + base.pad);
  });

  it('multiplies offsets by the render scale', () => {
    const at3x = composeExport({
      ...base, drawScale: 3, config: cfg({ graphX: 10, legendPosition: 'custom', legendX: 20 }),
    });
    const at1x = compose({ graphX: 10, legendPosition: 'custom', legendX: 20 });
    expect(at3x.plotX - base.pad).toBe((at1x.plotX - base.pad) * 3);
  });

  it('reserves no legend room when there is no legend', () => {
    const c = compose({}, { hasLegend: false });
    expect(c.canvasW).toBe(c.plotX + base.plotW + base.pad);
  });
});
