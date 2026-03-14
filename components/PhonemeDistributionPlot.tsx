
import React, { useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig, DatasetMeta } from '../types';
import { generateTexture } from '../utils/textureGenerator';

interface DistributionPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta?: DatasetMeta | null;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
}

interface HistBin {
  x0: number;
  x1: number;
  counts: Record<string, number>;
  total: number;
}

interface HistogramData {
  bins: HistBin[];
  min: number;
  max: number;
  maxY: number;
  binWidth: number;
  categories: string[];
  colors: Record<string, string>;
  totalCount: number;
}

const findNearestTimePoint = (trajectory: { time: number }[], target: number): number | undefined => {
  if (trajectory.length === 0) return undefined;
  const exact = trajectory.find(p => p.time === target);
  if (exact) return target;
  let best = trajectory[0].time;
  let bestDist = Math.abs(best - target);
  for (const p of trajectory) {
    const d = Math.abs(p.time - target);
    if (d < bestDist) { best = p.time; bestDist = d; }
  }
  return best;
};

const FORMANT_VARS = new Set(['f1', 'f2', 'f3', 'f1_smooth', 'f2_smooth', 'f3_smooth']);

/** Returns true if a hex colour is achromatic (R≈G≈B within tolerance 8) */
const isGreyHex = (hex: string): boolean => {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return Math.abs(r - g) <= 8 && Math.abs(r - b) <= 8 && Math.abs(g - b) <= 8;
};

const DIST_LABELS: Record<string, string> = {
  duration: 'Duration (s)',
  f1: 'F1 (Hz)', f2: 'F2 (Hz)', f3: 'F3 (Hz)',
  f1_smooth: 'F1 smooth (Hz)', f2_smooth: 'F2 smooth (Hz)', f3_smooth: 'F3 smooth (Hz)',
};

