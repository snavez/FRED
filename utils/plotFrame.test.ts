import { describe, it, expect } from 'vitest';
import { ExportConfig } from '../types';
import { drawPlotFrame, PlotFrameOptions } from './plotFrame';

/** Records the drawing calls a frame makes, so the typography can be asserted. */
const stubContext = () => {
  const fonts: string[] = [];
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const ctx = {
    _font: '',
    get font() { return this._font; },
    set font(v: string) { this._font = v; fonts.push(v); },
    lineWidth: 0, fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '',
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {},
    setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y, font: this._font }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fonts, texts };
};

const base = (over: Partial<PlotFrameOptions> = {}): PlotFrameOptions => ({
  area: { x: 100, y: 50, w: 400, h: 300 },
  xTicks: [{ pos: 120, label: '0' }, { pos: 480, label: '10' }],
  yTicks: [{ pos: 60, label: 'lo' }, { pos: 340, label: 'hi' }],
  xLabel: 'X axis',
  yLabel: 'Y axis',
  scale: 1,
  ...over,
});

const exportConfig = (over: Partial<ExportConfig> = {}): ExportConfig => ({
  scale: 1,
  xAxisLabelSize: 40,
  yAxisLabelSize: 44,
  tickLabelSize: 30,
  dataLabelSize: 12,
  showLegend: false,
  ...over,
} as ExportConfig);

/** The font size in a canvas font string, e.g. "600 40px Inter" -> 40. */
const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]);

describe('drawPlotFrame', () => {
  it('uses the screen sizes when there is no export config', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base());
    expect(sizeOf(texts.find(t => t.text === '0')!.font)).toBe(11);
    expect(sizeOf(texts.find(t => t.text === 'X axis')!.font)).toBe(13);
    expect(sizeOf(texts.find(t => t.text === 'Y axis')!.font)).toBe(13);
  });

  it('takes axis title and tick sizes from the export overlay — the reported gap', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base({ exportConfig: exportConfig() }));
    expect(sizeOf(texts.find(t => t.text === 'X axis')!.font)).toBe(40);
    expect(sizeOf(texts.find(t => t.text === 'Y axis')!.font)).toBe(44);
    expect(sizeOf(texts.find(t => t.text === '0')!.font)).toBe(30);
    expect(sizeOf(texts.find(t => t.text === 'lo')!.font)).toBe(30);
  });

  it('lets one axis override the shared tick size', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base({ exportConfig: exportConfig({ xTickLabelSize: 18, yTickLabelSize: 52 }) }));
    expect(sizeOf(texts.find(t => t.text === '0')!.font)).toBe(18);
    expect(sizeOf(texts.find(t => t.text === 'lo')!.font)).toBe(52);
  });

  it('multiplies every size by the render scale', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base({ scale: 3, exportConfig: exportConfig() }));
    expect(sizeOf(texts.find(t => t.text === 'X axis')!.font)).toBe(120);
    expect(sizeOf(texts.find(t => t.text === '0')!.font)).toBe(90);
  });

  it('nudges labels and ticks by the overlay offsets', () => {
    const { ctx, texts } = stubContext();
    const plain = stubContext();
    drawPlotFrame(plain.ctx, base());
    drawPlotFrame(ctx, base({ exportConfig: exportConfig({ xAxisTickX: 7, xAxisLabelY: -9 }) }));
    const movedTick = texts.find(t => t.text === '0')!;
    const plainTick = plain.texts.find(t => t.text === '0')!;
    expect(movedTick.x - plainTick.x).toBe(7);
    const movedLabel = texts.find(t => t.text === 'X axis')!;
    const plainLabel = plain.texts.find(t => t.text === 'X axis')!;
    expect(movedLabel.y - plainLabel.y).toBe(-9);
  });

  it('draws every tick it is given, and both axis titles', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base());
    expect(texts.map(t => t.text)).toEqual(['lo', 'hi', '0', '10', 'X axis', 'Y axis']);
  });

  it('draws nothing extra for an axis with no ticks', () => {
    const { ctx, texts } = stubContext();
    drawPlotFrame(ctx, base({ yTicks: [] }));
    expect(texts.map(t => t.text)).toEqual(['0', '10', 'X axis', 'Y axis']);
  });
});
