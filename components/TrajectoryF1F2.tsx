
import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, ReferenceCentroid, PlotHandle, StyleOverrides, ExportConfig } from '../types';

interface TrajectoryF1F2Props {
  data: SpeechToken[];
  config: PlotConfig;
  globalReferences: ReferenceCentroid[];
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626', 
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

const BW_COLORS = ['#000000', '#525252', '#969696', '#d4d4d4'];

import { getLabel } from '../utils/getLabel';

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

const DASH_NAMES = ['solid', 'dash', 'dot', 'longdash', 'dotdash', 'solid'];

const TrajectoryF1F2 = forwardRef<PlotHandle, TrajectoryF1F2Props>(({ data, config, globalReferences, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Hover state uses refs + lightweight tick to avoid triggering canvas redraws
  const hoveredTokenRef = useRef<SpeechToken | null>(null);
  const [hoverTick, setHoverTick] = useState(0);
  const hoveredToken = hoveredTokenRef.current;
  const hoverRafRef = useRef<number | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const { colorMap, groups, sortedKeys, lineTypeKeys, lineStyles, lineTypeCounts } = useMemo(() => {
    // ... (Memo logic same as before)
    const map: Record<string, string> = {};
    const grps: Record<string, SpeechToken[]> = {};
    const palette = config.bwMode ? BW_COLORS : COLORS;
    if (config.colorBy !== 'none') {
      const uniqueKeys = new Set<string>();
      data.forEach(t => { const k = getLabel(t, config.colorBy); if (k) uniqueKeys.add(k); if (!grps[k]) grps[k] = []; grps[k].push(t); });
      const keys = Array.from(uniqueKeys).sort();
      keys.forEach((k, i) => { map[k] = styleOverrides?.colors?.[k] || palette[i % palette.length]; });
    } else {
      grps['All'] = data; map['All'] = config.bwMode ? '#000000' : '#64748b';
    }
    const lStyles: Record<string, number[]> = {};
    const lCounts: Record<string, number> = {};
    let lKeys: string[] = [];
    if (config.lineTypeBy !== 'none') {
        const uniqueLKeys = new Set<string>();
        data.forEach(t => { const val = getLabel(t, config.lineTypeBy); uniqueLKeys.add(val); lCounts[val] = (lCounts[val] || 0) + 1; });
        lKeys = Array.from(uniqueLKeys).sort();
        lKeys.forEach((key, i) => { const override = styleOverrides?.lineTypes?.[key]; if (override && PATTERN_MAP[override]) { lStyles[key] = PATTERN_MAP[override]; } else { lStyles[key] = DASH_PATTERNS[i % DASH_PATTERNS.length]; } });
    }
    const sKeys = config.colorBy !== 'none' ? Object.keys(grps).sort() : ['All'];
    return { colorMap: map, groups: grps, sortedKeys: sKeys, lineTypeKeys: lKeys, lineStyles: lStyles, lineTypeCounts: lCounts };
  }, [data, config.colorBy, config.lineTypeBy, config.bwMode, styleOverrides]);

  const meanPaths = useMemo(() => {
    // ... (Mean paths logic same as before)
    if (!config.showMeanTrajectories) return {};
    const paths: Record<string, { f1: number, f2: number }[]> = {};
    const combinedGroups: Record<string, SpeechToken[]> = {};
    data.forEach(t => {
        const cKey = config.colorBy !== 'none' ? getLabel(t, config.colorBy) : 'All';
        const lKey = config.lineTypeBy !== 'none' ? getLabel(t, config.lineTypeBy) : 'Default';
        const k = config.lineTypeBy !== 'none' ? `${cKey}|${lKey}` : cKey;
        if (!combinedGroups[k]) combinedGroups[k] = [];
        combinedGroups[k].push(t);
    });
    Object.entries(combinedGroups).forEach(([key, tokens]) => {
      const tks = tokens as SpeechToken[];
      const path = [];
      // Derive time-steps from data rather than hardcoded 0-100 by 10
      const allTimes = new Set<number>();
      tks.forEach(tk => tk.trajectory.forEach(p => allTimes.add(p.time)));
      const timeSteps = Array.from(allTimes).sort((a, b) => a - b)
        .filter(t => t >= (config.trajectoryOnset ?? 0) && t <= (config.trajectoryOffset ?? 100));

      for (const t of timeSteps) {
        let sumF1 = 0, sumF2 = 0, count = 0;
        tks.forEach(token => {
          const pt = token.trajectory.find(p => p.time === t);
          if (pt) { const vF1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1; const vF2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2; if (!isNaN(vF1) && !isNaN(vF2)) { sumF1 += vF1; sumF2 += vF2; count++; } }
        });
        if (count > 0) path.push({ f1: sumF1 / count, f2: sumF2 / count });
      }
      paths[key] = path;
    });
    return paths;
  }, [data, config.colorBy, config.lineTypeBy, config.showMeanTrajectories, config.useSmoothing, config.trajectoryOnset, config.trajectoryOffset]);

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, translate: {x:number, y:number}, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);

    const mapX = (f2: number) => {
      const norm = (f2 - config.f2Range[0]) / (config.f2Range[1] - config.f2Range[0]);
      return config.invertX ? (1 - norm) * width : norm * width;
    };
    const mapY = (f1: number) => {
      const norm = (f1 - config.f1Range[0]) / (config.f1Range[1] - config.f1Range[0]);
      return config.invertY ? norm * height : (1 - norm) * height;
    };

    // Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#94a3b8';
    
    // Balanced Sizing
    const isExport = !!exportConfig;
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 28 : 14);
    const tickFontSize = (tickBaseSize * drawScale) / scale;
    ctx.font = `bold ${tickFontSize}px Inter`;

    const f2Span = config.f2Range[1] - config.f2Range[0];
    const f2Step = f2Span > 1500 ? 500 : 250;
    const startF2 = Math.ceil(config.f2Range[0] / f2Step) * f2Step;

    const f1Span = config.f1Range[1] - config.f1Range[0];
    const f1Step = f1Span > 800 ? 200 : 100;
    const startF1 = Math.ceil(config.f1Range[0] / f1Step) * f1Step;

    const tickOffset = isExport ? (10 * drawScale) : (4 * drawScale);
    const cornerThreshold = 30 * drawScale / scale;

    // Axis Tick Offsets
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale;

    for (let f2 = startF2; f2 <= config.f2Range[1]; f2 += f2Step) {
      const x = mapX(f2);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      if (x > cornerThreshold) {
          ctx.fillText(`${f2}`, x + (4*drawScale) + xTickOffsetX, height - tickOffset + xTickOffsetY);
      }
    }
    for (let f1 = startF1; f1 <= config.f1Range[1]; f1 += f1Step) {
      const y = mapY(f1);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      if (y < height - cornerThreshold) {
          ctx.fillText(`${f1}`, tickOffset + yTickOffsetX, y - (4*drawScale) + yTickOffsetY);
      }
    }

    const drawArrowHead = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number) => {
      if (isNaN(fromX) || isNaN(fromY) || isNaN(toX) || isNaN(toY)) return;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    };