const prettyLabel = (key: string, meta?: DatasetMeta | null): string => {
  // Built-in labels for formants and duration
  if (DIST_LABELS[key]) return DIST_LABELS[key];
  // Look up user-assigned field name from datasetMeta (covers xmin, custom fields, etc.)
  if (meta) {
    for (const m of meta.columnMappings) {
      if ((m.role === 'field' || m.role === 'pitch') && (m.fieldName === key || m.csvHeader === key))
        return m.fieldName || m.csvHeader;
    }
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626',
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

import { getLabel } from '../utils/getLabel';

const PhonemeDistributionPlot = forwardRef<PlotHandle, DistributionPlotProps>(({ data, config, datasetMeta, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Histogram hover state
  const [hoveredBin, setHoveredBin] = useState<HistBin | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const plotData = useMemo(() => {
    // 1. Group by Top Level (Group By)
    const groups: Record<string, SpeechToken[]> = {};
    data.forEach(t => {
       const gKey = getLabel(t, config.groupBy || 'phoneme') || 'Undefined';
       if (!groups[gKey]) groups[gKey] = [];
       groups[gKey].push(t);
    });
    
    // Sort Groups based on config
    const groupKeys = Object.keys(groups);
    const sortedGroups = groupKeys.sort((a,b) => {
        let cmp = 0;
        if (config.distGroupOrder === 'alpha') {
            cmp = a.localeCompare(b);
        } else {
            // Count
            cmp = groups[a].length - groups[b].length;
        }
        return config.distGroupDir === 'asc' ? cmp : -cmp;
    });

    // 2. Identify Interaction Mode
    const colorKey = config.colorBy !== 'none' ? config.colorBy : 'phoneme'; // Default fallback
    const textureKey = config.textureBy !== 'none' ? config.textureBy : null;
    const isInteraction = textureKey && colorKey !== textureKey;

    // 3. Process Sub-Data
    const processedGroups: Record<string, any> = {};
    const globalColors: Record<string, string> = {};
    const colorDomain = new Set<string>();
    const textureDomain = new Set<string>();
    
    // Counts for Legend
    const colorCounts: Record<string, number> = {};
    const textureCounts: Record<string, number> = {};

    Object.keys(groups).forEach(gKey => {
        const tokens = groups[gKey];
        if (isInteraction) {
            // Nested: Group -> PrimaryVar -> SecondaryVar -> Count
            // distPrimaryVar determines the first level of nesting
            const primaryKey = config.distPrimaryVar === 'texture' ? textureKey! : colorKey;
            const secondaryKey = config.distPrimaryVar === 'texture' ? colorKey : textureKey!;

            const nested: Record<string, Record<string, number>> = {};
            tokens.forEach(t => {
                const pVal = getLabel(t, primaryKey);
                const sVal = getLabel(t, secondaryKey);
                
                if (!nested[pVal]) nested[pVal] = {};
                nested[pVal][sVal] = (nested[pVal][sVal] || 0) + 1;
                
                // Track domains and counts
                if (config.distPrimaryVar === 'texture') {
                    textureDomain.add(pVal);
                    colorDomain.add(sVal);
                    textureCounts[pVal] = (textureCounts[pVal] || 0) + 1;
                    colorCounts[sVal] = (colorCounts[sVal] || 0) + 1;
                } else {
                    colorDomain.add(pVal);
                    textureDomain.add(sVal);
                    colorCounts[pVal] = (colorCounts[pVal] || 0) + 1;
                    textureCounts[sVal] = (textureCounts[sVal] || 0) + 1;
                }
            });
            processedGroups[gKey] = nested;
        } else {
            // Stacked: Group -> ColorVar -> Count
            const counts: Record<string, number> = {};
            tokens.forEach(t => {
                const cVal = getLabel(t, colorKey);
                counts[cVal] = (counts[cVal] || 0) + 1;
                colorDomain.add(cVal);
                colorCounts[cVal] = (colorCounts[cVal] || 0) + 1;
                
                if (config.textureBy === colorKey) textureDomain.add(cVal);
            });
            processedGroups[gKey] = counts;
        }
    });

    const palette = config.bwMode ? ['#333', '#666', '#999'] : COLORS;
    const colorList = Array.from(colorDomain).sort();
    colorList.forEach((c, i) => {
        const ov = styleOverrides?.colors[c];
        globalColors[c] = (ov && (!config.bwMode || isGreyHex(ov))) ? ov : palette[i % palette.length];
    });

    const textureMap: Record<string, number> = {};
    const textureList = Array.from(textureDomain).sort();
    textureList.forEach((t, i) => {
        if (styleOverrides?.textures[t] !== undefined) {
            textureMap[t] = styleOverrides.textures[t];
        } else {
            textureMap[t] = i; // 0..N
        }
    });

    return { groups: sortedGroups, data: processedGroups, colors: globalColors, colorCounts, textureCounts, textureMap, textureList, isInteraction, colorKey, textureKey };
  }, [data, config, styleOverrides]);

  // ── Histogram data pipeline ──
  const getHistValue = useCallback((t: SpeechToken): number => {
    const field = config.distHistXVar || 'duration';
    if (field === 'duration') return t.duration;
    if (field === 'xmin') return t.xmin;
    // Formant variables — extract from trajectory at target timepoint
    if (FORMANT_VARS.has(field)) {
      if (!t.trajectory || t.trajectory.length === 0) return NaN;
      const targetTime = config.distHistTimePoint ?? 50;
      const nearestTime = findNearestTimePoint(t.trajectory, targetTime);
      if (nearestTime === undefined) return NaN;
      const point = t.trajectory.find(p => p.time === nearestTime);
      if (!point) return NaN;
      return (point as any)[field] ?? NaN;
    }
    // Custom fields (stored in token.fields)
    const raw = t.fields?.[field];
    if (raw !== undefined) {
      const num = parseFloat(raw);
      return isNaN(num) ? NaN : num;
    }
    return NaN;
  }, [config.distHistXVar, config.distHistTimePoint]);

  const histogramData = useMemo((): HistogramData | null => {
    if (config.distMode !== 'histogram') return null;

    // 1. Extract numeric values, filter NaN
    const values: { val: number; token: SpeechToken }[] = [];
    data.forEach(t => {
      const val = getHistValue(t);
      if (!isNaN(val) && isFinite(val)) values.push({ val, token: t });
    });

    if (values.length === 0) {
      return { bins: [], min: 0, max: 0, maxY: 0, binWidth: 1, categories: [], colors: {}, totalCount: 0 };
    }

    // 2. Compute range
    let dataMin = Infinity, dataMax = -Infinity;
    values.forEach(v => { if (v.val < dataMin) dataMin = v.val; if (v.val > dataMax) dataMax = v.val; });

    // Single-value edge case
    const min = dataMax === dataMin ? dataMin - 0.5 : dataMin;
    const max = dataMax === dataMin ? dataMax + 0.5 : dataMax;

    const binCount = Math.max(1, config.distHistBinCount || 30);
    const binWidth = (max - min) / binCount;

    // 3. Color categories
    const colorByKey = (config.distHistColorBy && config.distHistColorBy !== 'none') ? config.distHistColorBy : null;
    const categorySet = new Set<string>();

    // 4. Create bins
    const bins: HistBin[] = Array.from({ length: binCount }, (_, i) => ({
      x0: min + i * binWidth,
      x1: min + (i + 1) * binWidth,
      counts: {},
      total: 0,
    }));

    // 5. Assign tokens to bins
    values.forEach(({ val, token }) => {
      let binIdx = Math.floor((val - min) / binWidth);
      if (binIdx >= binCount) binIdx = binCount - 1;
      if (binIdx < 0) binIdx = 0;

      const category = colorByKey ? (getLabel(token, colorByKey) || 'Undefined') : 'all';
      categorySet.add(category);
      bins[binIdx].counts[category] = (bins[binIdx].counts[category] || 0) + 1;
      bins[binIdx].total++;
    });

    // 6. Compute maxY
    const isDensity = config.distHistYMode === 'density';
    const isStacked = config.distHistOverlap === 'stacked' || !colorByKey;
    let maxY = 0;

    bins.forEach(bin => {
      if (isStacked) {
        const stackTotal = isDensity ? bin.total / (values.length * binWidth) : bin.total;
        if (stackTotal > maxY) maxY = stackTotal;
      } else {
        // Overlaid: max of individual categories
        Object.values(bin.counts).forEach(c => {
          const v = isDensity ? c / (values.length * binWidth) : c;
          if (v > maxY) maxY = v;
        });
      }
    });

    // 7. Build color map
    const categories = Array.from(categorySet).sort();
    // B&W palette: wider spread for overlaid mode so overlaps are distinguishable
    const bwOverlaid = config.bwMode && config.distHistOverlap === 'overlaid' && colorByKey;
    const palette = config.bwMode
      ? (bwOverlaid ? ['#b0b0b0', '#404040', '#d0d0d0', '#707070', '#909090'] : ['#525252', '#94a3b8', '#cbd5e1'])
      : COLORS;
    const colors: Record<string, string> = {};
    categories.forEach((c, i) => {
      const ov = styleOverrides?.colors[c];
      colors[c] = (ov && (!config.bwMode || isGreyHex(ov))) ? ov : palette[i % palette.length];
    });

    return { bins, min, max, maxY, binWidth, categories, colors, totalCount: values.length };
  }, [data, config.distMode, config.distHistXVar, config.distHistTimePoint, config.distHistBinCount,
      config.distHistColorBy, config.distHistYMode, config.distHistOverlap,
      config.bwMode, styleOverrides, getHistValue]);

  // ── Histogram rendering helper ──
  const renderHistogram = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    if (!histogramData || histogramData.bins.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${14 / scale}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillText('No numeric data available', width / (2 * scale), height / (2 * scale));
      return;
    }

    const { bins, min, max, maxY, binWidth, categories, colors, totalCount } = histogramData;
    const isExport = !!exportConfig;
    const isDensity = config.distHistYMode === 'density';
    const isOverlaid = config.distHistOverlap === 'overlaid' && categories.length > 1 && categories[0] !== 'all';
    const isStacked = !isOverlaid;
    const hasColor = categories.length > 1 || (categories.length === 1 && categories[0] !== 'all');

    // Margins
    const bottomBase = isExport ? Math.max(120, (exportConfig?.xAxisLabelSize || 36) * 2) : 80;
    const leftBase = isExport ? Math.max(140, (exportConfig?.yAxisLabelSize || 36) * 2) : 70;
    const topBase = isExport && exportConfig?.showPlotTitle ? Math.max(100, (exportConfig.plotTitleSize || 128) + 40) : 40;
    const margin = {
      top: (topBase * drawScale) + ((exportConfig?.graphY || 0) * drawScale),
      right: 30 * drawScale,
      bottom: bottomBase * drawScale,
      left: (leftBase * drawScale) + ((exportConfig?.graphX || 0) * drawScale),
    };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    if (chartW <= 0 || chartH <= 0) return;

    // Nice tick computation for y-axis
    const niceStep = (range: number, targetTicks: number): number => {
      const rough = range / targetTicks;
      const mag = Math.pow(10, Math.floor(Math.log10(rough)));
      const norm = rough / mag;
      let step: number;
      if (norm < 1.5) step = 1;
      else if (norm < 3) step = 2;
      else if (norm < 7) step = 5;
      else step = 10;
      return step * mag;
    };

    // Y-axis setup
    const yMax = maxY > 0 ? maxY * 1.05 : 1; // 5% headroom
    const yStep = niceStep(yMax, 5);
    const mapY = (val: number) => margin.top + chartH - (val / yMax) * chartH;
    const mapX = (val: number) => margin.left + ((val - min) / (max - min)) * chartW;

    // Font sizes
    const tickFont = isExport ? (exportConfig?.tickLabelSize || 32) : 11;
    const labelFont = isExport ? (exportConfig?.xAxisLabelSize || 36) : 13;

    // Grid lines + Y-axis ticks
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#64748b';
    ctx.font = `${(tickFont * drawScale) / scale}px Inter`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let yVal = 0; yVal <= yMax; yVal += yStep) {
      const y = mapY(yVal);
      if (y < margin.top - 5) break;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartW, y);
      ctx.stroke();
      const yTickX = margin.left - (8 * drawScale) + ((exportConfig?.yAxisTickX || 0) * drawScale);
      const yTickY = y + ((exportConfig?.yAxisTickY || 0) * drawScale);
      if (isDensity) {
        ctx.fillText(yVal.toFixed(yVal < 0.01 ? 4 : 2), yTickX, yTickY);
      } else {
        ctx.fillText(Math.round(yVal).toString(), yTickX, yTickY);
      }
    }

    // X-axis ticks
    const xStep = niceStep(max - min, Math.min(10, bins.length));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xTickY = margin.top + chartH + (8 * drawScale) + ((exportConfig?.xAxisTickY || 0) * drawScale);
    for (let xVal = Math.ceil(min / xStep) * xStep; xVal <= max; xVal += xStep) {
      const x = mapX(xVal);
      ctx.beginPath();
      ctx.moveTo(x, margin.top + chartH);
      ctx.lineTo(x, margin.top + chartH + (5 * drawScale));
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      // Smart formatting
      const formatted = Math.abs(xVal) >= 100 ? Math.round(xVal).toString()
        : Math.abs(xVal) >= 1 ? xVal.toFixed(1)
        : xVal.toFixed(3);
      ctx.fillText(formatted, x + ((exportConfig?.xAxisTickX || 0) * drawScale), xTickY);
    }

    // Axis border lines
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = (1.5 * drawScale) / scale;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + chartH);
    ctx.lineTo(margin.left + chartW, margin.top + chartH);
    ctx.stroke();

    // Bar rendering
    const barW = chartW / bins.length;
    const barGap = Math.max(0, Math.min(barW * 0.1, 2 * drawScale)); // small gap between bins

    if (isOverlaid && hasColor) {
      // Draw each category separately with transparency — largest total behind
      const sortedCats = [...categories].sort((a, b) => {
        const sumA = bins.reduce((s, bin) => s + (bin.counts[a] || 0), 0);
        const sumB = bins.reduce((s, bin) => s + (bin.counts[b] || 0), 0);
        return sumB - sumA; // largest first (behind)
      });

      const opacity = config.distHistOpacity ?? 0.6;

      // Pass 1: fill bars with transparency
      sortedCats.forEach(cat => {
        ctx.globalAlpha = opacity;
        bins.forEach((bin, i) => {
          const count = bin.counts[cat] || 0;
          if (count === 0) return;
          const val = isDensity ? count / (totalCount * binWidth) : count;
          const barH = (val / yMax) * chartH;
          const bx = margin.left + i * barW + barGap / 2;
          const by = margin.top + chartH - barH;
          ctx.fillStyle = colors[cat];
          ctx.fillRect(bx, by, barW - barGap, barH);
        });
        ctx.globalAlpha = 1.0;
      });

      // Pass 2: draw border outlines at full opacity so categories remain distinguishable
      ctx.lineWidth = (1.5 * drawScale) / scale;
      sortedCats.forEach(cat => {
        ctx.strokeStyle = colors[cat];
        bins.forEach((bin, i) => {
          const count = bin.counts[cat] || 0;
          if (count === 0) return;
          const val = isDensity ? count / (totalCount * binWidth) : count;
          const barH = (val / yMax) * chartH;
          const bx = margin.left + i * barW + barGap / 2;
          const by = margin.top + chartH - barH;
          ctx.strokeRect(bx, by, barW - barGap, barH);
        });
      });
    } else if (isStacked && hasColor) {
      // Stacked bars
      bins.forEach((bin, i) => {
        let stackY = margin.top + chartH;
        categories.forEach(cat => {
          const count = bin.counts[cat] || 0;
          if (count === 0) return;
          const val = isDensity ? count / (totalCount * binWidth) : count;
          const barH = (val / yMax) * chartH;
          stackY -= barH;
          const bx = margin.left + i * barW + barGap / 2;
          ctx.fillStyle = colors[cat];
          ctx.fillRect(bx, stackY, barW - barGap, barH);
        });
      });
    } else {
      // Single color — no split
      const color = config.bwMode ? '#475569' : '#3b82f6';
      bins.forEach((bin, i) => {
        if (bin.total === 0) return;
        const val = isDensity ? bin.total / (totalCount * binWidth) : bin.total;
        const barH = (val / yMax) * chartH;
        const bx = margin.left + i * barW + barGap / 2;
        const by = margin.top + chartH - barH;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barW - barGap, barH);
      });
    }

    // Axis labels
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${(labelFont * drawScale) / scale}px Inter`;
    ctx.fillText(prettyLabel(config.distHistXVar || 'duration', datasetMeta), margin.left + chartW / 2, margin.top + chartH + (35 * drawScale) + ((exportConfig?.xAxisTickY || 0) * drawScale));

    // Y-axis label
    ctx.save();
    ctx.translate(margin.left - (45 * drawScale) + ((exportConfig?.yAxisLabelX || 0) * drawScale), margin.top + chartH / 2 + ((exportConfig?.yAxisLabelY || 0) * drawScale));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isDensity ? 'Density' : 'Count', 0, 0);
    ctx.restore();

    // Title (export only)
    if (exportConfig?.showPlotTitle && exportConfig.plotTitle) {
      ctx.font = `bold ${(exportConfig.plotTitleSize || 48) * drawScale / scale}px Inter`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.fillText(exportConfig.plotTitle, margin.left + chartW / 2 + ((exportConfig.plotTitleX || 0) * drawScale), (30 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale));
    }

    // n-count label
    if (!isExport) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${(10 * drawScale) / scale}px Inter`;
      ctx.textAlign = 'right';
      ctx.fillText(`n = ${totalCount}`, margin.left + chartW, margin.top - (8 * drawScale));
    }
  }, [histogramData, config]);

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    // ── Histogram mode ──
    if (config.distMode === 'histogram') {
      renderHistogram(ctx, width, height, scale, drawScale, exportConfig);
      return;
    }

    const { groups, data: pData, colors, textureMap, isInteraction } = plotData as any;

    // Dynamic margins based on mode
    const isExport = !!exportConfig;
    const margin = { 
        top: (80 * drawScale) + ((exportConfig?.graphY || 0) * drawScale), 
        right: 40 * drawScale, 
        bottom: (isExport ? 120 : 220) * drawScale, 
        left: ((isExport ? 120 : 200) * drawScale) + ((exportConfig?.graphX || 0) * drawScale)
    };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // 1. Calculate Group Totals
    const groupTotals: Record<string, number> = {};
    groups.forEach((g: string) => {
        let sum = 0;
        if (isInteraction) {
             const nested = pData[g];
             Object.values(nested).forEach((sub: any) => {
                 Object.values(sub).forEach((v: any) => sum += Number(v));
             });
        } else {
             const counts = pData[g];
             sum = Object.values(counts).reduce((a: any,b: any) => a+b, 0) as number;
        }
        groupTotals[g] = sum;
    });

    // 2. Determine Max Y
    let maxY = 0;
    const isPercentage = config.distValueMode === 'percentage';
    const isStacked = config.distBarMode === 'stacked'; 

    // Determine if we should show primary labels (to avoid redundancy)
    const groupKey = config.groupBy || 'phoneme';
    const colorKey = config.colorBy !== 'none' ? config.colorBy : 'phoneme';
    const textureKey = config.textureBy !== 'none' ? config.textureBy : null;
    const primaryKey = config.distPrimaryVar === 'texture' ? textureKey : colorKey;
    const showPrimaryLabel = primaryKey !== groupKey;

    if (isPercentage) {
        maxY = 100;
    } else {
        if (isStacked) {
            // Max of Group Totals
            maxY = Math.max(...Object.values(groupTotals));
        } else {
            // Max of Individual Bars
            groups.forEach((g: string) => {
                if (isInteraction) {
                    const nested = pData[g];
                    Object.values(nested).forEach((sub: any) => {
                        Object.values(sub).forEach((v: any) => { 
                            if (Number(v) > maxY) maxY = Number(v); 
                        });
                    });
                } else {
                    const counts = pData[g];
                    Object.values(counts).forEach((v: any) => {
                        if (Number(v) > maxY) maxY = Number(v);
                    });
                }
            });
        }
    }
    
    if (config.countRange[1] > 0 && !isPercentage) maxY = config.countRange[1];
    if (maxY === 0) maxY = 10;

    const mapY = (val: number, localH: number) => localH - (val / maxY) * localH;

    // Font Sizing Logic
    const axisFont = exportConfig ? exportConfig.tickLabelSize : (isExport ? 32 : 12);
    const subLabelFont = exportConfig ? exportConfig.xAxisLabelSize : (isExport ? 26 : 9);
    const barLabelFont = exportConfig ? exportConfig.dataLabelSize : (isExport ? 24 : 9);
    const groupLabelFont = isExport ? 0 : 10; 

    // Axis Offsets
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale; 

    // Helper to draw a bar
    const drawBar = (bx: number, by: number, bw: number, bh: number, color: string, texIdx: number, val: number, labelVal: string) => {
        const fill = generateTexture(ctx, texIdx, color, '#fff') as string | CanvasPattern;
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1 * drawScale;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);

        // Label
        if (val > 0) {
            ctx.textAlign = 'center';
            if (isExport) {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${(barLabelFont * drawScale) / scale}px Inter`;
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = (3 * drawScale)/scale;
                ctx.lineJoin = 'round';
                const segCenterY = by + bh/2;
                ctx.strokeText(labelVal, bx + bw/2, segCenterY + (barLabelFont * 0.4 * drawScale));
                ctx.fillText(labelVal, bx + bw/2, segCenterY + (barLabelFont * 0.4 * drawScale));
            } else {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${(barLabelFont * drawScale) / scale}px Inter`;
                ctx.strokeStyle = 'black';
                ctx.lineWidth = (2 * drawScale)/scale;
                ctx.strokeText(labelVal, bx + bw/2, by + bh/2 + 4);
                ctx.fillText(labelVal, bx + bw/2, by + bh/2 + 4);
            }
        }
    };

    if (config.separatePlots) {
        // FACETED
        const cols = Math.ceil(Math.sqrt(groups.length));
        const rows = Math.ceil(groups.length / cols);
        const cellW = chartW / cols;
        const cellH = chartH / rows;

        groups.forEach((g: string, i: number) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const pad = 20 * drawScale;
            const cx = margin.left + col * cellW + pad;
            const cy = margin.top + row * cellH + pad;
            const cw = cellW - (pad*2);
            const ch = cellH - (pad*2) - (20 * drawScale);
            const total = groupTotals[g];

            // Baseline
            ctx.beginPath(); ctx.moveTo(cx, cy+ch); ctx.lineTo(cx+cw, cy+ch); 
            ctx.lineWidth = 1 * drawScale; ctx.strokeStyle='#e2e8f0'; ctx.stroke();

            // Label for Cell (Group)
            const showCellLabel = groups.length > 1 || !isInteraction || !showPrimaryLabel;
            if (showCellLabel) {
                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${(exportConfig ? exportConfig.xAxisLabelSize : 12 * drawScale) / scale}px Inter`;
                ctx.textAlign = 'center';
                ctx.fillText(`/${g}/`, cx + cw/2, cy + ch + (subLabelFont * 1.5 * drawScale));
            }

            // Prepare Data for Rendering
            let items: { key: string, val: number, color: string, tex: number, subKey?: string }[] = [];
            
            if (isInteraction) {
                 const nested = pData[g];
                 // nested is now Primary -> Secondary -> Count
                 // distPrimaryVar determines if Primary is Color or Texture
                 const isPrimaryTexture = config.distPrimaryVar === 'texture';

                 // Get Primary Keys and Sort them
                 let pKeys = Object.keys(nested);
                 pKeys.sort((a,b) => {
                     let cmp = 0;
                     if (config.distBarOrder === 'alpha') {
                         cmp = a.localeCompare(b);
                     } else {
                         const sumA = (Object.values(nested[a]) as number[]).reduce((s, n) => s + n, 0);
                         const sumB = (Object.values(nested[b]) as number[]).reduce((s, n) => s + n, 0);
                         cmp = sumA - sumB;
                     }
                     return config.distBarDir === 'asc' ? cmp : -cmp;
                 });

                 // Render Logic for Interaction
                 const numPrimary = pKeys.length;
                 // Calculate width for each Primary Group
                 const primaryGroupW = (cw * 0.9) / numPrimary;
                 const startX = cx + (cw * 0.05);

                 pKeys.forEach((pk, pi) => {
                     const sMap = nested[pk];
                     const sKeys = Object.keys(sMap).sort(); 
                     
                     const stackTotal = (Object.values(sMap) as number[]).reduce((a, b) => a + b, 0);
                     const referenceTotal = (config.distNormalize && isStacked) ? stackTotal : total;
                     
                     const pBx = startX + pi * primaryGroupW;
                     
                     if (isStacked) {
                         // Stacked: One bar per Primary Key, stacked with Secondary Keys
                         const barW = primaryGroupW * 0.7;
                         const bx = pBx + (primaryGroupW - barW)/2;
                         let currentY = cy + ch;
                         
                         sKeys.forEach(sk => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (referenceTotal > 0 ? (val / referenceTotal * 100) : 0) : val;
                             const h = (dispVal / maxY) * ch;
                             const label = isPercentage ? `${dispVal.toFixed(1)}%` : val.toString();
                             
                             currentY -= h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, currentY, barW, h, color, tex, dispVal, label);
                         });

                         // Label for Primary Key
                         if (showPrimaryLabel && barW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }

                     } else {
                         // Grouped: Secondary Keys side-by-side within Primary Key area
                         const barW = (primaryGroupW * 0.9) / sKeys.length;
                         const innerStartX = pBx + (primaryGroupW * 0.05);
                         
                         sKeys.forEach((sk, si) => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (total > 0 ? (val / total * 100) : 0) : val;
                             const h = (dispVal / maxY) * ch;
                             const label = isPercentage ? `${dispVal.toFixed(0)}%` : val.toString();
                             
                             const bx = innerStartX + si * barW;
                             const by = cy + ch - h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, by, barW, h, color, tex, dispVal, label);
                         });

                         // Label for Primary Key (Centered under the group)
                         if (showPrimaryLabel && primaryGroupW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = pBx + primaryGroupW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }
                     }
                 });

            } else {
                 // Standard Mode (Non-Interaction)
                 const counts = pData[g];
                 Object.keys(counts).forEach(k => {
                     items.push({
                         key: k,
                         val: counts[k],
                         color: colors[k] || '#000',
                         tex: config.textureBy !== 'none' ? (textureMap[k] || 0) : 0
                     });
                 });

                 // Sort Items
                 items.sort((a,b) => {
                    // Primary Sort: Bar Order
                    let cmp = 0;
                    if (config.distBarOrder === 'alpha') {
                        cmp = a.key.localeCompare(b.key);
                    } else {
                        cmp = a.val - b.val;
                    }
                    return config.distBarDir === 'asc' ? cmp : -cmp;
                });

                if (isStacked) {
                    // STACKED MODE
                    const barW = cw * 0.6;
                    const bx = cx + (cw - barW)/2;
                    let currentY = cy + ch;

                    items.forEach(item => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * ch;
                        const label = isPercentage ? `${dispVal.toFixed(1)}%` : rawVal.toString();
                        
                        currentY -= h;
                        drawBar(bx, currentY, barW, h, item.color, item.tex, dispVal, label);
                    });

                } else {
                    // GROUPED MODE
                    const barW = (cw * 0.9) / items.length;
                    const startX = cx + (cw * 0.05);

                    items.forEach((item, idx) => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * ch;
                        const label = isPercentage ? `${dispVal.toFixed(0)}%` : rawVal.toString();
                        
                        const bx = startX + idx * barW;
                        const by = cy + ch - h;
                        
                        drawBar(bx, by, barW, h, item.color, item.tex, dispVal, label);
                    });
                }
            }
        });

    } else {
        // COMBINED (Main Large Plot)
        ctx.strokeStyle = '#e2e8f0';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#64748b';
        ctx.font = `${(axisFont * drawScale)/scale}px Inter`;
        ctx.lineWidth = 1 * drawScale;
        
        // Y Axis Ticks
        for(let i=0; i<=5; i++) {
            const val = maxY * (i/5);
            const y = margin.top + mapY(val, chartH);
            ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + chartW, y); ctx.stroke();
            const label = isPercentage ? `${Math.round(val)}%` : Math.round(val).toString();
            ctx.fillText(label, margin.left - (15 * drawScale) + yTickOffsetX, y + (5 * drawScale) + yTickOffsetY);
        }

        const cfgGroupGap = (config.distGroupGap || 0) * drawScale;
        const cfgBarWidth = (config.distBarWidth || 0) * drawScale;
        const cfgBarGap = (config.distBarGap || 0) * drawScale;
        const totalGroupGaps = (groups.length > 1 ? (groups.length - 1) * cfgGroupGap : 0);
        const groupW = (chartW - totalGroupGaps) / groups.length;

        groups.forEach((g: string, i: number) => {
             const cx = margin.left + i * (groupW + cfgGroupGap);
             const total = groupTotals[g];
             
             // Prepare Data
             let items: { key: string, val: number, color: string, tex: number, subKey?: string }[] = [];
             
             if (isInteraction) {
                 const nested = pData[g];
                 // nested is Primary -> Secondary -> Count
                 const isPrimaryTexture = config.distPrimaryVar === 'texture';

                 // Get Primary Keys and Sort them
                 let pKeys = Object.keys(nested);
                 pKeys.sort((a,b) => {
                     let cmp = 0;
                     if (config.distBarOrder === 'alpha') {
                         cmp = a.localeCompare(b);
                     } else {
                         const sumA = (Object.values(nested[a]) as number[]).reduce((s, n) => s + n, 0);
                         const sumB = (Object.values(nested[b]) as number[]).reduce((s, n) => s + n, 0);
                         cmp = sumA - sumB;
                     }
                     return config.distBarDir === 'asc' ? cmp : -cmp;
                 });

                 // Render Logic for Interaction
                 const numPrimary = pKeys.length;
                 const totalInnerGaps = (numPrimary > 1 ? (numPrimary - 1) * cfgBarGap : 0);
                 const primaryGroupW = (groupW * 0.9 - totalInnerGaps) / numPrimary;
                 const startX = cx + (groupW * 0.05);

                 pKeys.forEach((pk, pi) => {
                     const sMap = nested[pk];
                     const sKeys = Object.keys(sMap).sort(); 
                     
                     const stackTotal = (Object.values(sMap) as number[]).reduce((a, b) => a + b, 0);
                     const referenceTotal = (config.distNormalize && isStacked) ? stackTotal : total;

                     const pBx = startX + pi * (primaryGroupW + cfgBarGap);

                     if (isStacked) {
                         const barW = cfgBarWidth > 0 ? Math.min(cfgBarWidth, primaryGroupW * 0.95) : primaryGroupW * 0.7;
                         const bx = pBx + (primaryGroupW - barW)/2;
                         let currentY = margin.top + chartH;
                         
                         sKeys.forEach(sk => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (referenceTotal > 0 ? (val / referenceTotal * 100) : 0) : val;
                             const h = (dispVal / maxY) * chartH;
                             const label = isPercentage ? `${dispVal.toFixed(1)}%` : val.toString();
                             
                             currentY -= h;
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             drawBar(bx, currentY, barW, h, color, tex, dispVal, label);
                         });
                         
                         // Label for Primary Key
                         if (showPrimaryLabel && barW > (15 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }

                     } else {
                         const barW = cfgBarWidth > 0 ? Math.min(cfgBarWidth, (primaryGroupW * 0.9) / sKeys.length) : (primaryGroupW * 0.9) / sKeys.length;
                         const innerStartX = pBx + (primaryGroupW * 0.05);
                         
                         sKeys.forEach((sk, si) => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (total > 0 ? (val / total * 100) : 0) : val;
                             const h = (dispVal / maxY) * chartH;
                             const label = isPercentage ? `${dispVal.toFixed(0)}%` : val.toString();
                             
                             const bx = innerStartX + si * barW;
                             const by = margin.top + chartH - h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, by, barW, h, color, tex, dispVal, label);
                         });

                         if (showPrimaryLabel && primaryGroupW > (15 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = pBx + primaryGroupW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }
                     }
                 });

            } else {
                 const counts = pData[g];
                 Object.keys(counts).forEach(k => {
                     items.push({
                         key: k,
                         val: counts[k],
                         color: colors[k] || '#000',
                         tex: config.textureBy !== 'none' ? (textureMap[k] || 0) : 0
                     });
                 });

                 // Sort Items
                 items.sort((a,b) => {
                    // Primary Sort: Bar Order
                    let cmp = 0;
                    if (config.distBarOrder === 'alpha') {
                        cmp = a.key.localeCompare(b.key);
                    } else {
                        cmp = a.val - b.val;
                    }
                    return config.distBarDir === 'asc' ? cmp : -cmp;
                });

                if (isStacked) {
                    // STACKED MODE
                    const barW = cfgBarWidth > 0 ? Math.min(cfgBarWidth, groupW * 0.95) : groupW * 0.6;
                    const bx = cx + (groupW - barW)/2;
                    let currentY = margin.top + chartH;

                    items.forEach(item => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * chartH;
                        const label = isPercentage ? `${dispVal.toFixed(1)}%` : rawVal.toString();
                        
                        currentY -= h;
                        drawBar(bx, currentY, barW, h, item.color, item.tex, dispVal, label);
                    });

                } else {
                    // GROUPED MODE
                    const innerGaps = (items.length > 1 ? (items.length - 1) * cfgBarGap : 0);
                    const barW = cfgBarWidth > 0 ? Math.min(cfgBarWidth, (groupW * 0.9 - innerGaps) / items.length) : (groupW * 0.9 - innerGaps) / items.length;
                    const startX = cx + (groupW * 0.05);

                    items.forEach((item, idx) => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * chartH;
                        const label = isPercentage ? `${dispVal.toFixed(0)}%` : rawVal.toString();
                        
                        const bx = startX + idx * (barW + cfgBarGap);
                        const by = margin.top + chartH - h;

                        drawBar(bx, by, barW, h, item.color, item.tex, dispVal, label);

                        // Sub-label for grouped items (only if enough space)
                        if (barW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(item.subKey || item.key, labelX, labelY);
                        }
                    });
                }
            }

             // Group Label
             const showGroupLabel = groups.length > 1 || !isInteraction || !showPrimaryLabel;
             if (showGroupLabel && (!isExport || isStacked)) { 
                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${(groupLabelFont * drawScale) / scale}px Inter`;
                ctx.textAlign = 'center';
                const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + (groupLabelFont * 1.5 * drawScale) + xTickOffsetY;
                const finalY = isStacked ? labelY - (subLabelFont * drawScale) : labelY;
                ctx.fillText(`/${g}/`, cx + groupW/2, finalY);
             }
        });
    }

  }, [plotData, config, renderHistogram]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    // Histogram mode legend
    if (config.distMode === 'histogram' && histogramData) {
      if (!histogramData.categories.length || histogramData.categories[0] === 'all') return;
      const titleSize = exportConfig ? exportConfig.legendTitleSize : 16;
      const itemSize = exportConfig ? exportConfig.legendItemSize : 14;
      const spacing = (itemSize * 1.6) * drawScale;
      const boxSize = (itemSize * 0.8) * drawScale;
      let curY = y;

      ctx.font = `bold ${(titleSize * drawScale)}px Inter`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText((config.distHistColorBy || 'COLOR').toUpperCase(), x, curY);
      curY += (titleSize * 1.4) * drawScale;

      ctx.font = `${(itemSize * drawScale)}px Inter`;
      const isOverlaidExport = config.distHistOverlap === 'overlaid' && histogramData.categories.length > 1;
      const swatchOpacityExport = isOverlaidExport ? (config.distHistOpacity ?? 0.6) : 1;
      histogramData.categories.forEach(cat => {
        // Draw swatch at same opacity as bars for visual consistency
        ctx.globalAlpha = swatchOpacityExport;
        ctx.fillStyle = histogramData.colors[cat];
        ctx.fillRect(x, curY - boxSize / 2, boxSize, boxSize);
        ctx.globalAlpha = 1.0;
        // Border around swatch at full opacity
        ctx.strokeStyle = histogramData.colors[cat];
        ctx.lineWidth = 1 * drawScale;
        ctx.strokeRect(x, curY - boxSize / 2, boxSize, boxSize);
        ctx.fillStyle = '#334155';
        const count = histogramData.bins.reduce((s, b) => s + (b.counts[cat] || 0), 0);
        ctx.fillText(`${cat} (n=${count})`, x + boxSize * 1.5, curY);
        curY += spacing;
      });
      return;
    }

    // Counts mode legend
    const { colors, textureList, textureMap, isInteraction, colorKey, textureKey, colorCounts, textureCounts } = plotData;
    let curY = y;
    const isExport = !!exportConfig;

    // If custom position, override x and y
    if (exportConfig && exportConfig.legendPosition === 'custom') {
        // Handled by translation in generateImage
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    
    // Dynamic Font Sizes
    const titleSize = exportConfig ? exportConfig.legendTitleSize : (isExport ? 36 : 16);
    const itemSize = exportConfig ? exportConfig.legendItemSize : (isExport ? 24 : 14);
    
    const spacing = (itemSize * 1.6) * drawScale; 
    const boxSize = (itemSize * 0.8) * drawScale;

    // Determine legend visibility and titles from per-layer config or fallback to old fields
    const layerLegendCfg = exportConfig?.layerLegends?.find(ll => ll.layerId === 'bg');
    const showColor = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showColorLegend !== false);
    const colorLegendTitle = (layerLegendCfg?.colorTitle) || (exportConfig?.colorLegendTitle) || (colorKey ? colorKey.toUpperCase() : 'COLOR');
    const showTexture = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showTextureLegend !== false);
    const textureLegendTitle = (layerLegendCfg?.textureTitle) || (exportConfig?.textureLegendTitle) || (textureKey ? textureKey.toUpperCase() : 'PATTERN');

    const legendLayerIds = exportConfig?.legendLayers;
    const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');

    // 1. Color Legend
    if (isInLegend && showColor && colorKey) {
        ctx.font = `bold ${(titleSize * drawScale)}px Inter`;
        ctx.fillText(colorLegendTitle, x, curY);
        curY += (titleSize * 1.4) * drawScale;

        ctx.font = `${(itemSize * drawScale)}px Inter`;
        Object.entries(colors).forEach(([key, color]) => {
                const count = colorCounts[key] || 0;
                ctx.fillStyle = color as string;
                ctx.fillRect(x, curY, boxSize, boxSize);
                ctx.fillStyle = '#334155';
                ctx.fillText(`${key} (n=${count})`, x + (boxSize * 1.5), curY + (boxSize/2));
                curY += spacing;
        });
        curY += (titleSize) * drawScale;
    }

    // 2. Texture Legend
    if (isInLegend && showTexture && isInteraction && textureKey) {
        ctx.font = `bold ${(titleSize * drawScale)}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(textureLegendTitle, x, curY);
        curY += (titleSize * 1.4) * drawScale;

        ctx.font = `${(itemSize * drawScale)}px Inter`;

        textureList.forEach((tk: string) => {
             const idx = textureMap[tk];
             const count = textureCounts[tk] || 0;
             const pat = generateTexture(ctx, idx, '#475569', '#fff') as string | CanvasPattern;
             ctx.fillStyle = pat;
             ctx.fillRect(x, curY, boxSize, boxSize);
             ctx.strokeStyle = '#cbd5e1';
             ctx.strokeRect(x, curY, boxSize, boxSize);

             ctx.fillStyle = '#334155';
             ctx.fillText(`${tk} (n=${count})`, x + (boxSize * 1.5), curY + (boxSize/2));
             curY += spacing;
        });
    }
  };

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
       const offscreen = document.createElement('canvas');
       const drawScale = exportConfig.scale;
       
       // Base dimensions
       const baseWidth = 2400;
       const baseHeight = 1600;

       // Apply Graph Geometry
       const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
       const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
       const plotW = baseWidth * graphScaleX;
       const plotH = baseHeight * graphScaleY;
       
       // Dynamic margins based on font sizes
       const bottomMarginBase = Math.max(180, exportConfig.xAxisLabelSize * 1.5 + 30);
       const leftMarginBase = Math.max(140, exportConfig.yAxisLabelSize * 1.2 + 40);
       const topMarginBase = exportConfig.showPlotTitle
           ? Math.max(200, (exportConfig.plotTitleSize || 128) + 100)
           : Math.max(80, exportConfig.tickLabelSize + 20);
       const margin = {
           top: (topMarginBase * drawScale) + ((exportConfig.graphY || 0) * drawScale),
           right: 60 * drawScale,
           bottom: bottomMarginBase * drawScale,
           left: (leftMarginBase * drawScale) + ((exportConfig.graphX || 0) * drawScale)
       };
       
       // Legend Calculation
       let legendW = 0;
       let lx = 0;
       let ly = 0;

       if (exportConfig.showLegend) {
           const legendSpace = Math.max(800, exportConfig.legendItemSize * 15, exportConfig.legendTitleSize * 10);
           if (exportConfig.legendPosition === 'right') {
               legendW = legendSpace * drawScale;
               lx = margin.left + plotW + (80 * drawScale);
               ly = margin.top + (50 * drawScale);
           } else if (exportConfig.legendPosition === 'bottom') {
               lx = margin.left;
               ly = margin.top + plotH + (100 * drawScale);
           } else if (exportConfig.legendPosition === 'inside-top-right') {
               lx = margin.left + plotW - (300 * drawScale); 
               ly = margin.top + (40 * drawScale);
           } else if (exportConfig.legendPosition === 'inside-top-left') {
               lx = margin.left + (40 * drawScale);
               ly = margin.top + (40 * drawScale);
           } else if (exportConfig.legendPosition === 'custom') {
               lx = (Number(exportConfig.legendX) || 0) * drawScale;
               ly = (Number(exportConfig.legendY) || 0) * drawScale;
           }
       }
       
       let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || (margin.left + plotW + margin.right);
       let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || (margin.top + plotH + margin.bottom);

       if (!exportConfig.canvasWidth && exportConfig.showLegend && exportConfig.legendPosition === 'right') {
           canvasWidth += legendW;
       }
       
       offscreen.width = canvasWidth;
       offscreen.height = canvasHeight;
       
       const ctx = offscreen.getContext('2d');
       if(ctx) {
           ctx.fillStyle = '#fff'; ctx.fillRect(0,0,offscreen.width, offscreen.height);
           
           ctx.save();
           // Translate for plot rendering area
           ctx.translate(margin.left, margin.top);
           renderPlot(ctx, plotW, plotH, 1, drawScale, exportConfig);
           
           // Title
           if (exportConfig.showPlotTitle) {
               ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter`;
               ctx.fillStyle = '#0f172a';
               ctx.textAlign = 'center';
               
               const titleX = (plotW/2) + ((exportConfig.plotTitleX || 0) * drawScale);
               const titleY = (40 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);
               
               ctx.fillText(exportConfig.plotTitle, titleX, titleY);
           }
           
           ctx.restore();

           if (exportConfig.showLegend) {
               ctx.save();
               
               if (exportConfig.legendPosition === 'right') {
                   // Draw divider line only for right legend
                   ctx.beginPath(); 
                   ctx.moveTo(margin.left + plotW + (40 * drawScale), margin.top); 
                   ctx.lineTo(margin.left + plotW + (40 * drawScale), margin.top + plotH); 
                   ctx.strokeStyle = '#e2e8f0'; 
                   ctx.lineWidth = 2 * drawScale;
                   ctx.stroke();
               }
               
               // Draw Legend
               ctx.translate(lx, ly);
               drawLegend(ctx, 0, 0, legendW, drawScale, exportConfig);
               ctx.restore();
           }
           return offscreen.toDataURL();
       }
       return '';
    };

    return {
        exportImage: () => {
            // Legacy support
            const defaultExportConfig: ExportConfig = {
                scale: 3, 
                xAxisLabelSize: 96, yAxisLabelSize: 96,
                tickLabelSize: 64, dataLabelSize: 64,
                showLegend: true, legendTitleSize: 96, legendItemSize: 64,
                showColorLegend: true, colorLegendTitle: config.colorBy.toUpperCase(),
                showShapeLegend: true, shapeLegendTitle: '',
                showTextureLegend: true, textureLegendTitle: '',
                showLineTypeLegend: true, lineTypeLegendTitle: '',
                showOverlayColorLegend: true, overlayColorLegendTitle: '',
                showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
                showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: ''
            };
            const url = generateImage(defaultExportConfig);
            if(url) {
                const link = document.createElement('a');
                link.download = 'dist_plot.png';
                link.href = url;
                link.click();
            }
        },
        generateImage
    };
  });

  // ... (rest of the file remains unchanged)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.save();
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        renderPlot(ctx, width, height, 1, 1);
        ctx.restore();
    }
  }, [plotData, config, renderPlot]);

  const handleLegendClickWrapper = (category: string, type: 'color'|'texture', event: React.MouseEvent) => {
      if (onLegendClick) {
          const { colors, textureMap } = plotData as any;
          const currentStyles = {
              color: type === 'color' ? (colors[category] || '#000') : '#000',
              shape: 'circle',
              texture: type === 'texture' ? (textureMap[category] || 0) : 0,
              lineType: 'solid'
          };
          onLegendClick(category, currentStyles, event);
      }
  };

  const renderScreenLegend = () => {
    // Histogram mode legend
    if (config.distMode === 'histogram') {
      if (!histogramData || !histogramData.categories.length || histogramData.categories[0] === 'all') return null;
      const isOverlaid = config.distHistOverlap === 'overlaid' && histogramData.categories.length > 1;
      const swatchOpacity = isOverlaid ? (config.distHistOpacity ?? 0.6) : 1;
      return (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-48 pointer-events-auto">
          <div className="space-y-1">
            <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{config.distHistColorBy}</h4>
            {histogramData.categories.map(cat => {
              const count = histogramData.bins.reduce((s, b) => s + (b.counts[cat] || 0), 0);
              return (
                <div key={cat} className="flex items-center gap-2 justify-between p-1 rounded hover:bg-slate-100 cursor-pointer" onClick={(e) => onLegendClick?.(cat, { color: histogramData.colors[cat], shape: 'circle', texture: 0, lineType: 'solid' }, e)}>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm border border-slate-200" style={{ backgroundColor: histogramData.colors[cat], opacity: swatchOpacity }}></div>
                    <span>{cat}</span>
                  </div>
                  <span className="text-slate-400 text-[10px] font-mono">({count})</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Counts mode legend — hide when no data
    if (!data.length) return null;
    const { colors, textureList, textureMap, isInteraction, colorKey, textureKey, colorCounts, textureCounts } = plotData as any;
    if (!colorKey && !textureKey) return null;
    return (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-48 pointer-events-auto">
            {colorKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{colorKey}</h4>
                    {Object.entries(colors).map(([k, c]) => (
                        <div key={k} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(k, 'color', e)}>
                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{backgroundColor: c as string}}></div><span>{k}</span></div>
                            <span className="text-slate-400 text-[10px] font-mono">({colorCounts[k] || 0})</span>
                        </div>
                    ))}
                </div>
            )}
            {isInteraction && textureKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{textureKey}</h4>
                    {textureList.map((t: string) => {
                        const idx = textureMap[t];
                        return (
                            <div key={t} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(t, 'texture', e)}>
                                <div className="flex items-center gap-2"><PatternPreview index={idx} color="#475569" /><span>{t}</span></div>
                                <span className="text-slate-400 text-[10px] font-mono">({textureCounts[t] || 0})</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    );
  };

  // ── Histogram mouse handlers ──
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (config.distMode !== 'histogram' || !histogramData || !containerRef.current) {
      if (hoveredBin) setHoveredBin(null);
      return;
    }
    const cr = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - cr.left;
    const my = e.clientY - cr.top;
    setMousePos({ x: mx, y: my });

    const { width, height } = cr;
    const isExport = false;
    const bottomBase = 80;
    const leftBase = 70;
    const margin = { top: 40, right: 30, bottom: bottomBase, left: leftBase };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const binW = chartW / histogramData.bins.length;
    const binIdx = Math.floor((mx - margin.left) / binW);

    if (binIdx >= 0 && binIdx < histogramData.bins.length &&
        mx >= margin.left && mx <= margin.left + chartW &&
        my >= margin.top && my <= margin.top + chartH) {
      setHoveredBin(histogramData.bins[binIdx]);
    } else {
      setHoveredBin(null);
    }
  }, [config.distMode, histogramData, hoveredBin]);

  const handleMouseLeave = useCallback(() => {
    setHoveredBin(null);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative p-4 bg-white">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {renderScreenLegend()}

      {/* Histogram tooltip */}
      {hoveredBin && config.distMode === 'histogram' && (
        <div
          className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 border border-slate-700 backdrop-blur-md space-y-1 min-w-[160px]"
          style={{
            left: Math.min(mousePos.x + 16, (containerRef.current?.clientWidth || 400) - 200),
            top: Math.max(mousePos.y - 16, 8),
          }}
        >
          <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">
            {hoveredBin.x0.toFixed(3)} – {hoveredBin.x1.toFixed(3)}
          </div>
          {Object.entries(hoveredBin.counts).length > 1 ? (
            <>
              {Object.entries(hoveredBin.counts).sort(([,a],[,b]) => (b as number) - (a as number)).map(([cat, count]) => (
                <div key={cat} className="flex justify-between gap-4">
                  <span className="text-slate-300">{cat}</span>
                  <span className="font-mono font-bold">{count}</span>
                </div>
              ))}
              <div className="border-t border-slate-700 pt-1 flex justify-between gap-4">
                <span className="text-slate-400 font-bold">Total</span>
                <span className="font-mono font-bold">{hoveredBin.total}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Count</span>
              <span className="font-mono font-bold">{hoveredBin.total}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const PatternPreview = ({index, color}: {index:number, color:string}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if(canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if(ctx) {
                const pat = generateTexture(ctx, index, color, '#fff') as string | CanvasPattern;
                ctx.fillStyle = pat;
                ctx.fillRect(0,0,12,12);
                ctx.strokeStyle = '#cbd5e1';
                ctx.strokeRect(0,0,12,12);
            }
        }
    }, [index, color]);
    return <canvas ref={canvasRef} width={12} height={12} className="rounded-sm" />;
}

export default PhonemeDistributionPlot;
