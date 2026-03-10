
import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig, DatasetMeta } from '../types';
import { generateTexture } from '../utils/textureGenerator';
import { getLabel } from '../utils/getLabel';

interface DurationPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626'
];

const CLUSTER_GAP = 1.5; // gap between clusters in slot units

interface Stats {
  min: number; max: number; q1: number; median: number; q3: number;
  mean: number; sd: number; count: number; values: number[]; tokens: SpeechToken[];
}

interface GroupData {
  key: string;
  colorKey: string;
  textureKey: string;
  stats: Stats | null;
}

interface FacetData {
  facetKey: string;
  groups: GroupData[];
}

// Statistical Helper — generalized with value extractor
const calculateStats = (tokens: SpeechToken[], getValue: (t: SpeechToken) => number): Stats | null => {
  if (tokens.length === 0) return null;
  const values = tokens.map(getValue).filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const min = values[0];
  const max = values[values.length - 1];
  const q1 = values[Math.floor(values.length * 0.25)];
  const median = values[Math.floor(values.length * 0.5)];
  const q3 = values[Math.floor(values.length * 0.75)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return { min, max, q1, median, q3, mean, sd, count: values.length, values, tokens };
};

const DurationPlot = forwardRef<PlotHandle, DurationPlotProps>(({ data, config, datasetMeta }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);

  // Generalized Y-axis value extractor
  const getValue = useCallback((t: SpeechToken): number => {
    if (!config.durationYField || config.durationYField === 'duration') return t.duration;
    const raw = t.fields[config.durationYField];
    return raw !== undefined ? parseFloat(raw) : NaN;
  }, [config.durationYField]);

  // Y-axis label
  const yAxisLabel = useMemo(() => {
    if (!config.durationYField || config.durationYField === 'duration') return 'Duration (s)';
    return config.durationYField.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, [config.durationYField]);

  // Hierarchical clustering state
  const clusterBy = config.durationClusterBy;
  const isHierarchical = !!(clusterBy && clusterBy !== 'none');

  // Data pipeline: faceting → color/texture splitting → stats
  const { facetData, colorMap, textureMap, globalYMax } = useMemo(() => {
    const palette = config.bwMode ? ['#525252'] : COLORS;

    // 1. Facet by durationPlotBy
    const facetGroups: Record<string, SpeechToken[]> = {};
    if (config.durationPlotBy && config.durationPlotBy !== 'none') {
      data.forEach(t => {
        const fKey = getLabel(t, config.durationPlotBy) || '(empty)';
        if (!facetGroups[fKey]) facetGroups[fKey] = [];
        facetGroups[fKey].push(t);
      });
    } else {
      facetGroups['All'] = data;
    }
    const facetKeys = Object.keys(facetGroups).sort();

    // 2. Determine color and texture unique values (globally, so colors are consistent across facets)
    const hasColor = config.colorBy && config.colorBy !== 'none';
    const hasTexture = config.textureBy && config.textureBy !== 'none';

    const allColorValues: string[] = hasColor
      ? Array.from(new Set<string>(data.map(t => getLabel(t, config.colorBy) || '(empty)'))).sort()
      : [];
    const allTextureValues: string[] = hasTexture
      ? Array.from(new Set<string>(data.map(t => getLabel(t, config.textureBy!) || '(empty)'))).sort()
      : [];

    // Build color map
    const cMap: Record<string, string> = {};
    if (hasColor) {
      allColorValues.forEach((v, i) => cMap[v] = palette[i % palette.length]);
    }

    // Build texture map (index-based)
    const tMap: Record<string, number> = {};
    if (hasTexture) {
      allTextureValues.forEach((v, i) => tMap[v] = i);
    }

    // 3. For each facet, split into sub-groups
    const facets: FacetData[] = facetKeys.map(fKey => {
      const tokens = facetGroups[fKey];
      const groups: GroupData[] = [];

      if (hasColor && hasTexture) {
        // Cross-product of color × texture
        allColorValues.forEach(cv => {
          allTextureValues.forEach(tv => {
            const subset = tokens.filter(t =>
              (getLabel(t, config.colorBy) || '(empty)') === cv &&
              (getLabel(t, config.textureBy!) || '(empty)') === tv
            );
            groups.push({
              key: `${cv} / ${tv}`,
              colorKey: cv,
              textureKey: tv,
              stats: calculateStats(subset, getValue),
            });
          });
        });
      } else if (hasColor) {
        allColorValues.forEach(cv => {
          const subset = tokens.filter(t => (getLabel(t, config.colorBy) || '(empty)') === cv);
          groups.push({
            key: cv,
            colorKey: cv,
            textureKey: '',
            stats: calculateStats(subset, getValue),
          });
        });
      } else if (hasTexture) {
        allTextureValues.forEach(tv => {
          const subset = tokens.filter(t => (getLabel(t, config.textureBy!) || '(empty)') === tv);
          groups.push({
            key: tv,
            colorKey: '',
            textureKey: tv,
            stats: calculateStats(subset, getValue),
          });
        });
      } else {
        // No color/texture splitting — one box per facet
        groups.push({
          key: fKey === 'All' ? 'All' : fKey,
          colorKey: '',
          textureKey: '',
          stats: calculateStats(tokens, getValue),
        });
      }

      return { facetKey: fKey, groups };
    });

    // 4. Global Y max for shared axis
    const allStats = facets.flatMap(f => f.groups.map(g => g.stats).filter(Boolean) as Stats[]);
    const yMax = config.durationRange[1] > 0
      ? config.durationRange[1]
      : allStats.length > 0
        ? Math.max(...allStats.map(s => s.max)) * 1.1
        : 1;

    return { facetData: facets, colorMap: cMap, textureMap: tMap, globalYMax: yMax };
  }, [data, config.durationPlotBy, config.colorBy, config.textureBy, config.bwMode, config.durationRange, getValue]);

  // Helper: draw a single box (whiskers, quartile box, mean marker, outliers, jitter points)
  const drawBox = useCallback((
    ctx: CanvasRenderingContext2D, g: GroupData, xCenter: number, barWidth: number,
    mapY: (v: number) => number, scale: number, drawScale: number
  ) => {
    const s = g.stats!;
    const defaultColor = config.bwMode ? '#525252' : '#64748b';
    const color = g.colorKey ? (colorMap[g.colorKey] || defaultColor) : defaultColor;

    let fillStyle: string | CanvasPattern = color;
    if (g.textureKey && textureMap[g.textureKey] !== undefined) {
      fillStyle = generateTexture(ctx, textureMap[g.textureKey], color, '#ffffff');
    }

    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = config.bwMode ? '#000' : color;
    ctx.lineWidth = (2 * drawScale) / scale;

    // Whisker calculation
    const iqr = s.q3 - s.q1;
    let whiskerLow: number, whiskerHigh: number;
    if (config.durationWhiskerMode === 'minmax') {
      whiskerLow = s.min;
      whiskerHigh = s.max;
    } else {
      whiskerLow = s.values.find(v => v >= s.q1 - 1.5 * iqr) ?? s.min;
      whiskerHigh = [...s.values].reverse().find(v => v <= s.q3 + 1.5 * iqr) ?? s.max;
    }

    if (config.showQuartiles) {
      const yQ1 = mapY(s.q1);
      const yQ3 = mapY(s.q3);
      const yWhiskerLow = mapY(whiskerLow);
      const yWhiskerHigh = mapY(whiskerHigh);

      // Whiskers
      ctx.beginPath();
      ctx.moveTo(xCenter, yQ1); ctx.lineTo(xCenter, yWhiskerLow);
      ctx.moveTo(xCenter - barWidth / 4, yWhiskerLow); ctx.lineTo(xCenter + barWidth / 4, yWhiskerLow);
      ctx.moveTo(xCenter, yQ3); ctx.lineTo(xCenter, yWhiskerHigh);
      ctx.moveTo(xCenter - barWidth / 4, yWhiskerHigh); ctx.lineTo(xCenter + barWidth / 4, yWhiskerHigh);
      ctx.stroke();

      // Box (Q1 to Q3)
      ctx.fillRect(xCenter - barWidth / 2, yQ3, barWidth, yQ1 - yQ3);
      ctx.strokeRect(xCenter - barWidth / 2, yQ3, barWidth, yQ1 - yQ3);

      // Center line (median or mean)
      const centerVal = config.durationCenterLine === 'mean' ? s.mean : s.median;
      const yCenter = mapY(centerVal);
      ctx.beginPath();
      ctx.moveTo(xCenter - barWidth / 2, yCenter);
      ctx.lineTo(xCenter + barWidth / 2, yCenter);
      ctx.lineWidth = (3 * drawScale) / scale;
      ctx.strokeStyle = config.bwMode ? 'white' : 'rgba(255,255,255,0.8)';
      ctx.stroke();
    } else {
      const yMean = mapY(s.mean);
      const yBase = mapY(0);
      ctx.fillRect(xCenter - barWidth / 2, yMean, barWidth, yBase - yMean);
      ctx.strokeRect(xCenter - barWidth / 2, yMean, barWidth, yBase - yMean);

      const ySDTop = mapY(s.mean + s.sd);
      ctx.beginPath();
      ctx.strokeStyle = '#334155';
      ctx.moveTo(xCenter, yMean); ctx.lineTo(xCenter, ySDTop);
      ctx.moveTo(xCenter - (5 * drawScale), ySDTop); ctx.lineTo(xCenter + (5 * drawScale), ySDTop);
      ctx.stroke();
    }

    // Mean marker (diamond)
    if (config.showMeanMarker) {
      const yMean = mapY(s.mean);
      ctx.fillStyle = 'white';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = (1 * drawScale) / scale;
      ctx.beginPath();
      ctx.moveTo(xCenter, yMean - (4 * drawScale));
      ctx.lineTo(xCenter + (4 * drawScale), yMean);
      ctx.lineTo(xCenter, yMean + (4 * drawScale));
      ctx.lineTo(xCenter - (4 * drawScale), yMean);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Outliers (only in IQR mode when showOutliers is on)
    if (config.showOutliers && config.durationWhiskerMode !== 'minmax') {
      s.values.forEach(v => {
        if (v < whiskerLow || v > whiskerHigh) {
          ctx.beginPath();
          ctx.arc(xCenter, mapY(v), 3 * drawScale, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = (1.5 * drawScale) / scale;
          ctx.stroke();
        }
      });
    }

    // Jitter points
    if (config.showDurationPoints) {
      s.tokens.forEach(t => {
        const hash = t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
        const px = xCenter + jitter;
        const py = mapY(getValue(t));
        ctx.beginPath();
        ctx.arc(px, py, 2 * drawScale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
      });
    }
  }, [config, colorMap, textureMap, getValue]);

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    const isExport = !!exportConfig;
    const isSingleFacet = facetData.length <= 1;

    // Dynamic margins — extra bottom space for hierarchical labels
    const bottomMarginBase = exportConfig
      ? Math.max(isHierarchical ? 160 : 100, exportConfig.xAxisLabelSize * (isHierarchical ? 2.2 : 1.2) + 20)
      : (isHierarchical ? 120 : 80);
    const leftMarginBase = exportConfig ? Math.max(220, exportConfig.yAxisLabelSize * 1.5 + 100) : (isSingleFacet ? 60 : 40);
    const topMarginBase = exportConfig?.showPlotTitle ? Math.max(120, (exportConfig.plotTitleSize || 128) + 40) : (isSingleFacet ? 40 : 30);
    const margin = {
      top: (topMarginBase * drawScale) + ((exportConfig?.graphY || 0) * drawScale),
      right: 20 * drawScale,
      bottom: bottomMarginBase * drawScale,
      left: (leftMarginBase * drawScale) + ((exportConfig?.graphX || 0) * drawScale),
    };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const yMin = 0;
    const yMax = globalYMax;

    // Tick / label fonts
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 32 : 11);
    const labelFont = exportConfig ? exportConfig.xAxisLabelSize : (isExport ? 36 : 11);
    const metaFont = exportConfig ? (exportConfig.dataLabelSize * 0.8) : (isExport ? 28 : 9);
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale;

    // Helper: get cluster key for a group
    const getClusterKey = (g: GroupData): string => {
      if (clusterBy === config.colorBy) return g.colorKey || '(empty)';
      if (clusterBy === config.textureBy) return g.textureKey || '(empty)';
      return '';
    };

    // Helper: get inner label for a group (the non-cluster part)
    const getInnerLabel = (g: GroupData): string => {
      if (!isHierarchical) return g.key;
      if (clusterBy === config.colorBy) return g.textureKey || g.key;
      if (clusterBy === config.textureBy) return g.colorKey || g.key;
      return g.key;
    };

    // Helper to render one facet's boxes within a given rect
    const renderFacet = (facet: FacetData, fx: number, fy: number, fw: number, fh: number, showYAxis: boolean) => {
      const mapY = (val: number) => fy + fh - ((val - yMin) / (yMax - yMin)) * fh;

      // Grid lines
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = (1 * drawScale) / scale;
      ctx.fillStyle = '#64748b';

      const ySteps = 5;
      if (showYAxis) {
        ctx.font = `bold ${(tickBaseSize * drawScale) / scale}px Inter`;
        ctx.textAlign = 'right';
        for (let i = 0; i <= ySteps; i++) {
          const val = yMin + (yMax - yMin) * (i / ySteps);
          const y = mapY(val);
          ctx.beginPath();
          ctx.moveTo(fx, y);
          ctx.lineTo(fx + fw, y);
          ctx.stroke();
          const suffix = (!config.durationYField || config.durationYField === 'duration') ? 's' : '';
          ctx.fillText(val.toFixed(2) + suffix, fx - (8 * drawScale) + yTickOffsetX, y + (4 * drawScale) + yTickOffsetY);
        }
      } else {
        for (let i = 0; i <= ySteps; i++) {
          const val = yMin + (yMax - yMin) * (i / ySteps);
          const y = mapY(val);
          ctx.beginPath();
          ctx.moveTo(fx, y);
          ctx.lineTo(fx + fw, y);
          ctx.stroke();
        }
      }

      // Filter groups with stats
      const validGroups = facet.groups.filter(g => g.stats !== null);
      if (validGroups.length === 0) return;

      if (isHierarchical) {
        // === Clustered layout ===
        // Group validGroups into clusters
        const clusterMap: Record<string, GroupData[]> = {};
        validGroups.forEach(g => {
          const ck = getClusterKey(g);
          if (!clusterMap[ck]) clusterMap[ck] = [];
          clusterMap[ck].push(g);
        });
        const clusterKeys = Object.keys(clusterMap).sort();
        const totalBoxes = validGroups.length;
        const totalSlots = totalBoxes + (clusterKeys.length > 1 ? (clusterKeys.length - 1) * CLUSTER_GAP : 0);
        const slotWidth = totalSlots > 0 ? fw / totalSlots : fw;
        const barWidth = Math.min(50 * drawScale, slotWidth * 0.6);

        let slotIndex = 0;
        clusterKeys.forEach((ck, ci) => {
          const clusterStartSlot = slotIndex;
          const clusterGroups = clusterMap[ck];

          clusterGroups.forEach(g => {
            const xCenter = fx + (slotIndex + 0.5) * slotWidth;

            // Draw the box
            drawBox(ctx, g, xCenter, barWidth, mapY, scale, drawScale);

            // Inner label (non-cluster part of the key)
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.font = `${(labelFont * drawScale) / scale}px Inter`;
            const xLabelX = xCenter + xTickOffsetX;
            const xLabelY = fy + fh + (20 * drawScale) + xTickOffsetY;
            ctx.fillText(getInnerLabel(g), xLabelX, xLabelY);

            // Count label
            ctx.fillStyle = '#64748b';
            ctx.font = `${(metaFont * drawScale) / scale}px Inter`;
            ctx.fillText(`n=${g.stats!.count}`, xLabelX, xLabelY + (metaFont * 1.5 * drawScale));

            slotIndex++;
          });

          // Outer label (cluster key) with bracket line
          if (clusterGroups.length > 0) {
            const clusterEndSlot = slotIndex - 1;
            const clusterCenterX = fx + ((clusterStartSlot + clusterEndSlot + 1) / 2) * slotWidth;
            const outerLabelY = fy + fh + (20 * drawScale) + xTickOffsetY + (metaFont * 1.5 * drawScale) + (labelFont * 2.0 * drawScale);

            // Bracket line
            const bracketY = outerLabelY - (labelFont * 1.2 * drawScale);
            const leftX = fx + (clusterStartSlot + 0.15) * slotWidth;
            const rightX = fx + (clusterEndSlot + 0.85) * slotWidth;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = (1.5 * drawScale) / scale;
            ctx.beginPath();
            ctx.moveTo(leftX, bracketY);
            ctx.lineTo(rightX, bracketY);
            ctx.stroke();

            // Outer label — bold, slightly larger
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.font = `bold ${(labelFont * 1.15 * drawScale) / scale}px Inter`;
            ctx.fillText(ck, clusterCenterX, outerLabelY);
          }

          // Gap between clusters
          if (ci < clusterKeys.length - 1) {
            slotIndex += CLUSTER_GAP;
          }
        });
      } else {
        // === Flat layout (existing behavior) ===
        const spacing = fw / validGroups.length;
        const barWidth = Math.min(50 * drawScale, spacing * 0.6);

        validGroups.forEach((g, i) => {
          const xCenter = fx + (spacing * i) + spacing / 2;

          // Draw the box
          drawBox(ctx, g, xCenter, barWidth, mapY, scale, drawScale);

          // X-axis label
          ctx.fillStyle = '#0f172a';
          ctx.textAlign = 'center';
          ctx.font = `bold ${(labelFont * drawScale) / scale}px Inter`;
          const xLabelX = xCenter + xTickOffsetX;
          const xLabelY = fy + fh + (20 * drawScale) + xTickOffsetY;
          ctx.fillText(g.key, xLabelX, xLabelY);

          ctx.fillStyle = '#64748b';
          ctx.font = `${(metaFont * drawScale) / scale}px Inter`;
          ctx.fillText(`n=${g.stats!.count}`, xLabelX, xLabelY + (metaFont * 1.5 * drawScale));
        });
      }
    };

    // === Main rendering logic ===
    if (isSingleFacet) {
      renderFacet(facetData[0], margin.left, margin.top, chartW, chartH, true);

      // Y-axis title (export only)
      if (exportConfig) {
        ctx.save();
        const yTitleSize = exportConfig.yAxisLabelSize * drawScale;
        ctx.font = `bold ${yTitleSize / scale}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        const yLabelX = margin.left - (leftMarginBase * 0.6 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yLabelY = margin.top + (chartH / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        ctx.translate(yLabelX, yLabelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yAxisLabel, 0, 0);
        ctx.restore();
      }
    } else {
      // Multi-facet grid layout
      const cols = Math.ceil(Math.sqrt(facetData.length));
      const rows = Math.ceil(facetData.length / cols);
      const cellW = chartW / cols;
      const cellH = chartH / rows;

      facetData.forEach((facet, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const pad = 15 * drawScale;
        const isLeftCol = col === 0;

        const cx = margin.left + col * cellW + (isLeftCol ? pad * 2 : pad);
        const cy = margin.top + row * cellH + pad + (15 * drawScale);
        const cw = cellW - (isLeftCol ? pad * 3 : pad * 2);
        const ch = cellH - pad * 2 - (35 * drawScale);

        // Facet title
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${(13 * drawScale) / scale}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillText(facet.facetKey, margin.left + col * cellW + cellW / 2, cy - (5 * drawScale));

        renderFacet(facet, cx, cy, cw, ch, isLeftCol);
      });

      // Y-axis title (export only)
      if (exportConfig) {
        ctx.save();
        const yTitleSize = exportConfig.yAxisLabelSize * drawScale;
        ctx.font = `bold ${yTitleSize / scale}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        const yLabelX = margin.left * 0.3 + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yLabelY = margin.top + (chartH / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        ctx.translate(yLabelX, yLabelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yAxisLabel, 0, 0);
        ctx.restore();
      }
    }
  }, [facetData, config, colorMap, textureMap, globalYMax, getValue, yAxisLabel, isHierarchical, clusterBy, drawBox]);

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
      const offscreen = document.createElement('canvas');
      const drawScale = exportConfig.scale;

      const baseWidth = 2400;
      const baseHeight = 1600;

      const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
      const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
      const plotWidth = baseWidth * graphScaleX;
      const plotHeight = baseHeight * graphScaleY;

      let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || plotWidth;
      let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || plotHeight;

      offscreen.width = canvasWidth;
      offscreen.height = canvasHeight;

      const ctx = offscreen.getContext('2d');
      if (!ctx) return '';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      renderPlot(ctx, plotWidth, plotHeight, 1, drawScale, exportConfig);

      // Title
      if (exportConfig.showPlotTitle) {
        ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';

        const titleX = (plotWidth / 2) + ((exportConfig.plotTitleX || 0) * drawScale);
        const titleY = (100 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);

        let defaultTitle = `${yAxisLabel} Analysis`;
        if (isHierarchical) {
          defaultTitle += ` (grouped by ${clusterBy})`;
        }

        ctx.fillText(exportConfig.plotTitle || defaultTitle, titleX, titleY);
      }

      return offscreen.toDataURL('image/png');
    };

    return {
      exportImage: () => {
        const defaultExportConfig: ExportConfig = {
          scale: 3, xAxisLabelSize: 96, yAxisLabelSize: 96, tickLabelSize: 64, dataLabelSize: 64,
          showLegend: true, legendTitleSize: 96, legendItemSize: 64,
          showColorLegend: true, colorLegendTitle: 'COLOR',
          showShapeLegend: true, shapeLegendTitle: 'SHAPE',
          showTextureLegend: true, textureLegendTitle: 'TEXTURE',
          showLineTypeLegend: true, lineTypeLegendTitle: 'LINE TYPE',
          showOverlayColorLegend: true, overlayColorLegendTitle: '',
          showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
          showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: '',
        };
        const url = generateImage(defaultExportConfig);
        if (url) {
          const link = document.createElement('a');
          link.download = 'duration_plot.png';
          link.href = url;
          link.click();
        }
      },
      generateImage
    };
  });

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    canvas.style.width = '';
    canvas.style.height = '';
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      renderPlot(ctx, width, height, 1, 1);
      ctx.restore();
    }
  }, [data, config, renderPlot]);

  // Hit test for tooltips
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!config.showDurationPoints) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let closest: SpeechToken | null = null;
    let minDist = 10;

    const width = rect.width;
    const height = rect.height;
    const isSingleFacet = facetData.length <= 1;
    const leftMarginBase = isSingleFacet ? 60 : 40;
    const topMarginBase = isSingleFacet ? 40 : 30;
    const bottomMarginBase = isHierarchical ? 120 : 80;
    const margin = { top: topMarginBase, right: 20, bottom: bottomMarginBase, left: leftMarginBase };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const yMin = 0;
    const yMax = globalYMax;

    if (isSingleFacet) {
      const facet = facetData[0];
      const validGroups = facet.groups.filter(g => g.stats !== null);

      const getClusterKey = (g: GroupData): string => {
        if (clusterBy === config.colorBy) return g.colorKey || '(empty)';
        if (clusterBy === config.textureBy) return g.textureKey || '(empty)';
        return '';
      };

      if (isHierarchical) {
        // Slot-based hit detection matching clustered render layout
        const clusterMap: Record<string, GroupData[]> = {};
        validGroups.forEach(g => {
          const ck = getClusterKey(g);
          if (!clusterMap[ck]) clusterMap[ck] = [];
          clusterMap[ck].push(g);
        });
        const clusterKeysSorted = Object.keys(clusterMap).sort();
        const totalBoxes = validGroups.length;
        const totalSlots = totalBoxes + (clusterKeysSorted.length > 1 ? (clusterKeysSorted.length - 1) * CLUSTER_GAP : 0);
        const slotWidth = totalSlots > 0 ? chartW / totalSlots : chartW;
        const barWidth = Math.min(50, slotWidth * 0.6);
        const mapY = (val: number) => margin.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;

        let slotIndex = 0;
        clusterKeysSorted.forEach((ck, ci) => {
          clusterMap[ck].forEach(g => {
            if (!g.stats) { slotIndex++; return; }
            const xCenter = margin.left + (slotIndex + 0.5) * slotWidth;
            g.stats.tokens.forEach(t => {
              const hash = t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
              const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
              const px = xCenter + jitter;
              const py = mapY(getValue(t));
              const dist = Math.sqrt((px - mouseX) ** 2 + (py - mouseY) ** 2);
              if (dist < minDist) {
                minDist = dist;
                closest = t;
              }
            });
            slotIndex++;
          });
          if (ci < clusterKeysSorted.length - 1) {
            slotIndex += CLUSTER_GAP;
          }
        });
      } else {
        // Flat hit detection
        const spacing = chartW / validGroups.length;
        const barWidth = Math.min(50, spacing * 0.6);
        const mapY = (val: number) => margin.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;

        validGroups.forEach((g, i) => {
          if (!g.stats) return;
          const xCenter = margin.left + (spacing * i) + spacing / 2;
          g.stats.tokens.forEach(t => {
            const hash = t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
            const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
            const px = xCenter + jitter;
            const py = mapY(getValue(t));
            const dist = Math.sqrt((px - mouseX) ** 2 + (py - mouseY) ** 2);
            if (dist < minDist) {
              minDist = dist;
              closest = t;
            }
          });
        });
      }
    }

    setHoveredToken(closest);
  };

  // Tooltip value display
  const tooltipYLabel = (!config.durationYField || config.durationYField === 'duration') ? 'Duration' : config.durationYField.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const tooltipYSuffix = (!config.durationYField || config.durationYField === 'duration') ? 's' : '';

  return (
    <div ref={containerRef} className="w-full h-full relative p-4 bg-white">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredToken(null)}
      />
      {hoveredToken && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
          {hoveredToken.file_id && <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">File ID: {hoveredToken.file_id}</div>}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {config.durationPlotBy && config.durationPlotBy !== 'none' && (
              <p><span className="text-slate-400 font-bold uppercase text-[9px]">{config.durationPlotBy}:</span> {getLabel(hoveredToken, config.durationPlotBy)}</p>
            )}
            {isHierarchical && (
              <p><span className="text-slate-400 font-bold uppercase text-[9px]">{clusterBy}:</span> {getLabel(hoveredToken, clusterBy!)}</p>
            )}
            {config.colorBy && config.colorBy !== 'none' && (
              <p><span className="text-slate-400 font-bold uppercase text-[9px]">{config.colorBy}:</span> {getLabel(hoveredToken, config.colorBy)}</p>
            )}
            {config.textureBy && config.textureBy !== 'none' && (
              <p><span className="text-slate-400 font-bold uppercase text-[9px]">{config.textureBy}:</span> {getLabel(hoveredToken, config.textureBy)}</p>
            )}
            <p className="col-span-2"><span className="text-slate-400 font-bold uppercase text-[9px]">{tooltipYLabel}:</span> {getValue(hoveredToken).toFixed(3)}{tooltipYSuffix}</p>
          </div>
        </div>
      )}
    </div>
  );
});

export default DurationPlot;
