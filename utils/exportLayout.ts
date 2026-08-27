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
