
import React, { useRef, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig, NormalizationMethod, DatasetMeta } from '../types';
import { normalizeFormant, SpeakerStatsMap } from '../utils/normalization';
import { interpolateTrajectoryAt, computeMeanTimeGrid } from '../utils/trajectory';
import { computeExportPlotSize } from '../utils/exportLayout';

interface TrajectoryTimeSeriesProps {
  data: SpeechToken[];
  config: PlotConfig;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
  speakerStats?: SpeakerStatsMap;
  datasetMeta?: DatasetMeta | null;
}

/** Get effective duration for a token, falling back to duration-like fields */
const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626', 
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

const BW_COLORS = ['#000000', '#525252', '#969696', '#d4d4d4'];

const PATTERN_MAP: Record<string, number[]> = {
    'solid': [],
    'dash': [5, 5],
    'dot': [2, 6],
    'longdash': [15, 5],
    'dotdash': [2, 4, 10, 4]
};

const DASH_PATTERNS = [
  [],                  // Solid
  [5, 5],              // Dash
  [2, 6],              // Dot (Wide)
  [15, 5],             // Long Dash
  [2, 4, 10, 4],       // Dot-Dash
  [2, 4, 2, 4, 10, 4]  // Two-Dot-Dash
];

// Names corresponding to DASH_PATTERNS indices for editor reconstruction
const DASH_NAMES = ['solid', 'dash', 'dot', 'longdash', 'dotdash', 'solid'];

import { getLabel } from '../utils/getLabel';
import { getTokenDuration, getTokenDurationInUnit } from '../utils/duration';


