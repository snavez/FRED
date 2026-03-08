
import React, { useRef, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig } from '../types';

interface TrajectoryTimeSeriesProps {
  data: SpeechToken[];
  config: PlotConfig;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
}

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

const lerp = (v0: number, v1: number, t: number) => v0 * (1 - t) + v1 * t;

const TrajectoryTimeSeries = forwardRef<PlotHandle, TrajectoryTimeSeriesProps>(({ data, config, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);

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
        const k = getLabel(t, config.colorBy);
        if (k) uniqueKeys.add(k);
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
        const cKey = config.colorBy !== 'none' ? getLabel(t, config.colorBy) : 'All';
        const lKey = config.lineTypeBy !== 'none' ? getLabel(t, config.lineTypeBy) : 'Default';
        const compKey = `${cKey}|${lKey}`;
        if (!combined[compKey]) combined[compKey] = [];
        combined[compKey].push(t);
    });

    const sKeys = config.colorBy !== 'none' ? Object.keys(grps).sort() : ['All'];

    return { colorMap: map, groups: grps, sortedKeys: sKeys, lineTypeKeys: lKeys, combinedGroups: combined, lineStyles: lStyles, lineTypeCounts: lCounts };
  }, [data, config.colorBy, config.lineTypeBy, config.bwMode, styleOverrides]);


  // Compute Mean Paths... (Unchanged logic)
  const meanTrajectories = useMemo(() => {
    if (!config.showMeanTrajectories) return null;
    const result: Record<string, { f1: {x:number, y:number}[], f2: {x:number, y:number}[] }> = {};

    Object.entries(combinedGroups).forEach(([compKey, tokens]) => {
      const tks = tokens as SpeechToken[];

      // Derive actual time-points from data for normalized mode
      const allNormTimes = new Set<number>();
      tks.forEach(tk => tk.trajectory.forEach(p => allNormTimes.add(p.time)));
      const sortedNormTimes = Array.from(allNormTimes).sort((a, b) => a - b);
      const normBinCount = sortedNormTimes.length || 11;

      const binCount = config.timeNormalized ? normBinCount : 50;
      const f1Sums = new Array(binCount).fill(0);
      const f2Sums = new Array(binCount).fill(0);
      const counts = new Array(binCount).fill(0);
      const maxDur = Math.max(...tks.map(t => t.duration));
      const binSize = config.timeNormalized ? (sortedNormTimes.length > 1 ? sortedNormTimes[1] - sortedNormTimes[0] : 10) : maxDur / binCount;

      tks.forEach(t => {
         if (config.timeNormalized) {
             t.trajectory.forEach(p => {
                 // Map trajectory point time to bin index using sorted time-points
                 const idx = sortedNormTimes.indexOf(p.time);
                 const f1 = config.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1;
                 const f2 = config.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2;
                 if(idx >= 0 && idx < normBinCount && !isNaN(f1) && !isNaN(f2)) {
                     f1Sums[idx]+=f1; f2Sums[idx]+=f2; counts[idx]++;
                 }
             });
         } else {
             // For non-normalized time
             for(let i=0; i<binCount; i++) {
                 const time = i * binSize;
                 if(time > t.duration) continue;
                 const normTime = (time/t.duration)*100;
                 // Find bracketing trajectory points
                 let p0Idx = -1, p1Idx = -1;
                 for (let j = 0; j < t.trajectory.length - 1; j++) {
                     if (t.trajectory[j].time <= normTime && t.trajectory[j+1].time >= normTime) {
                         p0Idx = j; p1Idx = j + 1; break;
                     }
                 }
                 if (p0Idx < 0 || p1Idx < 0) continue;
                 const p0 = t.trajectory[p0Idx];
                 const p1 = t.trajectory[p1Idx];
                 if(p0 && p1) {
                     const f1_0 = config.useSmoothing ? (p0.f1_smooth ?? p0.f1) : p0.f1;
                     const f1_1 = config.useSmoothing ? (p1.f1_smooth ?? p1.f1) : p1.f1;
                     const f2_0 = config.useSmoothing ? (p0.f2_smooth ?? p0.f2) : p0.f2;
                     const f2_1 = config.useSmoothing ? (p1.f2_smooth ?? p1.f2) : p1.f2;

                     if (!isNaN(f1_0) && !isNaN(f1_1) && !isNaN(f2_0) && !isNaN(f2_1)) {
                        const span = p1.time - p0.time;
                        const alpha = span > 0 ? (normTime - p0.time) / span : 0;
                        f1Sums[i] += lerp(f1_0, f1_1, alpha);
                        f2Sums[i] += lerp(f2_0, f2_1, alpha);
                        counts[i]++;
                     }
                 }
             }
         }
      });

      const mapPoints = (sums: number[], cnts: number[]) => sums.map((s, i) => ({
          x: config.timeNormalized ? sortedNormTimes[i] ?? (i * binSize) : i * binSize,
          y: cnts[i] ? s/cnts[i] : NaN
      })).filter(p => !isNaN(p.y));

      result[compKey] = { f1: mapPoints(f1Sums, counts), f2: mapPoints(f2Sums, counts) };
    });
    return result;
  }, [combinedGroups, config.timeNormalized, config.showMeanTrajectories, config.useSmoothing]);

  // drawScale parameter added
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    // Explicit background fill to prevent transparency
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    ctx.scale(scale, scale);

    const xMax = config.timeNormalized ? 100 : Math.max(0.1, ...data.map(t => t.duration));
    // Use specific frequency range for time series
    const [yMin, yMax] = config.timeSeriesFrequencyRange || [0, 4000];

    const mapX = (val: number) => (val / xMax) * width;
    const mapY = (val: number) => height - ((val - yMin) / (yMax - yMin)) * height;

    // Grid & Ticks
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#64748b'; // Tick color
    
    // Balanced Sizing
    const isExport = !!exportConfig;
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (drawScale > 1.5 ? 28 : 14);
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

    for (let f = startTick; f <= yMax; f += step) {
      const y = mapY(f);
      // Grid line
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      
      // Tick label
      if (isExport) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${f}`, -(10 * drawScale) + yTickOffsetX, y + yTickOffsetY);
      } else {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${f}`, (6*drawScale), y - (2*drawScale));
      }
    }

    // X Axis (Time)
    const timeStep = config.timeNormalized ? 10 : (xMax / 10);
    for (let t = 0; t <= xMax; t += timeStep) {
      const x = mapX(t);
      // Grid line
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      
      // Tick label
      if (isExport) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = config.timeNormalized ? `${t}` : t.toFixed(1);
          ctx.fillText(label, x + xTickOffsetX, height + (10 * drawScale) + xTickOffsetY);
      }
    }

    // Draw Lines
    const dynamicOpacity = Math.max(0.01, config.trajectoryLineOpacity);
    ctx.lineWidth = (config.lineWidth * drawScale) / scale;

    data.forEach(token => {
      let color = '#64748b';
      if (config.colorBy !== 'none') {
        const k = getLabel(token, config.colorBy);
        if (colorMap[k]) color = colorMap[k];
      }
      
      let dashPattern: number[] = [];
      let isF1Solid = true;

      if (config.lineTypeBy !== 'none') {
          const lVal = getLabel(token, config.lineTypeBy);
          dashPattern = lineStyles[lVal] || [];
          isF1Solid = false;
      }

      ctx.strokeStyle = color;
      const lw = config.lineWidth;
      const scaledPattern = dashPattern.map(d => (d * lw * drawScale) / scale);
      const defaultF2Pattern = [(5*lw*drawScale)/scale, (5*lw*drawScale)/scale];

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
          token.trajectory.forEach((p) => {
              const val = isF1 
                  ? (config.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1)
                  : (config.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2);

              if (isNaN(val)) {
                  hasStarted = false;
                  return;
              }

              const tVal = config.timeNormalized ? p.time : (p.time / 100) * token.duration;
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
          let labelText = cVal;
          if (config.meanLabelType === 'color') labelText = cVal !== 'All' ? cVal : lVal;
          else if (config.meanLabelType === 'shape') labelText = lVal !== 'Default' ? lVal : cVal;
          else if (config.meanLabelType === 'both') labelText = lVal !== 'Default' ? `${cVal} ${lVal}` : cVal;
          else {
            // Auto: show whichever variables are assigned
            if (cVal !== 'All' && lVal !== 'Default') labelText = `${cVal} ${lVal}`;
            else if (lVal !== 'Default') labelText = lVal;
            else labelText = cVal;
          }

          const lastPt = lines.f1[lines.f1.length - 1];
          labelEntries.push({ x: mapX(lastPt.x), y: mapY(lastPt.y), label: labelText, color });
        });

        // Anti-overlap: sort by Y, push apart if too close
        const minSpacing = labelSize * 1.3;
        labelEntries.sort((a, b) => a.y - b.y);
        for (let iter = 0; iter < 10; iter++) {
          let moved = false;
          for (let i = 1; i < labelEntries.length; i++) {
            const gap = labelEntries[i].y - labelEntries[i - 1].y;
            if (gap < minSpacing) {
              const push = (minSpacing - gap) / 2;
              labelEntries[i - 1].y -= push;
              labelEntries[i].y += push;
              moved = true;
            }
          }
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
  }, [data, config, colorMap, meanTrajectories, lineStyles]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
      let curY = y;
      const isExport = !!exportConfig;
      
      // If custom position, override x and y
      if (exportConfig && exportConfig.legendPosition === 'custom') {
          // Handled by translation in generateImage
      }

      const fontSizeTitle = exportConfig ? exportConfig.legendTitleSize : (isExport ? 36 : 14) * drawScale;
      const fontSizeItem = exportConfig ? exportConfig.legendItemSize : (isExport ? 24 : 12) * drawScale;
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
        const drawScale = exportConfig.scale;
        
        // Base dimensions
        const baseWidth = 2400;
        const baseHeight = 1500;

        // Apply Graph Geometry
        const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
        const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
        const plotWidth = baseWidth * graphScaleX;
        const plotHeight = baseHeight * graphScaleY;

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
        let lx = 0;
        let ly = 0;

        if (exportConfig.showLegend) {
            const legendSpace = Math.max(800, exportConfig.legendItemSize * 15, exportConfig.legendTitleSize * 10);
            if (exportConfig.legendPosition === 'right') {
                legendWidth = legendSpace * drawScale;
                lx = margin.left + plotWidth + (40 * drawScale);
                ly = margin.top;
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

        if (!exportConfig.canvasWidth && exportConfig.showLegend && exportConfig.legendPosition === 'right') {
            canvasWidth += legendWidth;
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
        ctx.fillText(config.timeNormalized ? "Normalized Time (%)" : "Duration (s)", xLabelX, xLabelY);

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
        ctx.fillText('Frequency (Hz)', 0, 0);
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

  // ... (rest unchanged)
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
  }, [data, config, renderPlot]);

  // ... Interaction handlers unchanged
  const handleMouseDown = (e: React.MouseEvent) => {};
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width / window.devicePixelRatio);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height / window.devicePixelRatio);
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const xMax = config.timeNormalized ? 100 : Math.max(0.1, ...data.map(t => t.duration));
    const [yMin, yMax] = config.timeSeriesFrequencyRange || [0, 4000]; 
    const mapX = (val: number) => (val / xMax) * width;
    const mapY = (val: number) => height - ((val - yMin) / (yMax - yMin)) * height;

    let closest = null;
    let minDist = 15;

    for (const t of data) {
       const mid = t.trajectory[Math.floor(t.trajectory.length / 2)];
       if (!mid) continue;
       const tVal = config.timeNormalized ? mid.time : (mid.time / 100) * t.duration;
       const px = mapX(tVal);
       
       if (Math.abs(px - x) < 20) {
           const f1 = config.useSmoothing ? (mid.f1_smooth ?? mid.f1) : mid.f1;
           const f2 = config.useSmoothing ? (mid.f2_smooth ?? mid.f2) : mid.f2;
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
    <div ref={containerRef} className="w-full h-full p-8 relative">
       {/* Tooltip ... */}
       {hoveredToken && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
          <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">File ID: {hoveredToken.file_id}</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Word:</span> {hoveredToken.word}</p>
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Phoneme:</span> {hoveredToken.canonical}</p>
          </div>
        </div>
      )}

      {/* Screen Legend (Same as previous) */}
      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-56 pointer-events-auto">
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
             <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                <span>{config.colorBy}</span>
             </h4>
             {sortedKeys.map(key => (
                    <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'color', e)}>
                        <div className="flex items-center space-x-2"><svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke={colorMap[key] || '#334155'} strokeWidth="2.5" strokeDasharray={lineStyles[key]?.join(',') || ''} /></svg><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({groups[key]?.length || 0})</span></div>))}
           </div>
         ) : (
           <>
             {config.colorBy !== 'none' && (
               <div className="space-y-1.5">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                    <span>{config.colorBy}</span>
                 </h4>
                 {sortedKeys.map(key => (
                        <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'color', e)}>
                            <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: colorMap[key] }}></div><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({groups[key]?.length || 0})</span></div>))}
               </div>
             )}

             {config.lineTypeBy !== 'none' && (
               <div className="space-y-1.5 pt-2 border-t border-slate-100">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                    <span>{config.lineTypeBy}</span>
                 </h4>
                 {lineTypeKeys.map(key => (
                        <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'lineType', e)}>
                            <div className="flex items-center space-x-2"><svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke="#334155" strokeWidth="2" strokeDasharray={lineStyles[key]?.join(',') || ''} /></svg><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({lineTypeCounts[key] || 0})</span></div>))}
               </div>
             )}
           </>
         )}
      </div>

      <canvas 
        ref={canvasRef} 
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredToken(null)}
        className="w-full h-full" 
      />
    </div>
  );
});

export default TrajectoryTimeSeries;