    // 1. Draw Selected Reference Vowels
    const activeRefs = (config.showReferenceVowels && globalReferences.length > 0 && config.selectedReferenceVowels.length > 0) 
      ? globalReferences.filter(r => config.selectedReferenceVowels.includes(r.canonical)) 
      : [];

    if (activeRefs.length > 0) {
      activeRefs.forEach((ref) => {
        const cx = mapX(ref.f2);
        const cy = mapY(ref.f1);
        let color = '#94a3b8'; 
        if (config.colorBy === 'phoneme' && colorMap[ref.canonical]) {
            color = colorMap[ref.canonical];
        }
        const rx = Math.abs(mapX(config.f2Range[0] + ref.sdX) - mapX(config.f2Range[0]));
        const ry = Math.abs(mapY(config.f1Range[0] + ref.sdY) - mapY(config.f1Range[0]));

        ctx.save();
        ctx.translate(cx, cy);
        const visAngle = (config.invertX !== config.invertY) ? -ref.angle : ref.angle;
        ctx.rotate(visAngle);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = config.refVowelEllipseFillOpacity;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 1.5, ry * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.globalAlpha = config.refVowelEllipseLineOpacity;
        ctx.lineWidth = (2 * drawScale) / scale;
        ctx.stroke();
        ctx.restore();
      });
    }