const TrajectoryTimeSeries = forwardRef<PlotHandle, TrajectoryTimeSeriesProps>(({ data, config, styleOverrides, onLegendClick, speakerStats, datasetMeta }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setCollapsedSections(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const isSectionCollapsed = (key: string) => collapsedSections.has(key);

  // Group Data, Color Map, and Line Types
  const { colorMap, groups, sortedKeys, lineTypeKeys, combinedGroups, lineStyles, lineTypeCounts } = useMemo(() => {
    const map: Record<string, string> = {};
    const grps: Record<string, SpeechToken[]> = {};
    const combined: Record<string, SpeechToken[]> = {}; // Key: "ColorVal|LineVal"
    const palette = config.bwMode ? BW_COLORS : COLORS;

    // Create Color Map & Basic Color Groups
    if (config.colorBy !== 'none') {
      const uniqueKeys = new Set<string>();
      data.forEach(t => {
        const k = getLabel(t, config.colorBy) || 'Undefined';
        uniqueKeys.add(k);
        if (!grps[k]) grps[k] = [];
        grps[k].push(t);
      });
      const keys = Array.from(uniqueKeys).sort();
      keys.forEach((k, i) => {
          map[k] = styleOverrides?.colors?.[k] || palette[i % palette.length];
      });
    } else {
      grps['All'] = data;
      map['All'] = config.bwMode ? '#000000' : '#64748b';
    }
    
    // Determine Line Type Keys
    const lStyles: Record<string, number[]> = {};
    const lCounts: Record<string, number> = {};
    let lKeys: string[] = [];
    if (config.lineTypeBy !== 'none') {
      const uniqueLKeys = new Set<string>();
      data.forEach(t => {
          const val = getLabel(t, config.lineTypeBy);
          uniqueLKeys.add(val);
          lCounts[val] = (lCounts[val] || 0) + 1;
      });
      lKeys = Array.from(uniqueLKeys).sort();
      lKeys.forEach((key, i) => {
          const override = styleOverrides?.lineTypes?.[key];
          if (override && PATTERN_MAP[override]) {
              lStyles[key] = PATTERN_MAP[override];
          } else {
              lStyles[key] = DASH_PATTERNS[i % DASH_PATTERNS.length];
          }
      });
    }

    // Create Combined Groups for Mean Calculation
    data.forEach(t => {
        const cKey = config.colorBy !== 'none' ? (getLabel(t, config.colorBy) || 'Undefined') : 'All';
        const lKey = config.lineTypeBy !== 'none' ? (getLabel(t, config.lineTypeBy) || 'Undefined') : 'Default';
        const compKey = `${cKey}|${lKey}`;
        if (!combined[compKey]) combined[compKey] = [];
        combined[compKey].push(t);
    });

    const sKeys = config.colorBy !== 'none' ? Object.keys(grps).sort() : ['All'];

    return { colorMap: map, groups: grps, sortedKeys: sKeys, lineTypeKeys: lKeys, combinedGroups: combined, lineStyles: lStyles, lineTypeCounts: lCounts };
  }, [data, config.colorBy, config.lineTypeBy, config.bwMode, styleOverrides]);


  /**
   * Determine the x-axis unit for absolute-time mode.
   * Prefer ms when the dataset has trajectoryUnit='ms', OR when any token has
   * trajectoryDurationMs set (time-slice data), OR when duration values look ms-scale (>10).
   */
  const useMs = useMemo(() => {
    if (datasetMeta?.trajectoryUnit === 'ms') return true;
    if (datasetMeta?.trajectoryUnit === 'sec') return false;
    if (data.some(t => t.trajectoryDurationMs && t.trajectoryDurationMs > 0)) return true;
    // Heuristic: duration column values > 10 are probably already ms
    return data.some(t => getTokenDuration(t) > 10);
  }, [datasetMeta, data]);

  /** Compute mean trajectories. Uses native-time grids for absolute mode (no 50-bin synthesis). */
  const meanTrajectories = useMemo(() => {
    if (!config.showMeanTrajectories) return null;
    const result: Record<string, { f1: {x:number, y:number}[], f2: {x:number, y:number}[] }> = {};

    const onset = config.trajectoryOnset ?? 0;
    const offset = config.trajectoryOffset ?? 100;
    const normM = (config.normalization || 'hz') as NormalizationMethod;

    Object.entries(combinedGroups).forEach(([compKey, tokens]) => {
      const tks = tokens as SpeechToken[];

      if (config.timeNormalized) {
        // ── Normalized mode: sample at each point on the common grid ──
        const gridTimes = computeMeanTimeGrid(
          tks.map(tk => tk.trajectory), onset, offset,
          config.snapMeansToGrid ? datasetMeta?.timePoints : undefined,
        );
        const f1Sums = new Array(gridTimes.length).fill(0);
        const f2Sums = new Array(gridTimes.length).fill(0);
        const counts = new Array(gridTimes.length).fill(0);
        tks.forEach(t => {
          const sts = speakerStats?.[t.speaker || '__all__'];
          gridTimes.forEach((gridT, idx) => {
            const pt = interpolateTrajectoryAt(t.trajectory, gridT);
            if (!pt) return;
            const f1 = normalizeFormant(config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1, 'f1', normM, sts);
            const f2 = normalizeFormant(config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2, 'f2', normM, sts);
            if (!isNaN(f1) && !isNaN(f2)) { f1Sums[idx] += f1; f2Sums[idx] += f2; counts[idx]++; }
          });
        });
        const f1Pts = gridTimes.map((x, i) => ({ x, y: counts[i] ? f1Sums[i] / counts[i] : NaN })).filter(p => !isNaN(p.y));
        const f2Pts = gridTimes.map((x, i) => ({ x, y: counts[i] ? f2Sums[i] / counts[i] : NaN })).filter(p => !isNaN(p.y));
        result[compKey] = { f1: f1Pts, f2: f2Pts };
      } else {
        // ── Absolute mode: build grid from union of each token's native times ──
        // For each token, absoluteTime = (trajectoryTime / 100) * tokenDurationInUnit.
        const absSet = new Set<number>();
        tks.forEach(t => {
          const dur = getTokenDurationInUnit(t, useMs, config.trajectoryDurationField);
          if (dur <= 0) return;
          t.trajectory.forEach(p => {
            if (p.time < onset || p.time > offset) return;
            absSet.add((p.time / 100) * dur);
          });
        });
        const gridTimes = Array.from(absSet).sort((a, b) => a - b);
        const f1Sums = new Array(gridTimes.length).fill(0);
        const f2Sums = new Array(gridTimes.length).fill(0);
        const counts = new Array(gridTimes.length).fill(0);
        tks.forEach(t => {
          const dur = getTokenDurationInUnit(t, useMs, config.trajectoryDurationField);
          if (dur <= 0) return;
          const sts = speakerStats?.[t.speaker || '__all__'];
          gridTimes.forEach((gt, idx) => {
            const pct = (gt / dur) * 100;
            if (pct < onset || pct > offset) return;
            const pt = interpolateTrajectoryAt(t.trajectory, pct);
            if (!pt) return;
            const f1 = normalizeFormant(config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1, 'f1', normM, sts);
            const f2 = normalizeFormant(config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2, 'f2', normM, sts);
            if (!isNaN(f1) && !isNaN(f2)) { f1Sums[idx] += f1; f2Sums[idx] += f2; counts[idx]++; }
          });
        });
        const f1Pts = gridTimes.map((x, i) => ({ x, y: counts[i] ? f1Sums[i] / counts[i] : NaN })).filter(p => !isNaN(p.y));
        const f2Pts = gridTimes.map((x, i) => ({ x, y: counts[i] ? f2Sums[i] / counts[i] : NaN })).filter(p => !isNaN(p.y));
        result[compKey] = { f1: f1Pts, f2: f2Pts };
      }
    });
    return result;
  }, [combinedGroups, config.timeNormalized, config.showMeanTrajectories, config.useSmoothing, config.trajectoryOnset, config.trajectoryOffset, config.snapMeansToGrid, config.normalization, datasetMeta, speakerStats, useMs]);

  // drawScale parameter added
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    // Explicit background fill to prevent transparency
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.scale(scale, scale);

    const xMax = config.timeNormalized ? 100 : Math.max(0.1, ...data.map(t => getTokenDurationInUnit(t, useMs, config.trajectoryDurationField)));
    // Use specific frequency range for time series
    const [yMin, yMax] = config.timeSeriesFrequencyRange || [0, 4000];

    // The live view maps into an inset area, framed like the F1/F2 and Spectral tabs:
    // ticks and axis titles outside the frame, and a right-hand gutter under the
    // legend. Export maps the full plot — it lays out its own margins and labels.
    const isExport = !!exportConfig;
    const area = isExport
      ? { x: 0, y: 0, w: width, h: height }
      : { x: 82, y: 24, w: width - 82 - 248, h: height - 24 - 56 };

    // Reserve a strip inside the frame for mean-trajectory labels (screen only)
    let labelMargin = 0;
    if (!exportConfig && config.showTrajectoryLabels && config.showMeanTrajectories) {
      // Estimate widest label using character count × font size (robust — avoids measureText font-loading issues)
      const lblFontSize = (config.meanTrajectoryLabelSize || 12) * drawScale / scale;
      const charW = lblFontSize * 0.62; // approximate average character width for bold Inter
      const keys = config.colorBy !== 'none' ? sortedKeys : ['All'];
      const maxChars = Math.max(...keys.map(k => k.length), 1);
      const labelPadX = (8 * drawScale) / scale;
      labelMargin = charW * maxChars + labelPadX + 8; // text + gap + breathing room
    }
    const effW = area.w - labelMargin;
    const mapX = (val: number) => area.x + (val / xMax) * effW;
    const mapY = (val: number) => area.y + area.h - ((val - yMin) / (yMax - yMin)) * area.h;

    // Grid & Ticks
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#64748b'; // Tick color

    // Balanced Sizing
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : 11;
    const tickFontSize = (tickBaseSize * drawScale) / scale;
    ctx.font = `bold ${tickFontSize}px Inter`;

    // Axis Tick Offsets
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale;

    // Y Axis (Frequency)
    const rangeSpan = yMax - yMin;
    const step = rangeSpan > 2000 ? 500 : 250;
    const startTick = Math.ceil(yMin / step) * step;
    const tickOffset = (6 * drawScale) / scale;

    for (let f = startTick; f <= yMax; f += step) {
      const y = mapY(f);
      // Grid line
      ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();

      // Tick label
      if (isExport) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${f}`, -(10 * drawScale) + yTickOffsetX, y + yTickOffsetY);
      } else {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${f}`, area.x - tickOffset, y);
      }
    }

    // X Axis (Time)
    const timeStep = config.timeNormalized ? 10 : (xMax / 10);
    const formatXTick = (t: number): string => {
      if (config.timeNormalized) return `${Math.round(t)}`;
      // Absolute mode: ms is integer-like; seconds typically show 1 decimal
      return useMs ? `${Math.round(t)}` : t.toFixed(2);
    };
    for (let t = 0; t <= xMax; t += timeStep) {
      const x = mapX(t);
      // Grid line
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();

      // Tick label (always shown, even on screen)
      const label = formatXTick(t);
      if (isExport) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x + xTickOffsetX, height + (10 * drawScale) + xTickOffsetY);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, area.y + area.h + tickOffset);
      }
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

    // Axis titles (live view only — export draws its own, sized from ExportConfig)
    if (!isExport) {
      const normUnit = config.normalization === 'lobanov' ? 'z-score'
        : config.normalization === 'nearey1' ? 'log'
        : config.normalization === 'bark' ? 'Bark'
        : config.normalization === 'erb' ? 'ERB'
        : config.normalization === 'mel' ? 'Mel' : 'Hz';
      const xTitle = config.timeNormalized ? 'Normalised time (%)' : (useMs ? 'Time (ms)' : 'Time (s)');
      ctx.fillStyle = '#334155';
      ctx.font = `600 ${(13 * drawScale) / scale}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(xTitle, area.x + area.w / 2, area.y + area.h + (40 * drawScale) / scale);
      ctx.save();
      ctx.translate(area.x - (52 * drawScale) / scale, area.y + area.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`Frequency (${normUnit})`, 0, 0);
      ctx.restore();
      ctx.textAlign = 'start';
    }

    // Clip data to the frame in the live view, so lines outside the ranges do not
    // spill into the margins. Export lays its margins out around the plot instead.
    if (!isExport) { ctx.save(); ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip(); }

    // Draw Lines
    const dynamicOpacity = Math.max(0.01, config.trajectoryLineOpacity);
    const individualLineWidth = config.trajectoryLineWidth ?? config.lineWidth ?? 1;
    ctx.lineWidth = (individualLineWidth * drawScale) / scale;

    data.forEach(token => {
      let color = '#64748b';
      if (config.colorBy !== 'none') {
        const k = getLabel(token, config.colorBy) || 'Undefined';
        if (colorMap[k]) color = colorMap[k];
      }

      let dashPattern: number[] = [];
      let isF1Solid = true;

      if (config.lineTypeBy !== 'none') {
          const lVal = getLabel(token, config.lineTypeBy) || 'Undefined';
          dashPattern = lineStyles[lVal] || [];
          isF1Solid = false;
      }

      ctx.strokeStyle = color;
      const lw = individualLineWidth;
      const scaledPattern = dashPattern.map(d => (d * lw * drawScale) / scale);
      const defaultF2Pattern = [(5*lw*drawScale)/scale, (5*lw*drawScale)/scale];

      // Filter trajectory by onset/offset range
      const onset = config.trajectoryOnset ?? 0;
      const offset = config.trajectoryOffset ?? 100;
      const filteredTraj = token.trajectory.filter(p => p.time >= onset && p.time <= offset);

      // Helper to draw a single channel (F1 or F2) handling NaNs
      const drawChannel = (isF1: boolean) => {
          ctx.beginPath();
          if (isF1) {
              ctx.globalAlpha = dynamicOpacity;
              ctx.setLineDash(isF1Solid ? [] : scaledPattern);
          } else {
              ctx.globalAlpha = dynamicOpacity * (isF1Solid ? 1 : 0.4);
              ctx.setLineDash(isF1Solid ? defaultF2Pattern : scaledPattern);
          }

          let hasStarted = false;
          const normM = (config.normalization || 'hz') as NormalizationMethod;
          const sts = speakerStats?.[token.speaker || '__all__'];
          filteredTraj.forEach((p) => {
              const rawVal = isF1
                  ? (config.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1)
                  : (config.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2);
              const val = normalizeFormant(rawVal, isF1 ? 'f1' : 'f2', normM, sts);

              if (isNaN(val)) {
                  hasStarted = false;
                  return;
              }

              const tVal = config.timeNormalized ? p.time : (p.time / 100) * getTokenDurationInUnit(token, useMs, config.trajectoryDurationField);
              const x = mapX(tVal);
              const y = mapY(val);

              if (!hasStarted) {
                  ctx.moveTo(x, y);
                  hasStarted = true;
              } else {
                  ctx.lineTo(x, y);
              }
          });
          ctx.stroke();
      };

      // Draw F1
      drawChannel(true);
      // Draw F2
      drawChannel(false);
      
      ctx.setLineDash([]);
    });

    // Draw Means for Combined Groups
    if (config.showMeanTrajectories && meanTrajectories) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = (4 * drawScale) / scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      Object.entries(meanTrajectories).forEach(([compKey, linesData]) => {
        const [cVal, lVal] = compKey.split('|');
        const lines = linesData as { f1: {x:number, y:number}[], f2: {x:number, y:number}[] };
        const color = colorMap[cVal] || colorMap['All'] || '#000';
        
        let dashPattern: number[] = [];
        if (config.lineTypeBy !== 'none') {
             dashPattern = lineStyles[lVal] || [];
        }
        const mw = config.meanTrajectoryWidth;
        const scaledPattern = dashPattern.map(d => (d * mw * drawScale) / scale);
        const defaultF2Pattern = [(6*mw*drawScale)/scale, (4*mw*drawScale)/scale];

        const drawMean = (pts: {x:number,y:number}[], isF2: boolean) => {
            if (pts.length < 2) return;
            // Background stroke (white) for contrast
            ctx.setLineDash(isF2 && config.lineTypeBy === 'none' ? defaultF2Pattern : scaledPattern);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = ((2 + config.meanTrajectoryWidth) * drawScale) / scale;
            ctx.beginPath();
            pts.forEach((p,i) => { const x=mapX(p.x); const y=mapY(p.y); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
            ctx.stroke();

            // Actual line
            ctx.strokeStyle = color;
            ctx.lineWidth = (config.meanTrajectoryWidth * drawScale) / scale;
            ctx.globalAlpha = (isF2 && config.lineTypeBy !== 'none' ? 0.5 : 1) * config.meanTrajectoryOpacity;
            
            ctx.beginPath();
            pts.forEach((p,i) => { const x=mapX(p.x); const y=mapY(p.y); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        drawMean(lines.f1, false);
        drawMean(lines.f2, true);
        ctx.setLineDash([]);

        // Draw points on mean trajectory if enabled
        if ((config.meanTrajectoryPointSize ?? 4) > 0) {
            const ptSize = ((config.meanTrajectoryPointSize || 4) * drawScale) / scale;
            ctx.fillStyle = color;
            ctx.globalAlpha = config.meanTrajectoryOpacity;
            const drawPts = (pts: {x:number,y:number}[]) => {
                pts.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(mapX(p.x), mapY(p.y), ptSize, 0, Math.PI * 2);
                    ctx.fill();
                });
            };
            drawPts(lines.f1);
            drawPts(lines.f2);
            ctx.globalAlpha = 1;
        }
      });

      // Draw mean trajectory labels with anti-overlap
      if (config.showTrajectoryLabels) {
        const labelSize = exportConfig ? exportConfig.dataLabelSize * drawScale : (config.meanTrajectoryLabelSize || 12) * drawScale / scale;
        ctx.font = `bold ${labelSize}px Inter`;
        const labelPadX = (8 * drawScale) / scale; // horizontal gap from line end

        // Collect label positions at the rightmost point of each group's F1 mean line
        const labelEntries: { x: number; y: number; label: string; color: string }[] = [];
        Object.entries(meanTrajectories).forEach(([compKey, linesData]) => {
          const [cVal, lVal] = compKey.split('|');
          const lines = linesData as { f1: {x:number,y:number}[], f2: {x:number,y:number}[] };
          const color = colorMap[cVal] || colorMap['All'] || '#000';
          if (lines.f1.length === 0) return;

          // Label text based on meanLabelType
          const displayL = lVal === 'Default' ? 'All' : lVal;
          let labelText: string;
          if (config.meanLabelType === 'color') labelText = cVal;
          else if (config.meanLabelType === 'shape') labelText = displayL;
          else if (config.meanLabelType === 'both') labelText = cVal !== 'All' && displayL !== 'All' ? `${cVal} ${displayL}` : (cVal !== 'All' ? cVal : displayL);
          else {
            // Auto: show whichever variables are assigned
            if (cVal !== 'All' && displayL !== 'All') labelText = `${cVal} ${displayL}`;
            else if (cVal !== 'All') labelText = cVal;
            else labelText = displayL;
          }

          const lastPt = lines.f1[lines.f1.length - 1];
          labelEntries.push({ x: mapX(lastPt.x), y: mapY(lastPt.y), label: labelText, color });
        });

        // Bounded anti-overlap: push labels apart while keeping them within the frame
        const halfLbl = labelSize * 0.6;
        const yTop = area.y + halfLbl;
        const yBot = area.y + area.h - halfLbl;
        const availableH = yBot - yTop;
        const idealSpacing = labelSize * 1.3;
        // If labels can't all fit at ideal spacing, reduce spacing to fit
        const neededH = (labelEntries.length - 1) * idealSpacing;
        const spacing = neededH > availableH
          ? availableH / Math.max(labelEntries.length - 1, 1)
          : idealSpacing;

        labelEntries.sort((a, b) => a.y - b.y);
        for (let iter = 0; iter < 20; iter++) {
          let moved = false;
          for (let i = 1; i < labelEntries.length; i++) {
            const gap = labelEntries[i].y - labelEntries[i - 1].y;
            if (gap < spacing) {
              const push = (spacing - gap) / 2;
              labelEntries[i - 1].y -= push;
              labelEntries[i].y += push;
              moved = true;
            }
          }
          // Clamp to canvas bounds each iteration
          labelEntries.forEach(entry => {
            entry.y = Math.max(yTop, Math.min(yBot, entry.y));
          });
          if (!moved) break;
        }

        // Render labels
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        labelEntries.forEach(entry => {
          ctx.strokeStyle = 'white';
          ctx.lineWidth = (3 * drawScale) / scale;
          ctx.lineJoin = 'round';
          ctx.strokeText(entry.label, entry.x + labelPadX, entry.y);
          ctx.fillStyle = entry.color;
          ctx.fillText(entry.label, entry.x + labelPadX, entry.y);
        });
      }
    }

    // Frame, matching the F1/F2 and Spectral tabs. Drawn last so data never covers it.
    if (!isExport) ctx.restore(); // end data clip
    const borderW = (1.5 * drawScale) / scale;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = borderW;
    ctx.setLineDash([]);
    if (isExport) {
      ctx.strokeRect(borderW / 2, borderW / 2, width - borderW, height - borderW);
    } else {
      ctx.strokeRect(area.x, area.y, area.w, area.h);
    }
  }, [data, config, colorMap, meanTrajectories, lineStyles, sortedKeys, useMs, speakerStats, datasetMeta]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
      let curY = y;
      const isExport = !!exportConfig;
      
      // If custom position, override x and y
      if (exportConfig && exportConfig.legendPosition === 'custom') {
          // Handled by translation in generateImage
      }

      const fontSizeTitle = exportConfig ? exportConfig.legendTitleSize * drawScale : (isExport ? 36 : 14) * drawScale;
      const fontSizeItem = exportConfig ? exportConfig.legendItemSize * drawScale : (isExport ? 24 : 12) * drawScale;
      const spacing = fontSizeItem * 1.6;
      const circleSize = fontSizeItem * 0.5;
      const xOffset = fontSizeItem * 1.5;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';

      // Determine legend visibility and titles from per-layer config or fallback to old fields
      const layerLegendCfg = exportConfig?.layerLegends?.find(ll => ll.layerId === 'bg');
      const showColor = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showColorLegend !== false);
      const colorTitle = (layerLegendCfg?.colorTitle) || (exportConfig?.colorLegendTitle) || config.colorBy.toUpperCase();
      const showLineType = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showLineTypeLegend !== false);
      const lineTypeTitle = (layerLegendCfg?.lineTypeTitle) || (exportConfig?.lineTypeLegendTitle) || config.lineTypeBy.toUpperCase();

      // Check if this layer is in the legend layers list
      const legendLayerIds = exportConfig?.legendLayers;
      const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');

      const isCombined = config.colorBy !== 'none' && config.lineTypeBy !== 'none' && config.colorBy === config.lineTypeBy;
      const lineLen = (isExport ? 50 : 25) * drawScale;
      const lineLabelX = x + (isExport ? 70 : 35) * drawScale;

      if (isCombined && isInLegend && showColor) {
          // Combined color + line type legend
          ctx.font = `bold ${fontSizeTitle}px Inter`;
          ctx.fillText(colorTitle, x, curY);
          curY += fontSizeTitle * 1.4;

          ctx.font = `${fontSizeItem}px Inter`;
          sortedKeys.forEach(k => {
              const count = groups[k]?.length || 0;

              // Draw colored line with dash pattern
              ctx.beginPath();
              ctx.strokeStyle = colorMap[k] || '#0f172a';
              ctx.lineWidth = (isExport ? 5 : 2.5) * drawScale;
              const style = lineStyles[k] || [];
              ctx.setLineDash(style.map(v => v * drawScale));
              ctx.moveTo(x, curY + circleSize/2);
              ctx.lineTo(x + lineLen, curY + circleSize/2);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.fillStyle = '#334155';
              ctx.fillText(`${k} (n=${count})`, lineLabelX, curY + circleSize/2);
              curY += spacing;
          });
          curY += fontSizeTitle;
      } else {
          if (isInLegend && showColor && config.colorBy !== 'none') {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              ctx.fillText(colorTitle, x, curY);
              curY += fontSizeTitle * 1.4;

              ctx.font = `${fontSizeItem}px Inter`;
              sortedKeys.forEach(k => {
                  const count = groups[k]?.length || 0;
                  ctx.fillStyle = colorMap[k];
                  ctx.beginPath(); ctx.arc(x + circleSize, curY + circleSize/2, circleSize, 0, Math.PI*2); ctx.fill();
                  ctx.fillStyle = '#334155';
                  ctx.fillText(`${k} (n=${count})`, x + xOffset, curY + circleSize/2);
                  curY += spacing;
              });
              curY += fontSizeTitle;
          }

          // Export Legend for Line Type
          if (isInLegend && showLineType && config.lineTypeBy !== 'none') {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              ctx.fillStyle = '#0f172a';
              ctx.fillText(lineTypeTitle, x, curY);
              curY += fontSizeTitle * 1.4;

              ctx.font = `${fontSizeItem}px Inter`;
              lineTypeKeys.forEach(k => {
                  const count = lineTypeCounts[k] || 0;

                  // Draw line sample
                  ctx.beginPath();
                  ctx.strokeStyle = '#0f172a';
                  ctx.lineWidth = (isExport ? 4 : 2) * drawScale;
                  const style = lineStyles[k] || [];
                  ctx.setLineDash(style.map(v => v * drawScale));
                  ctx.moveTo(x, curY + circleSize/2);
                  ctx.lineTo(x + lineLen, curY + circleSize/2);
                  ctx.stroke();
                  ctx.setLineDash([]);

                  ctx.fillStyle = '#334155';
                  ctx.fillText(`${k} (n=${count})`, lineLabelX, curY + circleSize/2);
                  curY += spacing;
              });
          }
      }
  };

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
        const offscreen = document.createElement('canvas');
        const { drawScale, width: plotWidth, height: plotHeight } = computeExportPlotSize(exportConfig, 2400, 1500);

        // Dynamic margins based on font sizes
        const bottomMarginBase = Math.max(150, exportConfig.xAxisLabelSize * 1.5 + 30);
        const leftMarginBase = Math.max(180, exportConfig.yAxisLabelSize * 1.5 + 80);
        const topMarginBase = exportConfig.showPlotTitle
            ? Math.max(200, (exportConfig.plotTitleSize || 128) + 100)
            : Math.max(100, exportConfig.tickLabelSize + 40);
        const margin = {
            top: (topMarginBase * drawScale) + ((exportConfig.graphY || 0) * drawScale),
            right: (50 * drawScale),
            bottom: bottomMarginBase * drawScale,
            left: (leftMarginBase * drawScale) + ((exportConfig.graphX || 0) * drawScale)
        };

        // Legend Calculation
        let legendWidth = 0;
        let legendHeight = 0;
        let lx = 0;
        let ly = 0;

        if (exportConfig.showLegend) {
            const legendSpace = Math.max(800, exportConfig.legendItemSize * 15, exportConfig.legendTitleSize * 10);
            if (exportConfig.legendPosition === 'right') {
                legendWidth = legendSpace * drawScale;
                lx = margin.left + plotWidth + (40 * drawScale);
                ly = margin.top;
            } else if (exportConfig.legendPosition === 'bottom') {
                legendHeight = legendSpace * drawScale;
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

        if (!exportConfig.canvasWidth && exportConfig.showLegend && exportConfig.legendPosition === 'right') {
            canvasWidth += legendWidth;
        }
        if (!exportConfig.canvasHeight && exportConfig.showLegend && exportConfig.legendPosition === 'bottom') {
            canvasHeight += legendHeight;
        }
        
        offscreen.width = canvasWidth;
        offscreen.height = canvasHeight;
        const ctx = offscreen.getContext('2d');
        if (!ctx) return '';
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        
        // Draw Plot
        ctx.save();
        ctx.translate(margin.left, margin.top);
        renderPlot(ctx, plotWidth, plotHeight, 1, drawScale, exportConfig);
        
        // Large Labels
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${exportConfig.xAxisLabelSize * drawScale}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        
        const xLabelX = (plotWidth / 2) + ((exportConfig.xAxisLabelX || 0) * drawScale);
        const xLabelY = plotHeight + (bottomMarginBase * 0.55 * drawScale) + ((exportConfig.xAxisLabelY || 0) * drawScale);
        const xAxisLabel = config.timeNormalized ? "Normalized Time (%)" : (useMs ? "Time (ms)" : "Time (s)");
        ctx.fillText(xAxisLabel, xLabelX, xLabelY);

        ctx.save();
        const yAxisX = -(leftMarginBase * 0.65 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yAxisY = (plotHeight / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        
        // Translate to center of Y axis area relative to plot origin (which is margin.left, margin.top)
        // But we are inside the plot context (translated by margin.left, margin.top)
        // So we translate relative to 0,0 of plot
        
        // Wait, previous code was: ctx.translate(-(150 * drawScale), plotHeight / 2);
        // So we just add offsets to that.
        
        ctx.translate(yAxisX, yAxisY);
        ctx.rotate(-Math.PI / 2);
        ctx.font = `bold ${exportConfig.yAxisLabelSize * drawScale}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        const normUnitLabel = config.normalization === 'lobanov' ? 'z-score' : config.normalization === 'nearey1' ? 'log' : config.normalization === 'bark' ? 'Bark' : config.normalization === 'erb' ? 'ERB' : config.normalization === 'mel' ? 'Mel' : 'Hz';
        ctx.fillText(`Frequency (${normUnitLabel})`, 0, 0);
        ctx.restore();
        ctx.restore(); // Restore from margin translation

        // Draw Title
        if (exportConfig.showPlotTitle) {
            ctx.save();
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            const titleX = (offscreen.width / 2) + ((exportConfig.plotTitleX || 0) * drawScale);
            const titleY = (80 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);
            ctx.fillText(exportConfig.plotTitle, titleX, titleY);
            ctx.restore();
        }

        // Draw Legend
        if (exportConfig.showLegend && (config.colorBy !== 'none' || config.lineTypeBy !== 'none')) {
            ctx.save();
            ctx.translate(lx, ly);
            drawLegend(ctx, 0, 0, legendWidth, drawScale, exportConfig);
            ctx.restore();
        }
        return offscreen.toDataURL('image/png');
    };

    return {
        exportImage: () => {
            // Legacy support 
            const defaultExportConfig: ExportConfig = {
                scale: 3, xAxisLabelSize: 96, yAxisLabelSize: 96, tickLabelSize: 64, dataLabelSize: 64,
                showLegend: true, legendTitleSize: 96, legendItemSize: 64,
                showColorLegend: true, colorLegendTitle: config.colorBy.toUpperCase(),
                showShapeLegend: true, shapeLegendTitle: '',
                showTextureLegend: true, textureLegendTitle: '',
                showLineTypeLegend: true, lineTypeLegendTitle: config.lineTypeBy.toUpperCase(),
                showOverlayColorLegend: true, overlayColorLegendTitle: '',
                showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
                showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: '',
            };
            const url = generateImage(defaultExportConfig);
            if (url) {
                const link = document.createElement('a');
                link.download = 'time_series_plot.png';
                link.href = url;
                link.click();
            }
        },
        generateImage
    };
  });

  // Wheel zoom towards the cursor (non-passive so preventDefault works)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setTransform(t => {
        const ns = Math.max(0.2, Math.min(20, t.scale * factor));
        const r = ns / t.scale;
        return { x: mx - r * (mx - t.x), y: my - r * (my - t.y), scale: ns };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    // Clear any previous inline sizing so CSS w-full h-full takes effect
    canvas.style.width = '';
    canvas.style.height = '';
    // Use the canvas's own CSS-resolved size (respects parent padding via w-full h-full)
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;

    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.save();
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.translate(transform.x, transform.y);
        renderPlot(ctx, width, height, transform.scale, 1);
        ctx.restore();
    }
  }, [data, config, renderPlot, transform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseUp = () => { isDragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
      setHoveredToken(null);
      return;
    }
    if (!containerRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // Inverse-transform into plot space, then use the same area mapping as the renderer
    const x = (e.clientX - rect.left - transform.x) / transform.scale;
    const y = (e.clientY - rect.top - transform.y) / transform.scale;
    const width = rect.width;
    const height = rect.height;
    const area = { x: 82, y: 24, w: width - 82 - 248, h: height - 24 - 56 };

    const xMax = config.timeNormalized ? 100 : Math.max(0.1, ...data.map(t => getTokenDurationInUnit(t, useMs, config.trajectoryDurationField)));
    const [yMin, yMax] = config.timeSeriesFrequencyRange || [0, 4000];
    // Mirror the renderer's label strip so hover positions match drawn positions
    let labelMargin = 0;
    if (config.showTrajectoryLabels && config.showMeanTrajectories) {
      const lblFontSize = config.meanTrajectoryLabelSize || 12;
      const keys = config.colorBy !== 'none' ? sortedKeys : ['All'];
      const maxChars = Math.max(...keys.map(k => k.length), 1);
      labelMargin = lblFontSize * 0.62 * maxChars + 16;
    }
    const effW = area.w - labelMargin;
    const mapX = (val: number) => area.x + (val / xMax) * effW;
    const mapY = (val: number) => area.y + area.h - ((val - yMin) / (yMax - yMin)) * area.h;

    let closest = null;
    let minDist = 15 / transform.scale;

    for (const t of data) {
       const mid = t.trajectory[Math.floor(t.trajectory.length / 2)];
       if (!mid) continue;
       const tVal = config.timeNormalized ? mid.time : (mid.time / 100) * getTokenDurationInUnit(t, useMs, config.trajectoryDurationField);
       const px = mapX(tVal);
       
       if (Math.abs(px - x) < 20 / transform.scale) {
           const normMH = (config.normalization || 'hz') as NormalizationMethod;
           const stsH = speakerStats?.[t.speaker || '__all__'];
           const f1 = normalizeFormant(config.useSmoothing ? (mid.f1_smooth ?? mid.f1) : mid.f1, 'f1', normMH, stsH);
           const f2 = normalizeFormant(config.useSmoothing ? (mid.f2_smooth ?? mid.f2) : mid.f2, 'f2', normMH, stsH);
           if (isNaN(f1) || isNaN(f2)) continue;

           const py1 = mapY(f1);
           const py2 = mapY(f2);
           const d1 = Math.abs(py1 - y);
           const d2 = Math.abs(py2 - y);
           if (d1 < minDist) { minDist = d1; closest = t; }
           else if (d2 < minDist) { minDist = d2; closest = t; }
       }
    }
    setHoveredToken(closest);
  };
  const handleLegendClickWrapper = (category: string, type: 'color' | 'lineType', event: React.MouseEvent) => {
      if (onLegendClick) {
          let color = '#000';
          let lineType = 'solid';
          
          if (type === 'color') {
              color = colorMap[category] || '#000';
          } else {
              const override = styleOverrides?.lineTypes?.[category];
              if (override) {
                  lineType = override;
              } else {
                  const idx = lineTypeKeys.indexOf(category);
                  lineType = DASH_NAMES[idx % DASH_NAMES.length] || 'solid';
              }
          }

          const currentStyles = { color, shape: 'circle', texture: 0, lineType };
          onLegendClick(category, currentStyles, event);
      }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative">
       {/* Tooltip ... */}
       {hoveredToken && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
          {hoveredToken.file_id && <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">File ID: {hoveredToken.file_id}</div>}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
             {config.groupBy && config.groupBy !== 'none' && (
               <p><span className="text-slate-400 font-bold uppercase text-[9px]">{config.groupBy}:</span> {getLabel(hoveredToken, config.groupBy)}</p>
             )}
             {config.colorBy && config.colorBy !== 'none' && config.colorBy !== config.groupBy && (
               <p><span className="text-slate-400 font-bold uppercase text-[9px]">{config.colorBy}:</span> {getLabel(hoveredToken, config.colorBy)}</p>
             )}
          </div>
        </div>
      )}

      {/* Screen legend — plain top-right overlay, matching the F1/F2 and Spectral tabs */}
      <div className="absolute top-4 right-4 text-xs flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-56 z-40 pointer-events-auto">
         <div className="space-y-2 border-b border-slate-100 pb-2">
           <h4 className="text-[10px] font-black uppercase text-slate-400">Frequency ID</h4>
           {config.lineTypeBy === 'none' ? (
               <>
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-0.5 bg-slate-800 rounded"></div>
                    <span className="font-bold text-slate-700">F1 (Solid)</span>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-0.5 border-t-2 border-dashed border-slate-800"></div>
                    <span className="font-bold text-slate-700">F2 (Dashed)</span>
                </div>
               </>
           ) : (
               <>
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-3 bg-slate-600 rounded opacity-100"></div>
                    <span className="font-bold text-slate-700">F1 (Dark)</span>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-3 bg-slate-600 rounded opacity-40"></div>
                    <span className="font-bold text-slate-700">F2 (Light)</span>
                </div>
               </>
           )}
         </div>

         {config.colorBy !== 'none' && config.lineTypeBy !== 'none' && config.colorBy === config.lineTypeBy ? (
           /* Combined color + line type legend */
           <div className="space-y-1.5">
             <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center cursor-pointer select-none hover:text-slate-600 transition-colors" onClick={() => toggleSection('combined')}>
                <span>{config.colorBy}</span>
                <span className="text-[8px]">{isSectionCollapsed('combined') ? '▶' : '▼'}</span>
             </h4>
             {!isSectionCollapsed('combined') && sortedKeys.map(key => (
                    <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'color', e)}>
                        <div className="flex items-center space-x-2"><svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke={colorMap[key] || '#334155'} strokeWidth="2.5" strokeDasharray={lineStyles[key]?.join(',') || ''} /></svg><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({groups[key]?.length || 0})</span></div>))}
           </div>
         ) : (
           <>
             {config.colorBy !== 'none' && (
               <div className="space-y-1.5">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center cursor-pointer select-none hover:text-slate-600 transition-colors" onClick={() => toggleSection('color')}>
                    <span>{config.colorBy}</span>
                    <span className="text-[8px]">{isSectionCollapsed('color') ? '▶' : '▼'}</span>
                 </h4>
                 {!isSectionCollapsed('color') && sortedKeys.map(key => (
                        <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'color', e)}>
                            <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: colorMap[key] }}></div><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({groups[key]?.length || 0})</span></div>))}
                 {isSectionCollapsed('color') && <span className="text-[9px] text-slate-400 italic">({sortedKeys.length} items)</span>}
               </div>
             )}

             {config.lineTypeBy !== 'none' && (
               <div className="space-y-1.5 pt-2 border-t border-slate-100">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center cursor-pointer select-none hover:text-slate-600 transition-colors" onClick={() => toggleSection('lineType')}>
                    <span>{config.lineTypeBy}</span>
                    <span className="text-[8px]">{isSectionCollapsed('lineType') ? '▶' : '▼'}</span>
                 </h4>
                 {!isSectionCollapsed('lineType') && lineTypeKeys.map(key => (
                        <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'lineType', e)}>
                            <div className="flex items-center space-x-2"><svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke="#334155" strokeWidth="2" strokeDasharray={lineStyles[key]?.join(',') || ''} /></svg><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({lineTypeCounts[key] || 0})</span></div>))}
                 {isSectionCollapsed('lineType') && <span className="text-[9px] text-slate-400 italic">({lineTypeKeys.length} items)</span>}
               </div>
             )}
           </>
         )}
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { handleMouseUp(); setHoveredToken(null); }}
        className="w-full h-full"
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
      />
      <div className="absolute bottom-4 left-4 flex space-x-2">
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 1.2 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">+</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 0.8 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">-</button>
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="px-3 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[10px] font-bold">RESET VIEW</button>
      </div>
    </div>
  );
});

export default TrajectoryTimeSeries;
