
import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig, DatasetMeta, StyleOverrides } from '../types';
import { generateTexture } from '../utils/textureGenerator';
import { getLabel } from '../utils/getLabel';

interface DurationPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: { color: string, shape: string, texture: number, lineType: string }, event: React.MouseEvent) => void;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626'
];

const DEFAULT_CLUSTER_GAP = 1.5; // gap between clusters in slot units

/** Returns true if a hex colour is achromatic (R≈G≈B within tolerance 8) */
const isGreyHex = (hex: string): boolean => {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return Math.abs(r - g) <= 8 && Math.abs(r - b) <= 8 && Math.abs(g - b) <= 8;
};

const FORMANT_VARS = new Set(['f1', 'f2', 'f3', 'f1_smooth', 'f2_smooth', 'f3_smooth']);

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

// Hex colour → r,g,b string for rgba()
const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
};

// Tooltip field labels (fallback only — datasetMeta lookup is preferred)
const DURATION_TOOLTIP_LABELS: Record<string, string> = {
  file_id: 'File ID', duration: 'Duration', speaker: 'Speaker', word: 'Word',
  canonical: 'Canonical', produced: 'Produced',
  phoneme: 'Phoneme', type: 'Type', alignment: 'Alignment',
  vowel_category: 'Vowel Category', stress: 'Stress',
};

const getTooltipValue = (token: SpeechToken, field: string, getValue: (t: SpeechToken) => number): string => {
  if (field === 'duration') return `${getValue(token).toFixed(3)}s`;
  if (field === 'xmin') return token.xmin ? `${token.xmin.toFixed(3)}s` : '';
  if (field === 'file_id') return token.file_id || '';
  if (field === 'speaker') return token.speaker || '';
  // Check built-in fields object
  if (token.fields[field] !== undefined) return token.fields[field];
  // Fallback to getLabel
  return getLabel(token, field) || '';
};

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