    // 2. Draw Individual Paths
    if (config.showIndividualLines) {
        const opacity = Math.max(0.01, config.trajectoryLineOpacity);
        ctx.lineWidth = (config.lineWidth * drawScale) / scale;

        data.forEach(token => {
          const k = getLabel(token, config.colorBy);
          const color = config.colorBy !== 'none' ? (colorMap[k] || '#64748b') : (config.bwMode ? '#000000' : '#64748b');

          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity;
          ctx.beginPath();
          
          if (config.lineTypeBy !== 'none') {
              const lVal = getLabel(token, config.lineTypeBy);
              const pattern = lineStyles[lVal] || [];
              const scaledPattern = pattern.map(v => (v * config.lineWidth * drawScale) / scale);
              ctx.setLineDash(scaledPattern);
          } else {
              ctx.setLineDash([]);
          }

          let lastX: number | null = null; 
          let lastY: number | null = null;
          let secondLastX: number | null = null; 
          let secondLastY: number | null = null;
          let hasStarted = false;
          
          const filteredTrajectory = token.trajectory.filter(pt => pt.time >= (config.trajectoryOnset ?? 0) && pt.time <= (config.trajectoryOffset ?? 100));

          filteredTrajectory.forEach((pt) => {
            const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
            const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
            if (isNaN(f1) || isNaN(f2)) { hasStarted = false; return; }
            const x = mapX(f2);
            const y = mapY(f1);
            if (!hasStarted) { ctx.moveTo(x, y); hasStarted = true; } else { ctx.lineTo(x, y); }
            secondLastX = lastX; secondLastY = lastY; lastX = x; lastY = y;
          });
          ctx.stroke();
          ctx.setLineDash([]); 
          if (config.showArrows && lastX !== null && lastY !== null && secondLastX !== null && secondLastY !== null) {
             drawArrowHead(ctx, secondLastX, secondLastY, lastX, lastY, ((6 + config.lineWidth * 2) * drawScale) / scale);
          }
        });
    }

