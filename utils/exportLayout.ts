import { ExportConfig } from '../types';

/**
 * One export layout contract for every canvas plot.
 *
 * Graph scale changes the logical composition. Resolution scale only multiplies pixels;
 * it must never make text, margins, legends, or the plot larger relative to one another.
 */
export const computeExportPlotSize = (
  config: ExportConfig, baseWidth: number, baseHeight: number,
) => {
  const drawScale = Math.max(1, Number(config.scale) || 1);
  const graphScaleX = config.graphScaleX || config.graphScale || 1;
  const graphScaleY = config.graphScaleY || config.graphScale || 1;
  const logicalWidth = baseWidth * graphScaleX;
  const logicalHeight = baseHeight * graphScaleY;
  return {
    drawScale, graphScaleX, graphScaleY, logicalWidth, logicalHeight,
    width: logicalWidth * drawScale,
    height: logicalHeight * drawScale,
  };
};

export interface ExportComposition {
  /** Where the plot's top-left corner goes on the canvas. */
  plotX: number;
  plotY: number;
  /** Where the legend's first row starts. */
  legendX: number;
  legendY: number;
  canvasW: number;
  canvasH: number;
}

/**
 * Where the plot and its legend sit on the exported canvas.
 *
 * `custom` is an **offset from the default position**, not an absolute coordinate. As an
 * absolute it started at (0, 0), so choosing it threw the legend into the top-left corner —
 * or off the canvas entirely when a stale coordinate was still in the config — and the only
 * way back was to nudge blindly until it reappeared. As an offset, choosing `custom`
 * changes nothing until you actually nudge, which is what picking a position should do.
 *
 * The graph offset shifts the plot within the canvas, and the canvas grows to match so
 * nothing is pushed off the edge.
 */
export const composeExport = (opts: {
  config: ExportConfig;
  drawScale: number;
  pad: number;
  titleH: number;
  plotW: number;
  plotH: number;
  legendW: number;
  legendH: number;
  hasLegend: boolean;
}): ExportComposition => {
  const { config, drawScale, pad, titleH, plotW, plotH, legendW, legendH, hasLegend } = opts;
  const graphX = (Number(config.graphX) || 0) * drawScale;
  const graphY = (Number(config.graphY) || 0) * drawScale;

  const plotX = pad + Math.max(0, graphX);
  const plotY = titleH + pad + Math.max(0, graphY);
  let canvasW = plotX + plotW + pad;
  let canvasH = plotY + plotH + pad;

  // The default: beside the plot, with the canvas widened to hold it.
  let legendX = plotX + plotW + pad;
  let legendY = plotY;
  if (!hasLegend) return { plotX, plotY, legendX: 0, legendY: 0, canvasW, canvasH };

  switch (config.legendPosition) {
    case 'bottom':
      legendX = plotX;
      legendY = plotY + plotH + pad;
      canvasH = legendY + legendH + pad;
      break;
    case 'inside-top-left':
      legendX = plotX + pad;
      legendY = plotY + pad;
      break;
    case 'inside-top-right':
      legendX = Math.max(plotX + pad, plotX + plotW - legendW - pad);
      legendY = plotY + pad;
      break;
    case 'custom':
      legendX += (Number(config.legendX) || 0) * drawScale;
      legendY += (Number(config.legendY) || 0) * drawScale;
      canvasW = Math.max(canvasW, legendX + legendW + pad);
      canvasH = Math.max(canvasH, legendY + legendH + pad);
      break;
    default:
      canvasW = legendX + legendW + pad;
      canvasH = Math.max(canvasH, legendY + legendH + pad);
  }
  return { plotX, plotY, legendX, legendY, canvasW, canvasH };
};