// Box sorting helper
const sortGroups = (groups: GroupData[], order: string, dir: string, centerLine: string) => {
  const sorted = [...groups];
  if (order === 'central') {
    sorted.sort((a, b) => {
      const aVal = centerLine === 'mean' ? a.stats!.mean : a.stats!.median;
      const bVal = centerLine === 'mean' ? b.stats!.mean : b.stats!.median;
      return dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  } else {
    sorted.sort((a, b) => dir === 'asc' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key));
  }
  return sorted;
};

const DurationPlot = forwardRef<PlotHandle, DurationPlotProps>(({ data, config, datasetMeta, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });

  // Zoom/pan transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Generalized Y-axis value extractor
  const getValue = useCallback((t: SpeechToken): number => {
    const field = config.durationYField || 'duration';
    if (field === 'duration') return t.duration;
    if (field === 'xmin') return t.xmin;
    // Formant variables — extract from trajectory at target timepoint
    if (FORMANT_VARS.has(field)) {
      if (!t.trajectory || t.trajectory.length === 0) return NaN;
      const targetTime = config.durationFormantTimePoint ?? 50;
      const nearestTime = findNearestTimePoint(t.trajectory, targetTime);
      if (nearestTime === undefined) return NaN;
      const point = t.trajectory.find(p => p.time === nearestTime);
      if (!point) return NaN;
      return (point as any)[field] ?? NaN;
    }
    // Custom fields
    const raw = t.fields[field];
    return raw !== undefined ? parseFloat(raw) : NaN;
  }, [config.durationYField, config.durationFormantTimePoint]);

  // Y-axis label — use user's field name from datasetMeta when available
  const yAxisLabel = useMemo(() => {
    const field = config.durationYField || 'duration';
    if (field === 'duration') return 'Duration (s)';
    if (FORMANT_VARS.has(field)) {
      const tp = config.durationFormantTimePoint ?? 50;
      const name = field.replace('_smooth', ' smooth').toUpperCase().replace(' SMOOTH', ' (smooth)');
      return `${name} @ ${tp}% (Hz)`;
    }
    // Look up user-assigned field name from datasetMeta
    if (datasetMeta) {
      for (const m of datasetMeta.columnMappings) {
        if ((m.role === 'field' || m.role === 'pitch') && (m.fieldName === field || m.csvHeader === field))
          return m.fieldName || m.csvHeader;
      }
    }
    return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, [config.durationYField, config.durationFormantTimePoint, datasetMeta]);

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

    // Build color map (with styleOverride support)
    const cMap: Record<string, string> = {};
    if (hasColor) {
      allColorValues.forEach((v, i) => { const ov = styleOverrides?.colors[v]; cMap[v] = (ov && (!config.bwMode || isGreyHex(ov))) ? ov : palette[i % palette.length]; });
    }

    // Build texture map (index-based, with styleOverride support)
    const tMap: Record<string, number> = {};
    if (hasTexture) {
      allTextureValues.forEach((v, i) => {
        tMap[v] = styleOverrides?.textures[v] !== undefined ? styleOverrides.textures[v] : i;
      });
    }

    // 3. For each facet, split into sub-groups
    const facets: FacetData[] = facetKeys.map(fKey => {
      const tokens = facetGroups[fKey];
      const groups: GroupData[] = [];

      if (hasColor && hasTexture) {
        allColorValues.forEach(cv => {
          allTextureValues.forEach(tv => {
            const subset = tokens.filter(t =>
              (getLabel(t, config.colorBy) || '(empty)') === cv &&
              (getLabel(t, config.textureBy!) || '(empty)') === tv
            );
            groups.push({ key: `${cv} / ${tv}`, colorKey: cv, textureKey: tv, stats: calculateStats(subset, getValue) });
          });
        });
      } else if (hasColor) {
        allColorValues.forEach(cv => {
          const subset = tokens.filter(t => (getLabel(t, config.colorBy) || '(empty)') === cv);
          groups.push({ key: cv, colorKey: cv, textureKey: '', stats: calculateStats(subset, getValue) });
        });
      } else if (hasTexture) {
        allTextureValues.forEach(tv => {
          const subset = tokens.filter(t => (getLabel(t, config.textureBy!) || '(empty)') === tv);
          groups.push({ key: tv, colorKey: '', textureKey: tv, stats: calculateStats(subset, getValue) });
        });
      } else {
        groups.push({ key: fKey === 'All' ? 'All' : fKey, colorKey: '', textureKey: '', stats: calculateStats(tokens, getValue) });
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
  }, [data, config.durationPlotBy, config.colorBy, config.textureBy, config.bwMode, config.durationRange, getValue, styleOverrides]);

  // Helper: draw a single box (whiskers, quartile box, center diamond, outliers, jitter points)
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

    // Center diamond — always shown, tracks whichever center line is selected
    const centerDiamondVal = config.durationCenterLine === 'mean' ? s.mean : s.median;
    const yDiamond = mapY(centerDiamondVal);
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.beginPath();
    ctx.moveTo(xCenter, yDiamond - (4 * drawScale));
    ctx.lineTo(xCenter + (4 * drawScale), yDiamond);
    ctx.lineTo(xCenter, yDiamond + (4 * drawScale));
    ctx.lineTo(xCenter - (4 * drawScale), yDiamond);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

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

    // Jitter points — coloured to match box
    if (config.showDurationPoints) {
      const ptColor = color;
      const opacity = config.pointOpacity ?? 0.5;
      s.tokens.forEach(t => {
        const hash = t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
        const px = xCenter + jitter;
        const py = mapY(getValue(t));
        ctx.beginPath();
        ctx.arc(px, py, 2 * drawScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${hexToRgb(ptColor)},${opacity})`;
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

    // Configurable box widths and gaps
    const clusterGap = config.durationGroupGap ?? DEFAULT_CLUSTER_GAP;
    const boxGapRatio = config.durationBoxGap ?? 0.4; // additional slot units between boxes (0 = no gap, higher = wider gap)
    const configBoxWidth = (config.durationBoxWidth ?? 0) * drawScale; // 0 = auto

    // Determine if we should rotate labels (check longest label length)
    const allValidGroups = facetData.flatMap(f => f.groups.filter(g => g.stats !== null));
    const allLabels = isHierarchical
      ? allValidGroups.map(g => getInnerLabel(g))
      : allValidGroups.map(g => g.key);
    const maxLabelLen = Math.max(0, ...allLabels.map(l => l.length));
    const shouldRotateLabels = isExport ? maxLabelLen > 6 : maxLabelLen > 8;
    const labelRotation = shouldRotateLabels ? -Math.PI / 4 : 0;

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

      // Font for box labels (data labels) and group labels (x-axis labels)
      const dataLabelFont = exportConfig ? exportConfig.dataLabelSize : labelFont;
      const xAxisFont = exportConfig ? exportConfig.xAxisLabelSize : (labelFont * 1.15);

      if (isHierarchical) {
        // === Clustered layout ===
        const clusterMap: Record<string, GroupData[]> = {};
        validGroups.forEach(g => {
          const ck = getClusterKey(g);
          if (!clusterMap[ck]) clusterMap[ck] = [];
          clusterMap[ck].push(g);
        });
        const clusterKeys = Object.keys(clusterMap).sort();

        // Sort boxes WITHIN each cluster (not the clusters themselves)
        clusterKeys.forEach(ck => {
          clusterMap[ck] = sortGroups(clusterMap[ck], config.durationBoxOrder, config.durationBoxDir, config.durationCenterLine);
        });

        const totalBoxes = validGroups.length;
        // Count inner gaps (between boxes within each cluster)
        let totalInnerGaps = 0;
        clusterKeys.forEach(ck => { totalInnerGaps += clusterMap[ck].length - 1; });
        const totalSlots = totalBoxes + totalInnerGaps * boxGapRatio + (clusterKeys.length > 1 ? (clusterKeys.length - 1) * clusterGap : 0);
        const slotWidth = totalSlots > 0 ? fw / totalSlots : fw;
        const barWidth = configBoxWidth > 0 ? Math.min(configBoxWidth, slotWidth * 0.95) : Math.min(50 * drawScale, slotWidth * 0.8);

        let slotIndex = 0;
        clusterKeys.forEach((ck, ci) => {
          const clusterStartSlot = slotIndex;
          const clusterGroups = clusterMap[ck];

          clusterGroups.forEach((g, gi) => {
            const xCenter = fx + (slotIndex + 0.5) * slotWidth;
            drawBox(ctx, g, xCenter, barWidth, mapY, scale, drawScale);

            // Box label (data label) — inner label
            ctx.fillStyle = '#0f172a';
            ctx.font = `${(dataLabelFont * drawScale) / scale}px Inter`;
            const xLabelX = xCenter + xTickOffsetX;
            const xLabelY = fy + fh + (20 * drawScale) + xTickOffsetY;

            if (shouldRotateLabels) {
              ctx.save();
              ctx.translate(xLabelX, xLabelY);
              ctx.rotate(labelRotation);
              ctx.textAlign = 'right';
              ctx.fillText(getInnerLabel(g), 0, 0);
              ctx.restore();
            } else {
              ctx.textAlign = 'center';
              ctx.fillText(getInnerLabel(g), xLabelX, xLabelY);
            }

            // n-count below box label (only on screen, not in export — export puts counts in legend)
            if (!isExport) {
              ctx.fillStyle = '#64748b';
              ctx.textAlign = 'center';
              ctx.font = `${(metaFont * drawScale) / scale}px Inter`;
              const countY = shouldRotateLabels
                ? xLabelY + (dataLabelFont * 2.0 * drawScale)
                : xLabelY + (metaFont * 1.5 * drawScale);
              ctx.fillText(`n=${g.stats!.count}`, xLabelX, countY);
            }

            slotIndex++;
            // Add box gap between boxes within the cluster
            if (gi < clusterGroups.length - 1) {
              slotIndex += boxGapRatio;
            }
          });

          // Outer label (x-axis / group label) with bracket
          if (clusterGroups.length > 0) {
            const clusterEndSlot = slotIndex - 1;
            const clusterCenterX = fx + ((clusterStartSlot + clusterEndSlot + 1) / 2) * slotWidth;
            const bracketGap = shouldRotateLabels ? (dataLabelFont * 3.0 * drawScale) : (metaFont * 1.5 * drawScale) + (dataLabelFont * 1.0 * drawScale);
            const outerLabelY = fy + fh + (20 * drawScale) + xTickOffsetY + bracketGap + (xAxisFont * 1.0 * drawScale);

            const bracketY = outerLabelY - (xAxisFont * 0.8 * drawScale);
            const leftX = fx + (clusterStartSlot + 0.15) * slotWidth;
            const rightX = fx + (clusterEndSlot + 0.85) * slotWidth;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = (1.5 * drawScale) / scale;
            ctx.beginPath();
            ctx.moveTo(leftX, bracketY);
            ctx.lineTo(rightX, bracketY);
            ctx.stroke();

            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.font = `bold ${(xAxisFont * drawScale) / scale}px Inter`;
            ctx.fillText(ck, clusterCenterX, outerLabelY);
          }

          if (ci < clusterKeys.length - 1) {
            slotIndex += clusterGap;
          }
        });
      } else {
        // === Flat layout — sort boxes ===
        const sorted = sortGroups(validGroups, config.durationBoxOrder, config.durationBoxDir, config.durationCenterLine);
        const totalFlatSlots = sorted.length + (sorted.length - 1) * boxGapRatio;
        const spacing = fw / totalFlatSlots;
        const barWidth = configBoxWidth > 0 ? Math.min(configBoxWidth, spacing * 0.95) : Math.min(50 * drawScale, spacing * 0.8);

        sorted.forEach((g, i) => {
          const slotPos = i * (1 + boxGapRatio);
          const xCenter = fx + (slotPos + 0.5) * spacing;
          drawBox(ctx, g, xCenter, barWidth, mapY, scale, drawScale);

          // Box label (data label)
          ctx.fillStyle = '#0f172a';
          ctx.font = `bold ${(dataLabelFont * drawScale) / scale}px Inter`;
          const xLabelX = xCenter + xTickOffsetX;
          const xLabelY = fy + fh + (20 * drawScale) + xTickOffsetY;

          if (shouldRotateLabels) {
            ctx.save();
            ctx.translate(xLabelX, xLabelY);
            ctx.rotate(labelRotation);
            ctx.textAlign = 'right';
            ctx.fillText(g.key, 0, 0);
            ctx.restore();
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(g.key, xLabelX, xLabelY);
          }

          // n-count (only on screen)
          if (!isExport) {
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'center';
            ctx.font = `${(metaFont * drawScale) / scale}px Inter`;
            const countY = shouldRotateLabels
              ? xLabelY + (dataLabelFont * 2.0 * drawScale)
              : xLabelY + (metaFont * 1.5 * drawScale);
            ctx.fillText(`n=${g.stats!.count}`, xLabelX, countY);
          }
        });
      }
    };

    // === Main rendering logic ===
    if (isSingleFacet) {
      renderFacet(facetData[0], margin.left, margin.top, chartW, chartH, true);

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

        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${(13 * drawScale) / scale}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillText(facet.facetKey, margin.left + col * cellW + cellW / 2, cy - (5 * drawScale));

        renderFacet(facet, cx, cy, cw, ch, isLeftCol);
      });

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

  // Canvas legend for export
  const drawLegend = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, drawScale: number, exportConfig?: ExportConfig) => {
    const hasColor = config.colorBy && config.colorBy !== 'none';
    const hasTexture = config.textureBy && config.textureBy !== 'none';
    if (!hasColor && !hasTexture) return;

    let curY = y;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const titleSize = exportConfig ? exportConfig.legendTitleSize : 36;
    const itemSize = exportConfig ? exportConfig.legendItemSize : 24;
    const spacing = (itemSize * 1.6) * drawScale;
    const boxSize = (itemSize * 0.8) * drawScale;

    // Per-layer legend config support
    const layerLegendCfg = exportConfig?.layerLegends?.find(ll => ll.layerId === 'bg');
    const showColor = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showColorLegend !== false);
    const colorLegendTitle = (layerLegendCfg?.colorTitle) || (exportConfig?.colorLegendTitle) || (config.colorBy ? config.colorBy.toUpperCase() : 'COLOR');
    const showTexture = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showTextureLegend !== false);
    const textureLegendTitle = (layerLegendCfg?.textureTitle) || (exportConfig?.textureLegendTitle) || (config.textureBy ? config.textureBy.toUpperCase() : 'PATTERN');

    const legendLayerIds = exportConfig?.legendLayers;
    const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');
    if (!isInLegend) return;

    // Compute per-group counts (n-counts appear in legend for export)
    const colorCounts: Record<string, number> = {};
    const textureCounts: Record<string, number> = {};
    data.forEach(t => {
      if (hasColor) {
        const ck = getLabel(t, config.colorBy) || '(empty)';
        colorCounts[ck] = (colorCounts[ck] || 0) + 1;
      }
      if (hasTexture) {
        const tk = getLabel(t, config.textureBy!) || '(empty)';
        textureCounts[tk] = (textureCounts[tk] || 0) + 1;
      }
    });

    // 1. Color legend
    if (showColor && hasColor) {
      ctx.font = `bold ${titleSize * drawScale}px Inter`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(colorLegendTitle, x, curY);
      curY += (titleSize * 1.4) * drawScale;

      ctx.font = `${itemSize * drawScale}px Inter`;
      Object.entries(colorMap).forEach(([key, color]) => {
        const count = colorCounts[key] || 0;
        ctx.fillStyle = color as string;
        ctx.fillRect(x, curY - boxSize / 2, boxSize, boxSize);
        ctx.fillStyle = '#334155';
        ctx.fillText(`${key} (n=${count})`, x + boxSize * 1.5, curY);
        curY += spacing;
      });
      curY += titleSize * drawScale;
    }

    // 2. Texture legend
    if (showTexture && hasTexture) {
      ctx.font = `bold ${titleSize * drawScale}px Inter`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(textureLegendTitle, x, curY);
      curY += (titleSize * 1.4) * drawScale;

      ctx.font = `${itemSize * drawScale}px Inter`;
      const textureKeys = Object.keys(textureMap).sort();
      textureKeys.forEach(tk => {
        const idx = textureMap[tk];
        const count = textureCounts[tk] || 0;
        const pat = generateTexture(ctx, idx, '#475569', '#fff');
        ctx.fillStyle = pat;
        ctx.fillRect(x, curY - boxSize / 2, boxSize, boxSize);
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(x, curY - boxSize / 2, boxSize, boxSize);
        ctx.fillStyle = '#334155';
        ctx.fillText(`${tk} (n=${count})`, x + boxSize * 1.5, curY);
        curY += spacing;
      });
    }
  }, [config.colorBy, config.textureBy, colorMap, textureMap, data]);

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

      // Dynamic margins matching renderPlot
      const bottomMarginBase = Math.max(isHierarchical ? 160 : 100, exportConfig.xAxisLabelSize * (isHierarchical ? 2.2 : 1.2) + 20);
      const leftMarginBase = Math.max(220, exportConfig.yAxisLabelSize * 1.5 + 100);
      const topMarginBase = exportConfig.showPlotTitle ? Math.max(120, (exportConfig.plotTitleSize || 128) + 40) : 80;
      const margin = {
        top: (topMarginBase * drawScale) + ((exportConfig.graphY || 0) * drawScale),
        right: 60 * drawScale,
        bottom: bottomMarginBase * drawScale,
        left: (leftMarginBase * drawScale) + ((exportConfig.graphX || 0) * drawScale),
      };

      // Legend positioning
      const hasLegendContent = (config.colorBy && config.colorBy !== 'none') || (config.textureBy && config.textureBy !== 'none');
      let legendW = 0;
      let lx = 0;
      let ly = 0;

      if (exportConfig.showLegend && hasLegendContent) {
        const legendSpace = Math.max(800, exportConfig.legendItemSize * 15, exportConfig.legendTitleSize * 10);
        if (exportConfig.legendPosition === 'right') {
          legendW = legendSpace * drawScale;
          lx = margin.left + plotWidth + (80 * drawScale);
          ly = margin.top + (50 * drawScale);
        } else if (exportConfig.legendPosition === 'bottom') {
          lx = margin.left;
          ly = margin.top + plotHeight + (100 * drawScale);
        } else if (exportConfig.legendPosition === 'inside-top-right') {
          lx = margin.left + plotWidth - (300 * drawScale);
          ly = margin.top + (40 * drawScale);
        } else if (exportConfig.legendPosition === 'inside-top-left') {
          lx = margin.left + (40 * drawScale);
          ly = margin.top + (40 * drawScale);
        } else if (exportConfig.legendPosition === 'custom') {
          lx = (Number(exportConfig.legendX) || 0) * drawScale;
          ly = (Number(exportConfig.legendY) || 0) * drawScale;
        }
      }

      let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || (margin.left + plotWidth + margin.right);
      let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || (margin.top + plotHeight + margin.bottom);

      // Always extend canvas for right-positioned legend (ExportDialog canvasWidth doesn't include legend space)
      if (exportConfig.showLegend && hasLegendContent && exportConfig.legendPosition === 'right') {
        canvasWidth += legendW;
        // Adjust legend position to be relative to actual plot area
        lx = canvasWidth - legendW + (40 * drawScale);
      }

      offscreen.width = canvasWidth;
      offscreen.height = canvasHeight;

      const ctx = offscreen.getContext('2d');
      if (!ctx) return '';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      renderPlot(ctx, plotWidth, plotHeight, 1, drawScale, exportConfig);

      // Plot title
      if (exportConfig.showPlotTitle) {
        ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';

        const titleX = (plotWidth / 2) + ((exportConfig.plotTitleX || 0) * drawScale);
        const titleY = (100 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);

        let defaultTitle = `${yAxisLabel} Analysis`;
        if (isHierarchical) defaultTitle += ` (grouped by ${clusterBy})`;

        ctx.fillText(exportConfig.plotTitle || defaultTitle, titleX, titleY);
      }

      // Legend
      if (exportConfig.showLegend && hasLegendContent) {
        ctx.save();

        if (exportConfig.legendPosition === 'right') {
          // Divider line
          ctx.beginPath();
          ctx.moveTo(margin.left + plotWidth + (40 * drawScale), margin.top);
          ctx.lineTo(margin.left + plotWidth + (40 * drawScale), margin.top + plotHeight);
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 2 * drawScale;
          ctx.stroke();
        }

        ctx.translate(lx, ly);
        drawLegend(ctx, 0, 0, drawScale, exportConfig);
        ctx.restore();
      }

      return offscreen.toDataURL('image/png');
    };

    return {
      exportImage: () => {
        const defaultExportConfig: ExportConfig = {
          scale: 3, xAxisLabelSize: 96, yAxisLabelSize: 96, tickLabelSize: 64, dataLabelSize: 64,
          showLegend: true, legendTitleSize: 96, legendItemSize: 64, legendPosition: 'right',
          showColorLegend: true, colorLegendTitle: config.colorBy?.toUpperCase() || 'COLOR',
          showShapeLegend: true, shapeLegendTitle: 'SHAPE',
          showTextureLegend: true, textureLegendTitle: config.textureBy?.toUpperCase() || 'TEXTURE',
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

  // Attach non-passive wheel listener for zoom (React onWheel is passive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setTransform(t => {
        const newScale = Math.max(0.1, Math.min(50, t.scale * factor));
        const ratio = newScale / t.scale;
        return { x: mx - ratio * (mx - t.x), y: my - ratio * (my - t.y), scale: newScale };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Canvas sizing + zoom/pan rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    canvas.style.width = '';
    canvas.style.height = '';
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const dpr = window.devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);
      renderPlot(ctx, width, height, 1, 1);
      ctx.restore();
    }
  }, [data, config, renderPlot, transform]);

  // Mouse handlers for drag (pan) and tooltip hit-testing
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => { isDragging.current = false; };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Track mouse position relative to container for tooltip placement
    const container = containerRef.current;
    if (container) {
      const cr = container.getBoundingClientRect();
      setMousePos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
    }

    // Drag → pan
    if (isDragging.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
      setHoveredToken(null);
      return;
    }

    // Hit-test for tooltips
    const hasPoints = config.showDurationPoints;
    const hasOutliers = config.showOutliers && config.durationWhiskerMode !== 'minmax';
    if (!hasPoints && !hasOutliers) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Inverse-transform mouse coordinates to match canvas render space
    const mouseX = (e.clientX - rect.left - transform.x) / transform.scale;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.scale;

    let closest: SpeechToken | null = null;
    let minDist = 10 / transform.scale; // Scale hit-test radius with zoom

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

    // Helper: check a single group's hittable points
    const checkGroup = (g: GroupData, xCenter: number, barWidth: number, mapY: (v: number) => number) => {
      if (!g.stats) return;
      const s = g.stats;

      // Check jitter points
      if (hasPoints) {
        s.tokens.forEach(t => {
          const hash = t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
          const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
          const px = xCenter + jitter;
          const py = mapY(getValue(t));
          const dist = Math.sqrt((px - mouseX) ** 2 + (py - mouseY) ** 2);
          if (dist < minDist) { minDist = dist; closest = t; }
        });
      }

      // Check outlier circles
      if (hasOutliers) {
        const iqr = s.q3 - s.q1;
        const wLow = s.values.find(v => v >= s.q1 - 1.5 * iqr) ?? s.min;
        const wHigh = [...s.values].reverse().find(v => v <= s.q3 + 1.5 * iqr) ?? s.max;
        s.values.forEach(v => {
          if (v < wLow || v > wHigh) {
            const py = mapY(v);
            const dist = Math.sqrt((xCenter - mouseX) ** 2 + (py - mouseY) ** 2);
            if (dist < minDist) {
              minDist = dist;
              // Find the token with this value
              const match = s.tokens.find(t => Math.abs(getValue(t) - v) < 0.0001);
              if (match) closest = match;
            }
          }
        });
      }
    };

    const getClusterKeyHit = (g: GroupData): string => {
      if (clusterBy === config.colorBy) return g.colorKey || '(empty)';
      if (clusterBy === config.textureBy) return g.textureKey || '(empty)';
      return '';
    };

    // Helper: hit-test one facet's groups within its rect
    const hitTestFacet = (facet: FacetData, fx: number, fy: number, fw: number, fh: number) => {
      const validGroups = facet.groups.filter(g => g.stats !== null);
      if (validGroups.length === 0) return;
      const mapY = (val: number) => fy + fh - ((val - yMin) / (yMax - yMin)) * fh;

      if (isHierarchical) {
        const clusterMap: Record<string, GroupData[]> = {};
        validGroups.forEach(g => {
          const ck = getClusterKeyHit(g);
          if (!clusterMap[ck]) clusterMap[ck] = [];
          clusterMap[ck].push(g);
        });
        const clusterKeysSorted = Object.keys(clusterMap).sort();
        clusterKeysSorted.forEach(ck => {
          clusterMap[ck] = sortGroups(clusterMap[ck], config.durationBoxOrder, config.durationBoxDir, config.durationCenterLine);
        });
        const hitClusterGap = config.durationGroupGap ?? DEFAULT_CLUSTER_GAP;
        const hitBoxGapRatio = config.durationBoxGap ?? 0.4;
        const hitConfigBoxWidth = config.durationBoxWidth ?? 0;
        const totalBoxes = validGroups.length;
        // Count inner gaps (between boxes within each cluster)
        let hitTotalInnerGaps = 0;
        clusterKeysSorted.forEach(ck => { hitTotalInnerGaps += clusterMap[ck].length - 1; });
        const totalSlots = totalBoxes + hitTotalInnerGaps * hitBoxGapRatio + (clusterKeysSorted.length > 1 ? (clusterKeysSorted.length - 1) * hitClusterGap : 0);
        const slotWidth = totalSlots > 0 ? fw / totalSlots : fw;
        const barWidth = hitConfigBoxWidth > 0 ? Math.min(hitConfigBoxWidth, slotWidth * 0.95) : Math.min(50, slotWidth * 0.8);

        let slotIndex = 0;
        clusterKeysSorted.forEach((ck, ci) => {
          const clusterGroups = clusterMap[ck];
          clusterGroups.forEach((g, gi) => {
            const xCenter = fx + (slotIndex + 0.5) * slotWidth;
            checkGroup(g, xCenter, barWidth, mapY);
            slotIndex++;
            if (gi < clusterGroups.length - 1) slotIndex += hitBoxGapRatio;
          });
          if (ci < clusterKeysSorted.length - 1) slotIndex += hitClusterGap;
        });
      } else {
        const sorted = sortGroups(validGroups, config.durationBoxOrder, config.durationBoxDir, config.durationCenterLine);
        const hitBoxGapR = config.durationBoxGap ?? 0.4;
        const hitCfgBoxW = config.durationBoxWidth ?? 0;
        const totalFlatSlots = sorted.length + (sorted.length - 1) * hitBoxGapR;
        const spacing = fw / totalFlatSlots;
        const barWidth = hitCfgBoxW > 0 ? Math.min(hitCfgBoxW, spacing * 0.95) : Math.min(50, spacing * 0.8);

        sorted.forEach((g, i) => {
          const slotPos = i * (1 + hitBoxGapR);
          const xCenter = fx + (slotPos + 0.5) * spacing;
          checkGroup(g, xCenter, barWidth, mapY);
        });
      }
    };

    if (isSingleFacet) {
      hitTestFacet(facetData[0], margin.left, margin.top, chartW, chartH);
    } else {
      // Multi-facet grid — replicate layout from renderPlot
      const cols = Math.ceil(Math.sqrt(facetData.length));
      const rows = Math.ceil(facetData.length / cols);
      const cellW = chartW / cols;
      const cellH = chartH / rows;

      facetData.forEach((facet, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const pad = 15;
        const isLeftCol = col === 0;

        const cx = margin.left + col * cellW + (isLeftCol ? pad * 2 : pad);
        const cy = margin.top + row * cellH + pad + 15;
        const cw = cellW - (isLeftCol ? pad * 3 : pad * 2);
        const ch = cellH - pad * 2 - 35;

        hitTestFacet(facet, cx, cy, cw, ch);
      });
    }

    setHoveredToken(closest);
  };

  // Legend counts
  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (config.colorBy && config.colorBy !== 'none') {
      data.forEach(t => {
        const k = getLabel(t, config.colorBy) || '(empty)';
        counts[k] = (counts[k] || 0) + 1;
      });
    }
    return counts;
  }, [data, config.colorBy]);

  const textureCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (config.textureBy && config.textureBy !== 'none') {
      data.forEach(t => {
        const k = getLabel(t, config.textureBy!) || '(empty)';
        counts[k] = (counts[k] || 0) + 1;
      });
    }
    return counts;
  }, [data, config.textureBy]);

  const hasColor = config.colorBy && config.colorBy !== 'none';
  const hasTexture = config.textureBy && config.textureBy !== 'none';
  const textureList = useMemo(() => Object.keys(textureMap).sort(), [textureMap]);

  const handleLegendClickWrapper = (category: string, type: 'color' | 'texture', event: React.MouseEvent) => {
    if (onLegendClick) {
      const currentStyles = {
        color: type === 'color' ? (colorMap[category] || '#000') : '#000',
        shape: 'circle',
        texture: type === 'texture' ? (textureMap[category] ?? 0) : 0,
        lineType: 'solid'
      };
      onLegendClick(category, currentStyles, event);
    }
  };

  // Tooltip field labels — standard names for special roles, datasetMeta for fields
  const getFieldLabel = (field: string): string => {
    if (field === 'speaker') return 'Speaker';
    if (field === 'file_id') return 'File ID';
    if (field === 'duration') return 'Duration';
    if (datasetMeta) {
      for (const m of datasetMeta.columnMappings) {
        if ((m.role === 'field' || m.role === 'pitch') && (m.fieldName === field || m.csvHeader === field)) return m.fieldName || m.csvHeader;
      }
    }
    if (DURATION_TOOLTIP_LABELS[field]) return DURATION_TOOLTIP_LABELS[field];
    return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Tooltip value display
  const tooltipYLabel = (!config.durationYField || config.durationYField === 'duration') ? 'Duration' : config.durationYField.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const tooltipYSuffix = (!config.durationYField || config.durationYField === 'duration') ? 's' : '';

  const tooltipFields = config.durationTooltipFields || ['file_id', 'duration'];

  return (
    <div ref={containerRef} className="w-full h-full relative p-4 bg-white">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { isDragging.current = false; setHoveredToken(null); }}
      />

      {/* Zoom/Pan Controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 z-10">
        <button onClick={() => setTransform(t => {
          const newScale = Math.min(50, t.scale * 1.2);
          return { ...t, scale: newScale };
        })} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold text-slate-600">+</button>
        <button onClick={() => setTransform(t => {
          const newScale = Math.max(0.1, t.scale * 0.8);
          return { ...t, scale: newScale };
        })} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold text-slate-600">−</button>
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="px-3 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider">Reset View</button>
      </div>

      {/* Screen Legend */}
      {(hasColor || hasTexture) && (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-48 pointer-events-auto">
          {hasColor && (
            <div className="space-y-1">
              <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{config.colorBy}</h4>
              {Object.entries(colorMap).map(([k, c]) => (
                <div key={k} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(k, 'color', e)}>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }}></div>
                    <span>{k}</span>
                  </div>
                  <span className="text-slate-400 text-[10px] font-mono">({colorCounts[k] || 0})</span>
                </div>
              ))}
            </div>
          )}
          {hasTexture && (
            <div className="space-y-1">
              <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{config.textureBy}</h4>
              {textureList.map(t => {
                const idx = textureMap[t];
                return (
                  <div key={t} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(t, 'texture', e)}>
                    <div className="flex items-center gap-2">
                      <PatternPreview index={idx} color="#475569" />
                      <span>{t}</span>
                    </div>
                    <span className="text-slate-400 text-[10px] font-mono">({textureCounts[t] || 0})</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Configurable Tooltip */}
      {hoveredToken && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]"
          style={{ left: mousePos.x + 16, top: mousePos.y - 16 }}>
          {(() => {
            // Use file_id as the heading if selected; otherwise no heading
            const headingField = tooltipFields.includes('file_id') ? 'file_id' : null;
            const bodyFields = headingField ? tooltipFields.filter(f => f !== headingField) : tooltipFields;
            return (
              <>
                {headingField && (() => {
                  const val = getTooltipValue(hoveredToken, headingField, getValue);
                  return val ? (
                    <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">{val}</div>
                  ) : null;
                })()}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {bodyFields.map(field => {
                    const val = getTooltipValue(hoveredToken, field, getValue);
                    if (!val) return null;
                    return (
                      <p key={field}><span className="text-slate-400 font-bold uppercase text-[9px]">{getFieldLabel(field)}:</span> {val}</p>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
});

// Texture pattern preview (tiny canvas swatch for legend)
const PatternPreview = ({ index, color }: { index: number; color: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const pat = generateTexture(ctx, index, color, '#fff') as string | CanvasPattern;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, 12, 12);
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(0, 0, 12, 12);
      }
    }
  }, [index, color]);
  return <canvas ref={canvasRef} width={12} height={12} className="rounded-sm" />;
};

export default DurationPlot;