    // 3. Draw Mean Paths
    if (config.showMeanTrajectories) {
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      Object.entries(meanPaths).forEach(([key, path]) => {
        const p = path as { f1: number, f2: number }[];
        if (p.length < 2) return;
        const cKey = key.includes('|') ? key.split('|')[0] : key;
        const lKey = key.includes('|') ? key.split('|')[1] : null;
        const color = colorMap[cKey] || colorMap['All'] || '#000';
        
        if (lKey && config.lineTypeBy !== 'none') {
             const pattern = lineStyles[lKey] || [];
             const scaledPattern = pattern.map(v => (v * config.meanTrajectoryWidth * drawScale) / scale);
             ctx.setLineDash(scaledPattern);
        } else {
             ctx.setLineDash([]);
        }

        ctx.strokeStyle = 'white';
        ctx.lineWidth = ((5 + config.lineWidth) * drawScale) / scale;
        ctx.beginPath();
        p.forEach((pt, i) => {
          const x = mapX(pt.f2);
          const y = mapY(pt.f1);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = ((3 + config.lineWidth) * drawScale) / scale;
        ctx.beginPath();
        let lastX = 0, lastY = 0, prevX = 0, prevY = 0;
        let startX = 0, startY = 0;

        p.forEach((pt, i) => {
          const x = mapX(pt.f2);
          const y = mapY(pt.f1);
          if (i === 0) { ctx.moveTo(x, y); startX = x; startY = y; } 
          else ctx.lineTo(x, y);
          prevX = lastX; prevY = lastY;
          lastX = x; lastY = y;
        });
        ctx.stroke();
        ctx.setLineDash([]); 

        if (config.showArrows) {
          drawArrowHead(ctx, prevX, prevY, lastX, lastY, ((10 + config.lineWidth * 2) * drawScale) / scale);
        }

        if (config.showTrajectoryLabels) {
          const displayL = (!lKey || lKey === 'Default') ? 'All' : lKey;
          let labelText: string;
          if (config.meanLabelType === 'color') labelText = cKey;
          else if (config.meanLabelType === 'shape') labelText = displayL;
          else if (config.meanLabelType === 'both') labelText = cKey !== 'All' && displayL !== 'All' ? `${cKey} ${displayL}` : (cKey !== 'All' ? cKey : displayL);
          else {
            // Auto: show whichever variables are assigned
            if (cKey !== 'All' && displayL !== 'All') labelText = `${cKey} ${displayL}`;
            else if (cKey !== 'All') labelText = cKey;
            else labelText = displayL;
          }
          
          ctx.save();
          // Scale mean labels for export: ~24px
          const labelBase = exportConfig ? exportConfig.dataLabelSize : (isExport ? 24 : config.meanTrajectoryLabelSize);
          ctx.font = `bold ${(labelBase * drawScale)/scale}px Inter`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = color;
          ctx.globalAlpha = 1;
          
          ctx.strokeStyle = 'white';
          ctx.lineWidth = (3 * drawScale) / scale;
          ctx.lineJoin = 'round';
          ctx.strokeText(labelText, startX, startY);
          
          ctx.fillText(labelText, startX, startY);
          ctx.restore();
        }
      });
    }

    // 4. Draw Reference Labels
    if (activeRefs.length > 0) {
      activeRefs.forEach((ref) => {
        const cx = mapX(ref.f2);
        const cy = mapY(ref.f1);
        // Scale Ref Labels ~24px
        const labelBase = exportConfig ? exportConfig.dataLabelSize : (isExport ? 24 : config.refVowelLabelSize);
        ctx.font = `bold ${(labelBase * drawScale)/scale}px Inter`;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = (4 * drawScale) / scale;
        ctx.globalAlpha = config.refVowelLabelOpacity; 
        ctx.strokeText(ref.canonical, cx, cy);
        ctx.fillStyle = `rgba(0, 0, 0, ${config.refVowelLabelOpacity})`; 
        ctx.fillText(ref.canonical, cx, cy);
      });
    }

    ctx.restore();
  }, [data, config, colorMap, meanPaths, globalReferences, lineStyles]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
      let curY = y;
      const isExport = !!exportConfig;
      
      // If custom position, override x and y
      if (exportConfig && exportConfig.legendPosition === 'custom') {
          // These are absolute coordinates on the canvas, so we don't add margin offsets here if we handle it in generateImage
          // However, generateImage translates to (margin.left + plotWidth + 40, margin.top) for the legend context.
          // This makes 'custom' tricky if we want absolute positioning.
          // To support absolute positioning, we should probably reset the transform in generateImage or handle it there.
          // For now, let's assume generateImage handles the translation for 'custom' correctly.
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

      const legendLayerIds = exportConfig?.legendLayers;
      const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');

      if (isInLegend && showColor && config.colorBy !== 'none') {
          ctx.font = `bold ${fontSizeTitle}px Inter`;
          ctx.fillText(colorTitle, x, curY);
          curY += fontSizeTitle * 1.4;

          ctx.font = `${fontSizeItem}px Inter`;
          sortedKeys.forEach(k => {
              const count = groups[k]?.length || 0;
              // Trajectory legend always uses line icons (not dots)
              ctx.strokeStyle = colorMap[k];
              ctx.lineWidth = (isExport ? 4 : 2) * drawScale;
              if (config.lineTypeBy === config.colorBy && lineStyles[k]) {
                ctx.setLineDash((lineStyles[k] || []).map(v => v * drawScale));
              } else {
                ctx.setLineDash([]);
              }
              ctx.beginPath();
              ctx.moveTo(x, curY + circleSize/2);
              ctx.lineTo(x + (isExport ? 50 : 25) * drawScale, curY + circleSize/2);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#334155';
              ctx.fillText(`${k} (n=${count})`, x + xOffset, curY + circleSize/2);
              curY += spacing;
          });
          curY += fontSizeTitle;
      }

      if (isInLegend && showLineType && config.lineTypeBy !== 'none' && config.lineTypeBy !== config.colorBy) {
          ctx.font = `bold ${fontSizeTitle}px Inter`;
          ctx.fillStyle = '#0f172a';
          ctx.fillText(lineTypeTitle, x, curY);
          curY += fontSizeTitle * 1.4;

          ctx.font = `${fontSizeItem}px Inter`;
          lineTypeKeys.forEach(k => {
              const count = lineTypeCounts[k] || 0;
              ctx.beginPath();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = (isExport ? 4 : 2) * drawScale;
              const style = lineStyles[k] || [];
              ctx.setLineDash(style.map(v => v * drawScale));
              ctx.moveTo(x, curY + circleSize/2);
              ctx.lineTo(x + (isExport ? 50 : 25) * drawScale, curY + circleSize/2);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#334155';
              ctx.fillText(`${k} (n=${count})`, x + (isExport ? 70 : 35) * drawScale, curY + circleSize/2);
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
        const baseHeight = 1800;

        // Apply Graph Geometry
        const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
        const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
        const plotWidth = baseWidth * graphScaleX;
        const plotHeight = baseHeight * graphScaleY;

        // Dynamic margins based on font sizes
        const bottomMarginBase = Math.max(160, exportConfig.xAxisLabelSize * 1.5 + 30);
        const leftMarginBase = Math.max(220, exportConfig.yAxisLabelSize * 1.5 + 100);
        const topMarginBase = exportConfig.showPlotTitle
            ? Math.max(200, (exportConfig.plotTitleSize || 128) + 100)
            : Math.max(100, exportConfig.tickLabelSize + 40);
        const margin = {
            top: (topMarginBase * drawScale) + ((exportConfig.graphY || 0) * drawScale),
            bottom: bottomMarginBase * drawScale,
            left: (leftMarginBase * drawScale) + ((exportConfig.graphX || 0) * drawScale),
            right: (100 * drawScale)
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
                // For bottom, we might need to adjust canvas height, but for now let's keep it simple or just overlay
                // The original code didn't really support bottom well for export, defaulting to right.
                // Let's stick to the CanvasPlot logic if possible, or just place it below.
                lx = margin.left;
                ly = margin.top + plotHeight + (100 * drawScale);
            } else if (exportConfig.legendPosition === 'inside-top-right') {
                lx = margin.left + plotWidth - (300 * drawScale); // Approx width
                ly = margin.top + (40 * drawScale);
            } else if (exportConfig.legendPosition === 'inside-top-left') {
                lx = margin.left + (40 * drawScale);
                ly = margin.top + (40 * drawScale);
            } else if (exportConfig.legendPosition === 'custom') {
                lx = (Number(exportConfig.legendX) || 0) * drawScale;
                ly = (Number(exportConfig.legendY) || 0) * drawScale;
            }
        }

        // Calculate Canvas Size
        // If legend is 'right', add width. If 'bottom', add height? 
        // For simplicity and consistency with CanvasPlot, let's just use the calculated margins + plot size + legend allowance.
        
        let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || (margin.left + plotWidth + margin.right);
        let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || (margin.top + plotHeight + margin.bottom);

        if (!exportConfig.canvasWidth && exportConfig.showLegend && exportConfig.legendPosition === 'right') {
            canvasWidth += legendWidth;
        }
        // If custom, we don't automatically expand canvas, user must manage placement or we ensure min size.
        // But let's stick to the base logic + extensions.

        offscreen.width = canvasWidth;
        offscreen.height = canvasHeight;
        
        const ctx = offscreen.getContext('2d');
        if (!ctx) return '';
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        
        // Draw Plot
        ctx.save();
        ctx.translate(margin.left, margin.top);
        renderPlot(ctx, plotWidth, plotHeight, 1, {x: 0, y: 0}, drawScale, exportConfig);
        
        // Draw Axis Labels
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${exportConfig.xAxisLabelSize * drawScale}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        
        const xLabelX = (plotWidth / 2) + ((exportConfig.xAxisLabelX || 0) * drawScale);
        const xLabelY = plotHeight + (bottomMarginBase * 0.55 * drawScale) + ((exportConfig.xAxisLabelY || 0) * drawScale);
        ctx.fillText('F2 (Hz)', xLabelX, xLabelY);
        
        ctx.save();
        const yLabelX = -(160 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yLabelY = (plotHeight / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        
        // Note: rotation changes coordinate system. 
        // Translate to the center of the left axis area
        ctx.translate(0, plotHeight / 2); // Center vertically relative to plot
        ctx.rotate(-Math.PI / 2);
        // Now x is -y (up/down), y is x (left/right) relative to the rotated system
        // We want to position at x=0 (vertical center), y= -offset (left of axis)
        
        // Let's use the same logic as CanvasPlot for consistency if possible, or just manual:
        // CanvasPlot: ctx.translate(margin.left - (120 * drawScale) + exportConfig.yAxisLabelX * drawScale, margin.top + (height / 2) + exportConfig.yAxisLabelY * drawScale);
        
        // Re-doing Y Label to match CanvasPlot logic better:
        ctx.restore(); // Undo the previous save
        ctx.save();
        
        const yAxisX = margin.left - (leftMarginBase * 0.65 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yAxisY = margin.top + (plotHeight / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        
        ctx.translate(yAxisX, yAxisY);
        ctx.rotate(-Math.PI / 2);
        ctx.font = `bold ${exportConfig.yAxisLabelSize * drawScale}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('F1 (Hz)', 0, 0);
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
            // For custom, lx/ly are absolute. For others, they are calculated above.
            // If 'right', we need to ensure we are in the right spot.
            // The logic above calculated lx/ly relative to 0,0 (absolute).
            // So we just translate to lx, ly.
            
            ctx.translate(lx, ly);
            drawLegend(ctx, 0, 0, legendWidth, drawScale, exportConfig);
            ctx.restore();
        }
        return offscreen.toDataURL('image/png');
    };

    return {
        exportImage: () => {
            const drawScale = 3;
            // Default Config for legacy direct call
            const defaultExportConfig: ExportConfig = {
                scale: drawScale,
                xAxisLabelSize: 96,
                yAxisLabelSize: 96,
                tickLabelSize: 64,
                dataLabelSize: 64,
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
            if(url) {
                const link = document.createElement('a');
                link.download = 'f1f2_trajectory_plot.png';
                link.href = url;
                link.click();
            }
        },
        generateImage
    };
  });

  // ... (rest same as before)
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
        renderPlot(ctx, width, height, transform.scale, {x: transform.x, y: transform.y}, 1);
        ctx.restore();
    }
  }, [data, config, transform, colorMap, renderPlot]);

  // Spatial grid for O(1) hover hit-testing
  const spatialGrid = useMemo(() => {
    const container = containerRef.current;
    if (!container) return null;
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return null;
    const CELL_SIZE = 20;
    const cols = Math.ceil(width / CELL_SIZE);
    const rows = Math.ceil(height / CELL_SIZE);
    const grid: { token: SpeechToken; x: number; y: number }[][] = new Array(cols * rows);

    const mapX = (f2: number) => {
      const norm = (f2 - config.f2Range[0]) / (config.f2Range[1] - config.f2Range[0]);
      return config.invertX ? (1 - norm) * width : norm * width;
    };
    const mapY = (f1: number) => {
      const norm = (f1 - config.f1Range[0]) / (config.f1Range[1] - config.f1Range[0]);
      return config.invertY ? norm * height : (1 - norm) * height;
    };

    for (const t of data) {
      const last = t.trajectory[t.trajectory.length - 1];
      if (!last) continue;
      const f1 = config.useSmoothing ? (last.f1_smooth ?? last.f1) : last.f1;
      const f2 = config.useSmoothing ? (last.f2_smooth ?? last.f2) : last.f2;
      if (isNaN(f1) || isNaN(f2)) continue;
      const px = mapX(f2);
      const py = mapY(f1);
      const col = Math.floor(px / CELL_SIZE);
      const row = Math.floor(py / CELL_SIZE);
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        const idx = row * cols + col;
        if (!grid[idx]) grid[idx] = [];
        grid[idx].push({ token: t, x: px, y: py });
      }
    }
    return { grid, cols, rows, cellSize: CELL_SIZE };
  }, [data, config.f1Range, config.f2Range, config.invertX, config.invertY, config.useSmoothing]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => { if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current); };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => { isDragging.current = true; lastMousePos.current = { x: e.clientX, y: e.clientY }; };
  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (isDragging.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else {
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        if (!spatialGrid) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (clientX - rect.left - transform.x) / transform.scale;
        const mouseY = (clientY - rect.top - transform.y) / transform.scale;
        const { grid, cols, rows, cellSize } = spatialGrid;
        const col = Math.floor(mouseX / cellSize);
        const row = Math.floor(mouseY / cellSize);
        let closest: SpeechToken | null = null;
        let minDist = 15 / transform.scale;

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
            const cell = grid[r * cols + c];
            if (!cell) continue;
            for (let i = 0; i < cell.length; i++) {
              const entry = cell[i];
              const dx = entry.x - mouseX;
              const dy = entry.y - mouseY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDist) { minDist = dist; closest = entry.token; }
            }
          }
        }

        if (hoveredTokenRef.current !== closest) {
          hoveredTokenRef.current = closest;
          setHoverTick(t => t + 1);
        }
      });
    }
  };
  const handleMouseUp = () => isDragging.current = false;
  const handleMouseLeave = () => {
    isDragging.current = false;
    if (hoverRafRef.current !== null) { cancelAnimationFrame(hoverRafRef.current); hoverRafRef.current = null; }
    if (hoveredTokenRef.current !== null) { hoveredTokenRef.current = null; setHoverTick(t => t + 1); }
  };
  const handleWheel = (e: React.WheelEvent) => {
    const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
    setTransform(t => ({ ...t, scale: Math.max(0.1, Math.min(50, t.scale * scaleFactor)) }));
  };
  const handleLegendClickWrapper = (category: string, type: 'color' | 'lineType', event: React.MouseEvent) => {
      if (onLegendClick) {
          let color = '#000';
          let lineType = 'solid';
          if (type === 'color') { color = colorMap[category] || '#000'; } 
          else {
              const override = styleOverrides?.lineTypes?.[category];
              if (override) lineType = override;
              else { const idx = lineTypeKeys.indexOf(category); lineType = DASH_NAMES[idx % DASH_NAMES.length] || 'solid'; }
          }
          onLegendClick(category, { color, shape: 'circle', texture: 0, lineType }, event);
      }
  };

  return (
    <div ref={containerRef} className="w-full h-full p-8 relative">
       {/* ... Tooltip ... */}
       {hoveredToken && (() => {
        const fields = config.tooltipFields || [];
        if (fields.length === 0) {
          return (
            <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-4 bottom-16 border border-slate-700 backdrop-blur-md min-w-[200px]">
              <p className="text-slate-400 italic text-center">Select fields from the <span className="text-sky-400 font-bold">Tooltip</span> dropdown to see token data here.</p>
            </div>
          );
        }
        const getFieldLabel = (key: string): string => {
          const labels: Record<string, string> = {
            file_id: 'File ID', word: 'Word', syllable: 'Syllable', syllable_mark: 'Syllable Mark',
            canonical_stress: 'Expected Stress', lexical_stress: 'Transcribed Stress',
            canonical: 'Phoneme', produced: 'Allophone', alignment: 'Alignment',
            type: 'Type', canonical_type: 'Vowel Category', voice_pitch: 'Voice Pitch',
            xmin: 'Time (xmin)', duration: 'Duration',
          };
          return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };
        const getTooltipValue = (token: SpeechToken, field: string): string => {
          if (field === 'xmin') return `${token.xmin.toFixed(3)}s`;
          if (field === 'duration') return `${token.duration.toFixed(3)}s`;
          if (field in token && field !== 'id' && field !== 'trajectory' && field !== 'customFields') {
            return String((token as any)[field] ?? '');
          }
          return token.customFields?.[field] ?? '';
        };
        const [firstField, ...restFields] = fields;
        return (
          <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-4 bottom-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
            {firstField && (
              <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">
                {getFieldLabel(firstField)}: {getTooltipValue(hoveredToken, firstField)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {restFields.map(field => (
                <p key={field}><span className="text-slate-400 font-bold uppercase text-[9px]">{getFieldLabel(field)}:</span> {getTooltipValue(hoveredToken, field)}</p>
              ))}
            </div>
          </div>
        );
      })()}
      {/* ... Screen Legend ... */}
      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-56 pointer-events-auto">
         {config.colorBy !== 'none' && (
           <div className="space-y-1.5">
             <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center border-b border-slate-100 pb-1 mb-1"><span>{config.colorBy}</span></h4>
             {sortedKeys.map(key => (
               <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'color', e)}>
                 <div className="flex items-center space-x-2">
                   <svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke={colorMap[key]} strokeWidth="2" strokeDasharray={config.lineTypeBy === config.colorBy ? (lineStyles[key]?.join(',') || '') : ''} /></svg>
                   <span className="text-slate-700 font-medium truncate w-24">{key}</span>
                 </div><span className="text-slate-400 font-mono">({groups[key]?.length || 0})</span></div>))}
           </div>
         )}
         {config.lineTypeBy !== 'none' && config.lineTypeBy !== config.colorBy && (
           <div className="space-y-1.5 pt-2 border-t border-slate-100">
             <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center"><span>{config.lineTypeBy}</span></h4>
             {lineTypeKeys.map(key => (
                    <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(key, 'lineType', e)}>
                        <div className="flex items-center space-x-2"><svg width="24" height="6" className="shrink-0"><line x1="0" y1="3" x2="24" y2="3" stroke="#334155" strokeWidth="2" strokeDasharray={lineStyles[key]?.join(',') || ''} /></svg><span className="text-slate-700 font-medium truncate w-24">{key}</span></div><span className="text-slate-700 font-mono">({lineTypeCounts[key] || 0})</span></div>))}
           </div>
         )}
      </div>
      <canvas ref={canvasRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} className="cursor-move w-full h-full" />
    </div>
  );
});

export default TrajectoryF1F2;
