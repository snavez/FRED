import { ExportConfig } from '../types';

/**
 * The axes every plot draws around its data: gridlines, tick labels, a border, and a
 * title on each axis.
 *
 * Shared because the export overlay's typography lives here. Each plot used to draw its
 * own frame, and a plot that drew its own quietly ignored the overlay's axis and tick
 * sizes — the settings simply did nothing on that tab, with nothing to show they had been
 * missed. One frame means a new plot honours the overlay by construction.
 *
 * Sizes and nudges come from `exportConfig` when exporting and fall back to the screen
 * defaults otherwise, so an on-screen frame is unaffected by export settings.
 */

/** A tick that has already been positioned in canvas space and labelled. */
export interface FrameTick {
  pos: number;
  label: string;
}

export interface FrameArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlotFrameOptions {
  area: FrameArea;
  xTicks: FrameTick[];
  yTicks: FrameTick[];
  xLabel: string;
  yLabel: string;
  /** Device/render scale every measurement is multiplied by. */
  scale: number;
  /** Dashed reference lines where a measure has a meaningful zero. */
  zero?: { x?: number; y?: number };
  /** Typography and nudges for an export; screen defaults are used without it. */
  exportConfig?: ExportConfig;
  /** How far the y-axis title sits from the frame, in unscaled pixels. */
  yLabelOffset?: number;
}

/** Screen sizes, used whenever the frame is not being exported. */
const SCREEN_TICK_SIZE = 11;
const SCREEN_LABEL_SIZE = 13;
const DEFAULT_Y_LABEL_OFFSET = 52;

export const drawPlotFrame = (
  ctx: CanvasRenderingContext2D,
  opts: PlotFrameOptions,
): void => {
  const { area, xTicks, yTicks, xLabel, yLabel, scale: s, zero, exportConfig: ec } = opts;

  const xTickSize = ec ? (ec.xTickLabelSize ?? ec.tickLabelSize) : SCREEN_TICK_SIZE;
  const yTickSize = ec ? (ec.yTickLabelSize ?? ec.tickLabelSize) : SCREEN_TICK_SIZE;
  const xLabelSize = ec ? ec.xAxisLabelSize : SCREEN_LABEL_SIZE;
  const yLabelSize = ec ? ec.yAxisLabelSize : SCREEN_LABEL_SIZE;
  const xTickX = (ec?.xAxisTickX ?? 0) * s;
  const xTickY = (ec?.xAxisTickY ?? 0) * s;
  const yTickX = (ec?.yAxisTickX ?? 0) * s;
  const yTickY = (ec?.yAxisTickY ?? 0) * s;
  const xLabelX = (ec?.xAxisLabelX ?? 0) * s;
  const xLabelY = (ec?.xAxisLabelY ?? 0) * s;
  const yLabelX = (ec?.yAxisLabelX ?? 0) * s;
  const yLabelY = (ec?.yAxisLabelY ?? 0) * s;
  const yOffset = (opts.yLabelOffset ?? DEFAULT_Y_LABEL_OFFSET) * s;

  ctx.lineWidth = 1 * s;
  ctx.fillStyle = '#64748b';

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `${yTickSize * s}px Inter, sans-serif`;
  yTicks.forEach(t => {
    ctx.strokeStyle = '#eef2f7';
    ctx.beginPath(); ctx.moveTo(area.x, t.pos); ctx.lineTo(area.x + area.w, t.pos); ctx.stroke();
    ctx.fillText(t.label, area.x - 6 * s + yTickX, t.pos + yTickY);
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `${xTickSize * s}px Inter, sans-serif`;
  xTicks.forEach(t => {
    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath(); ctx.moveTo(t.pos, area.y); ctx.lineTo(t.pos, area.y + area.h); ctx.stroke();
    ctx.fillText(t.label, t.pos + xTickX, area.y + area.h + 6 * s + xTickY);
  });

  if (zero?.y !== undefined) {
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([5 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(area.x, zero.y); ctx.lineTo(area.x + area.w, zero.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (zero?.x !== undefined) {
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([5 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(zero.x, area.y); ctx.lineTo(zero.x, area.y + area.h); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5 * s;
  ctx.strokeRect(area.x, area.y, area.w, area.h);

  ctx.fillStyle = '#334155';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${xLabelSize * s}px Inter, sans-serif`;
  ctx.fillText(xLabel, area.x + area.w / 2 + xLabelX, area.y + area.h + 42 * s + xLabelY);

  ctx.save();
  ctx.translate(area.x - yOffset + yLabelX, area.y + area.h / 2 + yLabelY);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `600 ${yLabelSize * s}px Inter, sans-serif`;
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
};
