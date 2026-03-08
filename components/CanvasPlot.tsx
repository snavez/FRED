
// ... existing imports
import React, { useRef, useEffect, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig, Layer, DatasetMeta } from '../types';

interface CanvasPlotProps {
  layers: Layer[];
  layerData: Record<string, SpeechToken[]>;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent, layerId?: string) => void;
  datasetMeta?: DatasetMeta | null;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626',
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

const BW_COLORS = ['#000000', '#525252', '#969696', '#d4d4d4'];

const SHAPES = [
  'circle', 'square', 'triangle', 'diamond', 'hexagon',
  'circle-open', 'square-open', 'triangle-open', 'diamond-open',
  'plus', 'cross', 'asterisk'
];

import { getLabel } from '../utils/getLabel';

// Find nearest available time-point in a token's trajectory
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

const drawShape = (ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, scale: number, drawScale: number = 1, strokeWidth?: number) => {
  ctx.beginPath();
  switch (shape) {
    case 'circle': case 'circle-open': ctx.arc(x, y, size, 0, Math.PI * 2); break;
    case 'square': case 'square-open': ctx.rect(x - size, y - size, size * 2, size * 2); break;
    case 'triangle': case 'triangle-open': ctx.moveTo(x, y - size); ctx.lineTo(x + size, y + size); ctx.lineTo(x - size, y + size); ctx.closePath(); break;
    case 'diamond': case 'diamond-open': ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath(); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const angle = (i * Math.PI) / 3; ctx[i === 0 ? 'moveTo' : 'lineTo'](x + size * Math.cos(angle), y + size * Math.sin(angle)); } ctx.closePath(); break;
    case 'plus': ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); break;
    case 'cross': const s = size * 0.7; ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); break;
    case 'asterisk': ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); const s2 = size * 0.7; ctx.moveTo(x - s2, y - s2); ctx.lineTo(x + s2, y + s2); ctx.moveTo(x + s2, y - s2); ctx.lineTo(x - s2, y + s2); break;
    default: ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  const lineWidth = strokeWidth ?? (2 * drawScale) / scale;
  if (shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape)) {
    ctx.lineWidth = lineWidth; ctx.stroke();
  } else {
    ctx.fill();
  }
};

const ShapeIcon = ({ shape, color = '#333' }: { shape: string, color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 20 20">
    <g fill={shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape) ? 'none' : color}
       stroke={color}
       strokeWidth={shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape) ? "3" : "0"}>
      {shape.startsWith('circle') && <circle cx="10" cy="10" r="8" />}
      {shape.startsWith('square') && <rect x="3" y="3" width="14" height="14" />}
      {shape.startsWith('triangle') && <polygon points="10,2 18,18 2,18" />}
      {shape.startsWith('diamond') && <polygon points="10,2 18,10 10,18 2,10" />}
      {shape.startsWith('hexagon') && <polygon points="10,2 17,6 17,14 10,18 3,14 3,6" />}
      {shape === 'plus' && <path d="M10,2 L10,18 M2,10 L18,10" />}
      {shape === 'cross' && <path d="M4,4 L16,16 M16,4 L4,16" />}
      {shape === 'asterisk' && <path d="M10,2 L10,18 M2,10 L18,10 M4,4 L16,16 M16,4 L4,16" />}
    </g>
  </svg>
);

// Line type name ↔ dash pattern mapping
const LINE_TYPE_PATTERNS: Record<string, number[]> = {
    'solid': [],
    'dash': [5, 5],
    'dot': [2, 2],
    'longdash': [10, 5],
    'dotdash': [20, 5, 5, 5]
};
const DEFAULT_LINE_TYPE_NAMES = ['solid', 'dash', 'dot', 'longdash', 'dotdash'];

// Tooltip field label lookup
const TOOLTIP_LABELS: Record<string, string> = {
  file_id: 'File ID', word: 'Word', syllable: 'Syllable', syllable_mark: 'Syllable Mark',
  canonical_stress: 'Expected Stress', lexical_stress: 'Transcribed Stress',
  canonical: 'Phoneme', produced: 'Allophone', alignment: 'Alignment',
  type: 'Type', canonical_type: 'Vowel Category', voice_pitch: 'Voice Pitch',
  xmin: 'Time (xmin)', duration: 'Duration',
};

// Get tooltip field value from a token
const getTooltipValue = (token: SpeechToken, field: string): string => {
  // Built-in fields with formatting
  if (field === 'xmin') return `${token.xmin.toFixed(3)}s`;
  if (field === 'duration') return `${token.duration.toFixed(3)}s`;
  // Built-in string fields
  if (field in token && field !== 'id' && field !== 'trajectory' && field !== 'customFields') {
    return String((token as any)[field] ?? '');
  }
  // Custom fields
  return token.customFields?.[field] ?? '';
};

// Reusable function to compute mappings for a layer
function computeMappings(data: SpeechToken[], config: PlotConfig, styleOverrides?: StyleOverrides) {
    const colorKey = config.colorBy === 'none' ? null : config.colorBy;
    const shapeKey = config.shapeBy === 'none' ? null : config.shapeBy;
    const lineTypeKey = config.lineTypeBy === 'none' ? null : config.lineTypeBy;

    const colorValues = Array.from(new Set(data.map(t => getLabel(t, colorKey || '')))).filter(v => v !== '').sort();
    const shapeValues = Array.from(new Set(data.map(t => getLabel(t, shapeKey || '')))).filter(v => v !== '').sort();
    const lineTypeValues = Array.from(new Set(data.map(t => getLabel(t, lineTypeKey || '')))).filter(v => v !== '').sort();

    const palette = config.bwMode ? BW_COLORS : COLORS;
    const colorMap: Record<string, string> = {};
    colorValues.forEach((v: string, i) => { colorMap[v] = styleOverrides?.colors[v] || palette[i % palette.length]; });

    const shapeMap: Record<string, string> = {};
    shapeValues.forEach((v: string, i) => { shapeMap[v] = styleOverrides?.shapes[v] || SHAPES[i % SHAPES.length]; });

    const lineTypeMap: Record<string, number[]> = {};
    const lineTypeNameMap: Record<string, string> = {};
    lineTypeValues.forEach((v: string, i) => {
        const overrideName = styleOverrides?.lineTypes?.[v];
        const name = (overrideName && LINE_TYPE_PATTERNS[overrideName]) ? overrideName : DEFAULT_LINE_TYPE_NAMES[i % DEFAULT_LINE_TYPE_NAMES.length];
        lineTypeNameMap[v] = name;
        lineTypeMap[v] = LINE_TYPE_PATTERNS[name] || [];
    });

    const colorCounts: Record<string, number> = {};
    const shapeCounts: Record<string, number> = {};
    const lineTypeCounts: Record<string, number> = {};

    if (colorKey) { data.forEach(t => { const k = getLabel(t, colorKey); colorCounts[k] = (colorCounts[k] || 0) + 1; }); }
    if (shapeKey) { data.forEach(t => { const k = getLabel(t, shapeKey); shapeCounts[k] = (shapeCounts[k] || 0) + 1; }); }
    if (lineTypeKey) { data.forEach(t => { const k = getLabel(t, lineTypeKey); lineTypeCounts[k] = (lineTypeCounts[k] || 0) + 1; }); }

    return { colorMap, shapeMap, lineTypeMap, lineTypeNameMap, colorKey, shapeKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts };
}

// Group data by visual encoding variables
function groupData(data: SpeechToken[], mappings: any, plotType: string) {
    const groups: Record<string, SpeechToken[]> = {};
    data.forEach(t => {
      let key = 'default';
      const cVal = mappings.colorKey ? getLabel(t, mappings.colorKey) : '';
      const sVal = mappings.shapeKey ? getLabel(t, mappings.shapeKey) : '';
      const lVal = mappings.lineTypeKey ? getLabel(t, mappings.lineTypeKey) : '';

      if (plotType === 'trajectory') {
          if (mappings.colorKey && mappings.lineTypeKey && mappings.colorKey !== mappings.lineTypeKey) key = `${cVal}|${lVal}`;
          else if (mappings.colorKey) key = cVal;
          else if (mappings.lineTypeKey) key = lVal;
      } else {
          if (mappings.colorKey && mappings.shapeKey && mappings.colorKey !== mappings.shapeKey) key = `${cVal}|${sVal}`;
          else if (mappings.colorKey) key = cVal;
          else if (mappings.shapeKey) key = sVal;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
}

const Legend = ({ layers, allMappings, onLegendClick }: {
    layers: Layer[],
    allMappings: Record<string, any>,
    onLegendClick?: any
}) => {
  const renderSection = (m: any, titleSuffix: string = '', layerId?: string, plotType?: string) => {
      if (!m) return null;
      const { colorMap, shapeMap, lineTypeMap, lineTypeNameMap, colorKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts } = m;
      // In trajectory mode shapes don't apply — ignore shapeKey for legend
      const shapeKey = plotType === 'trajectory' ? null : m.shapeKey;

      const handleClick = (key: string, type: 'color' | 'shape' | 'lineType', e: React.MouseEvent) => {
        if (onLegendClick) {
            onLegendClick(key, {
                color: (type === 'color' || colorKey) ? (colorMap[key] || '#000') : '#000',
                shape: (type === 'shape' || shapeKey) ? (shapeMap[key] || 'circle') : 'circle',
                texture: 0,
                lineType: (type === 'lineType' || lineTypeKey) ? (lineTypeNameMap[key] || 'solid') : 'solid'
            }, e, layerId);
        }
      };

      return (
        <div className="flex flex-col space-y-3 mb-4">
             {titleSuffix && <h3 className="text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 pb-1 mb-2">{titleSuffix}</h3>}

             {colorKey && (
               <div className="space-y-1.5">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center border-b border-slate-100 pb-1 mb-1">
                    <span>{colorKey}</span>
                 </h4>
                 {Object.keys(colorMap).sort().map(key => (
                   <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => handleClick(key, 'color', e)}>
                     <div className="flex items-center space-x-2">
                        {plotType === 'trajectory' ? (
                          <svg width="24" height="4" className="shrink-0">
                            <line x1="0" y1="2" x2="24" y2="2" stroke={colorMap[key]} strokeWidth="2"
                              strokeDasharray={lineTypeKey === colorKey && lineTypeMap[key]?.length ? lineTypeMap[key].join(',') : 'none'} />
                          </svg>
                        ) : shapeKey === colorKey ? (
                          <ShapeIcon shape={shapeMap[key]} color={colorMap[key]} />
                        ) : lineTypeKey === colorKey ? (
                          <svg width="24" height="4" className="shrink-0">
                            <line x1="0" y1="2" x2="24" y2="2" stroke={colorMap[key]} strokeWidth="2"
                              strokeDasharray={lineTypeMap[key]?.length ? lineTypeMap[key].join(',') : 'none'} />
                          </svg>
                        ) : (
                          <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: colorMap[key] }}></div>
                        )}
                        <span className="text-slate-700 font-medium truncate w-24">{key}</span>
                     </div>
                     <span className="text-slate-400 font-mono">({colorCounts ? (colorCounts[key] || 0) : 0})</span>
                   </div>
                 ))}
               </div>
             )}

             {shapeKey && shapeKey !== colorKey && (
               <div className="space-y-1.5 pt-2 border-t border-slate-100">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                    <span>{shapeKey}</span>
                 </h4>
                 {Object.keys(shapeMap).sort().map(key => (
                   <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => handleClick(key, 'shape', e)}>
                     <div className="flex items-center space-x-2">
                        <ShapeIcon shape={shapeMap[key]} color="#64748b" />
                        <span className="text-slate-700 font-medium truncate w-24">{key}</span>
                     </div>
                     <span className="text-slate-400 font-mono">({shapeCounts ? (shapeCounts[key] || 0) : 0})</span>
                   </div>
                 ))}
               </div>
             )}

             {lineTypeKey && lineTypeKey !== colorKey && (
               <div className="space-y-1.5 pt-2 border-t border-slate-100">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                    <span>{lineTypeKey}</span>
                 </h4>
                 {Object.keys(lineTypeMap).sort().map(key => (
                   <div key={key} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => handleClick(key, 'lineType', e)}>
                     <div className="flex items-center space-x-2">
                        <svg width="24" height="4" className="shrink-0">
                          <line x1="0" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="2"
                            strokeDasharray={lineTypeMap[key].length ? lineTypeMap[key].join(',') : 'none'} />
                        </svg>
                        <span className="text-slate-700 font-medium truncate w-24">{key}</span>
                     </div>
                     <span className="text-slate-400 font-mono">({lineTypeCounts ? (lineTypeCounts[key] || 0) : 0})</span>
                   </div>
                 ))}
               </div>
             )}
        </div>
      );
  };

  return (
    <div className="flex flex-col">
         {layers.filter(l => l.visible).map(layer => {
           const m = allMappings[layer.id];
           if (!m) return null;
           const showTitle = layers.filter(l => l.visible).length > 1;
           return <React.Fragment key={layer.id}>{renderSection(m, showTitle ? layer.name : '', layer.id, layer.config.plotType)}</React.Fragment>;
         })}
    </div>
  );
};

const CanvasPlot = forwardRef<PlotHandle, CanvasPlotProps>(({ layers, layerData, onLegendClick, datasetMeta }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  // Hover state uses refs + lightweight state to avoid triggering canvas redraws
  const hoveredTokenRef = useRef<SpeechToken | null>(null);
  const hoveredLayerIdRef = useRef<string | null>(null);
  const [hoverTick, setHoverTick] = useState(0); // lightweight trigger for tooltip re-render only
  const hoveredToken = hoveredTokenRef.current;
  const hoveredLayerId = hoveredLayerIdRef.current;
  const hoverRafRef = useRef<number | null>(null); // for requestAnimationFrame throttling
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Background layer always controls coordinate space
  const bgConfig = layers[0].config;

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => { if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current); };
  }, []);

  // Compute mappings for all layers
  const allMappings = useMemo(() => {
    const result: Record<string, any> = {};
    layers.forEach(layer => {
      const data = layerData[layer.id] || [];
      result[layer.id] = computeMappings(data, layer.config, layer.styleOverrides);
    });
    return result;
  }, [layers, layerData]);

  // Spatial grid index for O(1) hover hit-testing (rebuilt when data/config changes)
  const spatialGrid = useMemo(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return null;

    const CELL_SIZE = 20; // pixels per grid cell
    // Extend grid well beyond canvas bounds so extreme outliers are hoverable
    const originX = -width * 2;
    const originY = -height * 2;
    const gridW = width * 5;
    const gridH = height * 5;
    const cols = Math.ceil(gridW / CELL_SIZE);
    const rows = Math.ceil(gridH / CELL_SIZE);
    const grid: { token: SpeechToken; layerId: string; x: number; y: number }[][] = new Array(cols * rows);

    const mapX = (f2: number) => {
      const norm = (f2 - bgConfig.f2Range[0]) / (bgConfig.f2Range[1] - bgConfig.f2Range[0]);
      return bgConfig.invertX ? (1 - norm) * width : norm * width;
    };
    const mapY = (f1: number) => {
      const norm = (f1 - bgConfig.f1Range[0]) / (bgConfig.f1Range[1] - bgConfig.f1Range[0]);
      return bgConfig.invertY ? norm * height : (1 - norm) * height;
    };

    const addToGrid = (px: number, py: number, token: SpeechToken, layerId: string) => {
      const col = Math.floor((px - originX) / CELL_SIZE);
      const row = Math.floor((py - originY) / CELL_SIZE);
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        const idx = row * cols + col;
        if (!grid[idx]) grid[idx] = [];
        grid[idx].push({ token, layerId, x: px, y: py });
      }
    };

    layers.forEach(layer => {
      if (!layer.visible) return;
      const data = layerData[layer.id] || [];
      const config = layer.config;
      data.forEach(t => {
        if (config.plotType === 'trajectory') {
          const pts = t.trajectory
            .filter(p => p.time >= (config.trajectoryOnset ?? 0) && p.time <= (config.trajectoryOffset ?? 100));
          pts.forEach(pt => {
            const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
            const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
            if (isNaN(f1) || isNaN(f2)) return;
            addToGrid(mapX(f2), mapY(f1), t, layer.id);
          });
        } else {
          const nearestTime = findNearestTimePoint(t.trajectory, config.timePoint);
          const pt = nearestTime !== undefined ? t.trajectory.find(p => p.time === nearestTime) : undefined;
          if (!pt) return;
          const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
          const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
          if (isNaN(f1) || isNaN(f2)) return;
          addToGrid(mapX(f2), mapY(f1), t, layer.id);
        }
      });
    });

    return { grid, cols, rows, cellSize: CELL_SIZE, originX, originY };
  }, [layers, layerData, bgConfig.f1Range, bgConfig.f2Range, bgConfig.invertX, bgConfig.invertY]);

  // Helper functions for drawing individual layers
  const drawTrajectoryLayer = (
    ctx: CanvasRenderingContext2D,
    data: SpeechToken[],
    config: PlotConfig,
    mappings: any,
    groups: Record<string, SpeechToken[]>,
    mapX: (f2: number) => number,
    mapY: (f1: number) => number,
    scale: number,
    drawScale: number,
    exportConfig?: ExportConfig
  ) => {
    // 1. Draw Individual Lines (opacity controls visibility; 0 = hidden)
    {
        const lineOpacity = config.trajectoryLineOpacity !== undefined ? config.trajectoryLineOpacity : 0.5;
        if (lineOpacity > 0) {
            ctx.globalAlpha = lineOpacity;
            ctx.lineWidth = (1 * drawScale) / scale;

            data.forEach(t => {
                const color = mappings.colorKey ? (mappings.colorMap[getLabel(t, mappings.colorKey)] || '#64748b') : (config.bwMode ? '#000' : '#64748b');
                const lineTypeVal = mappings.lineTypeKey ? getLabel(t, mappings.lineTypeKey) : '';
                const lineDash = mappings.lineTypeKey ? (mappings.lineTypeMap[lineTypeVal] || []) : [];

                ctx.strokeStyle = color;
                ctx.setLineDash(lineDash.map((d: number) => (d * config.lineWidth * drawScale) / scale));

                const pts = t.trajectory
                    .filter(p => p.time >= (config.trajectoryOnset ?? 0) && p.time <= (config.trajectoryOffset ?? 100))
                    .map(p => {
                        const f1 = config.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1;
                        const f2 = config.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2;
                        if (f1 === undefined || f2 === undefined || isNaN(f1) || isNaN(f2)) return null;
                        return { x: mapX(f2), y: mapY(f1) };
                    }).filter(p => p !== null) as {x: number, y: number}[];

                if (pts.length < 2) return;

                ctx.beginPath();
                pts.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.stroke();

                // Draw arrows on individual lines
                if (config.showArrows && pts.length > 1) {
                    const last = pts[pts.length - 1];
                    const prev = pts[pts.length - 2];
                    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
                    const lw = 1;
                    const arrowLen = (6 * lw * drawScale) / scale;
                    const arrowWidth = (3 * lw * drawScale) / scale;

                    ctx.save();
                    ctx.translate(last.x, last.y);
                    ctx.rotate(angle);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(-arrowLen, -arrowWidth);
                    ctx.lineTo(-arrowLen, arrowWidth);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            });
            ctx.setLineDash([]);
        }
    }

    // 2. Draw Mean Trajectories
    if (config.showMeanTrajectories) {
        Object.entries(groups).forEach(([key, tokens]) => {
            let groupColor = config.bwMode ? '#000' : '#000';
            let lineDash: number[] = [];

            if (key.includes('|')) {
                const [c, l] = key.split('|');
                groupColor = mappings.colorMap[c] || groupColor;
                lineDash = mappings.lineTypeMap[l] || [];
            } else {
                if (mappings.colorKey) { groupColor = mappings.colorMap[key] || groupColor; }
                if (mappings.lineTypeKey) { lineDash = mappings.lineTypeMap[key] || []; }
            }

            // Derive time-steps from data rather than hardcoded 0-100
            const allTimes = new Set<number>();
            tokens.forEach(tk => tk.trajectory.forEach(p => allTimes.add(p.time)));
            const timeSteps = Array.from(allTimes).sort((a, b) => a - b)
              .filter(t => t >= (config.trajectoryOnset ?? 0) && t <= (config.trajectoryOffset ?? 100));
            const meanPts = timeSteps.map(t => {
                let sumF1 = 0, sumF2 = 0, count = 0;
                tokens.forEach(token => {
                    const pt = token.trajectory.find(p => p.time === t);
                    if (pt) {
                        const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
                        const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
                        if (f1 !== undefined && f2 !== undefined && !isNaN(f1) && !isNaN(f2)) {
                            sumF1 += f1; sumF2 += f2; count++;
                        }
                    }
                });
                if (count === 0) return null;
                return { x: mapX(sumF2 / count), y: mapY(sumF1 / count), time: t };
            }).filter(p => p !== null) as {x: number, y: number, time: number}[];

            if (meanPts.length < 2) return;

            ctx.globalAlpha = config.meanTrajectoryOpacity !== undefined ? config.meanTrajectoryOpacity : 1;
            ctx.lineWidth = ((config.meanTrajectoryWidth || 3) * drawScale) / scale;
            ctx.strokeStyle = groupColor;
            ctx.setLineDash(lineDash.map((d: number) => (d * (config.meanTrajectoryWidth || 3) * drawScale) / scale));

            ctx.beginPath();
            meanPts.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw points on mean trajectory if enabled
            if (config.showMeanTrajectoryPoints) {
                const ptSize = ((config.meanTrajectoryPointSize || 4) * drawScale) / scale;
                ctx.fillStyle = groupColor;
                meanPts.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, ptSize, 0, Math.PI * 2);
                    ctx.fill();
                });
            }

            // Draw arrow at end of mean trajectory
            if (config.showArrows && meanPts.length > 1) {
                const last = meanPts[meanPts.length - 1];
                const prev = meanPts[meanPts.length - 2];
                const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
                const arrowScale = config.meanTrajectoryArrowSize || 3;
                const mw = config.meanTrajectoryWidth || 3;
                const arrowLen = (arrowScale * mw * drawScale) / scale;
                const arrowWidth = (arrowScale * 0.5 * mw * drawScale) / scale;

                ctx.save();
                ctx.setLineDash([]);
                ctx.translate(last.x, last.y);
                ctx.rotate(angle);
                ctx.fillStyle = groupColor;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-arrowLen, -arrowWidth);
                ctx.lineTo(-arrowLen, arrowWidth);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Draw Label
            if (config.showTrajectoryLabels && meanPts.length > 0) {
                const labelPt = meanPts[Math.floor(meanPts.length / 2)];

                let label = key;
                if (key.includes('|')) {
                    const [c, l] = key.split('|');
                    if (config.meanLabelType === 'color') label = c;
                    else if (config.meanLabelType === 'shape') label = l;
                    else if (config.meanLabelType === 'both') label = `${c} ${l}`;
                }

                const labelSize = exportConfig ? exportConfig.dataLabelSize : (drawScale > 1.5 ? 36 : config.meanTrajectoryLabelSize || config.labelSize);
                ctx.font = `bold ${(labelSize * drawScale) / scale}px Inter`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = groupColor;
                ctx.strokeStyle = 'white';
                ctx.lineWidth = (3 * drawScale) / scale;
                ctx.strokeText(label, labelPt.x, labelPt.y);
                ctx.fillText(label, labelPt.x, labelPt.y);
            }
        });
    }
  };

  const drawPointLayer = (
    ctx: CanvasRenderingContext2D,
    data: SpeechToken[],
    config: PlotConfig,
    mappings: any,
    groups: Record<string, SpeechToken[]>,
    mapX: (f2: number) => number,
    mapY: (f1: number) => number,
    scale: number,
    drawScale: number,
    exportConfig?: ExportConfig
  ) => {
    // Ellipses
    if (config.showEllipses) {
      Object.entries(groups).forEach(([key, tokens]) => {
        if (tokens.length < 3) return;
        let groupColor = config.bwMode ? '#000' : '#64748b';
        if (key.includes('|')) { const [c] = key.split('|'); groupColor = mappings.colorMap[c] || groupColor; }
        else if (mappings.colorKey) { groupColor = mappings.colorMap[key] || groupColor; }

        const pts = tokens.map(t => {
          const nearestTime = findNearestTimePoint(t.trajectory, config.timePoint);
          const p = nearestTime !== undefined ? t.trajectory.find(pt => pt.time === nearestTime) : undefined;
          const f1 = config.useSmoothing && p ? (p.f1_smooth ?? p.f1) : p?.f1;
          const f2 = config.useSmoothing && p ? (p.f2_smooth ?? p.f2) : p?.f2;
          if (!p || f1 === undefined || f2 === undefined || isNaN(f1) || isNaN(f2)) return null;
          return { x: mapX(f2), y: mapY(f1) };
        }).filter(p => p !== null) as {x: number, y: number}[];

        if (pts.length < 3) return;
        let mx = 0, my = 0;
        pts.forEach(p => { mx += p.x; my += p.y; });
        mx /= pts.length; my /= pts.length;
        let sxx = 0, syy = 0, sxy = 0;
        pts.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); });
        sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
        const common = Math.sqrt((sxx - syy) ** 2 + 4 * (sxy ** 2));
        const l1 = (sxx + syy + common) / 2;
        const l2 = (sxx + syy - common) / 2;
        const angle = Math.atan2(l1 - sxx, sxy);

        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.strokeStyle = groupColor;
        ctx.fillStyle = groupColor;
        ctx.globalAlpha = config.ellipseFillOpacity;
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.sqrt(l1) * config.ellipseSD, Math.sqrt(l2) * config.ellipseSD, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = config.ellipseLineOpacity;
        ctx.lineWidth = ((config.ellipseLineWidth || 1.5) * drawScale) / scale;
        ctx.stroke();
        ctx.restore();
      });
    }

    // Points
    if (config.showPoints) {
      ctx.globalAlpha = config.pointOpacity;
      data.forEach(t => {
        const nearestTime = findNearestTimePoint(t.trajectory, config.timePoint);
        const pt = nearestTime !== undefined ? t.trajectory.find(p => p.time === nearestTime) : undefined;
        if (!pt) return;
        const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
        const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
        if (isNaN(f1) || isNaN(f2)) return;
        const x = mapX(f2);
        const y = mapY(f1);
        const color = mappings.colorKey ? (mappings.colorMap[getLabel(t, mappings.colorKey)] || '#64748b') : (config.bwMode ? '#000' : '#64748b');
        const shape = mappings.shapeKey ? (mappings.shapeMap[getLabel(t, mappings.shapeKey)] || 'circle') : 'circle';
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        drawShape(ctx, shape, x, y, (config.pointSize * drawScale) / scale, scale, drawScale);
      });
    }

    // Centroids
    if (config.showCentroids) {
      ctx.globalAlpha = config.centroidOpacity;
      Object.entries(groups).forEach(([key, tokens]) => {
        let groupColor = config.bwMode ? '#000' : '#000';
        let label = key;
        let shape = 'circle';
        if (key.includes('|')) {
            const [c, s] = key.split('|'); groupColor = mappings.colorMap[c] || '#000'; shape = mappings.shapeMap[s] || 'circle';
            if (config.meanLabelType === 'color') label = c;
            else if (config.meanLabelType === 'shape') label = s;
            else if (config.meanLabelType === 'both') label = `${c} ${s}`;
        } else {
            if (mappings.colorKey) { groupColor = mappings.colorMap[key] || '#000'; if (mappings.shapeKey === mappings.colorKey) shape = mappings.shapeMap[key] || 'circle'; }
            if (mappings.shapeKey && !mappings.colorKey) shape = mappings.shapeMap[key] || 'circle';
        }

        const pts = tokens.map(t => {
          const nearestTime = findNearestTimePoint(t.trajectory, config.timePoint);
          const p = nearestTime !== undefined ? t.trajectory.find(pt => pt.time === nearestTime) : undefined;
          const f1 = config.useSmoothing && p ? (p.f1_smooth ?? p.f1) : p?.f1;
          const f2 = config.useSmoothing && p ? (p.f2_smooth ?? p.f2) : p?.f2;
          if (!p || f1 === undefined || f2 === undefined || isNaN(f1) || isNaN(f2)) return null;
          return { x: mapX(f2), y: mapY(f1) };
        }).filter(p => p !== null) as {x: number, y: number}[];
        if (pts.length === 0) return;

        let mx = 0, my = 0;
        pts.forEach(p => { mx += p.x; my += p.y; });
        mx /= pts.length; my /= pts.length;

        ctx.fillStyle = groupColor;
        ctx.strokeStyle = groupColor;

        if (config.labelAsCentroid) {
          const labelBase = exportConfig ? exportConfig.dataLabelSize : (drawScale > 1.5 ? 36 : config.labelSize);
          ctx.font = `bold ${(labelBase * drawScale) / scale}px Inter`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'white';
          ctx.lineWidth = (4 * drawScale) / scale;
          ctx.lineJoin = 'round';
          ctx.strokeText(label, mx, my);
          ctx.fillText(label, mx, my);
        } else {
          const centroidSize = (config.centroidSize * drawScale) / scale;
          // White halo: always draw as the filled (closed) variant
          const closedShape = shape.replace('-open', '');
          ctx.save();
          ctx.fillStyle = 'white';
          ctx.strokeStyle = 'white';
          drawShape(ctx, closedShape, mx, my, centroidSize + ((2*drawScale)/scale), scale, drawScale);
          ctx.fill();
          ctx.restore();
          // Colored centroid — draw the actual shape (respecting open/closed)
          // Scale stroke width with centroid size for open shapes
          const centroidStroke = centroidSize * 0.25;
          ctx.fillStyle = groupColor;
          ctx.strokeStyle = groupColor;
          drawShape(ctx, shape, mx, my, centroidSize, scale, drawScale, centroidStroke);
          if (!['plus', 'cross', 'asterisk'].includes(shape) && !shape.endsWith('-open')) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = (2 * drawScale) / scale;
            ctx.stroke();
          }
        }
      });
    }
  };

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, translate: {x:number, y:number}, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);

    // Grid/axes always use background (layers[0]) config for coordinate space
    const mapX = (f2: number) => {
      const norm = (f2 - bgConfig.f2Range[0]) / (bgConfig.f2Range[1] - bgConfig.f2Range[0]);
      return bgConfig.invertX ? (1 - norm) * width : norm * width;
    };
    const mapY = (f1: number) => {
      const norm = (f1 - bgConfig.f1Range[0]) / (bgConfig.f1Range[1] - bgConfig.f1Range[0]);
      return bgConfig.invertY ? norm * height : (1 - norm) * height;
    };

    // Grid
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#94a3b8';

    const isExport = !!exportConfig;
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 28 : 11);
    const tickFontSize = (tickBaseSize * drawScale) / scale;

    ctx.font = `bold ${tickFontSize}px Inter`;

    const f2Span = bgConfig.f2Range[1] - bgConfig.f2Range[0];
    const f2Step = f2Span > 1500 ? 500 : 250;
    const startF2 = Math.ceil(bgConfig.f2Range[0] / f2Step) * f2Step;

    const f1Span = bgConfig.f1Range[1] - bgConfig.f1Range[0];
    const f1Step = f1Span > 800 ? 200 : 100;
    const startF1 = Math.ceil(bgConfig.f1Range[0] / f1Step) * f1Step;

    const tickOffset = isExport ? (10 * drawScale) : (4 * drawScale);
    const cornerThreshold = 30 * drawScale / scale;

    for (let f2 = startF2; f2 <= bgConfig.f2Range[1]; f2 += f2Step) {
      const x = mapX(f2);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      if (x > cornerThreshold) {
          const xOffset = exportConfig ? (exportConfig.xAxisTickX || 0) * drawScale : 0;
          const yOffset = exportConfig ? (exportConfig.xAxisTickY || 0) * drawScale : 0;
          ctx.fillText(`${f2}`, x + (2*drawScale) + xOffset, height - tickOffset + yOffset);
      }
    }
    for (let f1 = startF1; f1 <= bgConfig.f1Range[1]; f1 += f1Step) {
      const y = mapY(f1);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      if (y < height - cornerThreshold) {
          const xOffset = exportConfig ? (exportConfig.yAxisTickX || 0) * drawScale : 0;
          const yOffset = exportConfig ? (exportConfig.yAxisTickY || 0) * drawScale : 0;
          ctx.fillText(`${f1}`, tickOffset + xOffset, y - (2*drawScale) + yOffset);
      }
    }

    // Draw each visible layer in order
    layers.forEach(layer => {
      if (!layer.visible) return;
      const data = layerData[layer.id] || [];
      if (data.length === 0) return;
      const mappings = allMappings[layer.id];
      if (!mappings) return;
      const groups = groupData(data, mappings, layer.config.plotType);

      if (layer.config.plotType === 'trajectory') {
        drawTrajectoryLayer(ctx, data, layer.config, mappings, groups, mapX, mapY, scale, drawScale, exportConfig);
      } else {
        drawPointLayer(ctx, data, layer.config, mappings, groups, mapX, mapY, scale, drawScale, exportConfig);
      }
    });

    ctx.restore();
  }, [layers, layerData, allMappings, bgConfig]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
      let curY = y;
      const isExport = !!exportConfig;

      const fontSizeTitle = exportConfig ? exportConfig.legendTitleSize : (isExport ? 36 : 14) * drawScale;
      const fontSizeItem = exportConfig ? exportConfig.legendItemSize : (isExport ? 24 : 12) * drawScale;
      const spacing = fontSizeItem * 1.6;
      const circleSize = fontSizeItem * 0.5;
      const xOffset = fontSizeItem * 1.5;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';

      interface SectionOpts {
          showColor: boolean;
          colorTitle: string;
          showShape: boolean;
          shapeTitle: string;
          showLineType: boolean;
          lineTypeTitle: string;
      }

      const drawSection = (m: any, opts: SectionOpts, titleSuffix: string = '', layerPlotType?: string) => {
          if (!m) return;
          const { colorMap, shapeMap, lineTypeMap, colorKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts } = m;
          // In trajectory mode shapes don't apply
          const shapeKey = layerPlotType === 'trajectory' ? null : m.shapeKey;

          if (opts.showColor && colorKey) {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              const title = opts.colorTitle || colorKey.toUpperCase();
              ctx.fillStyle = '#0f172a';
              ctx.fillText(title + titleSuffix, x, curY);
              curY += fontSizeTitle * 1.4;

              ctx.font = `${fontSizeItem}px Inter`;
              Object.entries(colorMap).sort().forEach(([k, c]) => {
                  const count = colorCounts ? (colorCounts[k] || 0) : 0;
                  ctx.fillStyle = c as string;
                  ctx.strokeStyle = c as string;
                  if (layerPlotType === 'trajectory') {
                    // Trajectory: always draw colored line segment
                    ctx.lineWidth = (2 * drawScale);
                    ctx.setLineDash(lineTypeKey === colorKey && lineTypeMap[k]?.length ? (lineTypeMap[k] as number[]).map((d: number) => d * drawScale) : []);
                    ctx.beginPath();
                    ctx.moveTo(x, curY + (circleSize/2));
                    ctx.lineTo(x + (circleSize * 2), curY + (circleSize/2));
                    ctx.stroke();
                    ctx.setLineDash([]);
                  } else if (shapeKey === colorKey && shapeMap[k]) {
                    // Combined: draw colored shape
                    drawShape(ctx, shapeMap[k] as string, x + (circleSize), curY + (circleSize/2), (circleSize * 0.8), 1, drawScale);
                  } else {
                    ctx.beginPath(); ctx.arc(x + (circleSize), curY + (circleSize/2), circleSize, 0, Math.PI*2); ctx.fill();
                  }
                  ctx.fillStyle = '#334155';
                  ctx.fillText(`${k} ${count ? `(n=${count})` : ''}`, x + xOffset, curY + (circleSize/2));
                  curY += spacing;
              });
              curY += fontSizeTitle;
          }

          if (opts.showShape && shapeKey && shapeKey !== colorKey) {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              const title = opts.shapeTitle || shapeKey.toUpperCase();
              ctx.fillStyle = '#0f172a';
              ctx.fillText(title + titleSuffix, x, curY);
              curY += fontSizeTitle * 1.4;

              ctx.font = `${fontSizeItem}px Inter`;
              Object.entries(shapeMap).sort().forEach(([k, s]) => {
                  const count = shapeCounts ? (shapeCounts[k] || 0) : 0;
                  ctx.fillStyle = '#64748b';
                  ctx.strokeStyle = '#64748b';
                  drawShape(ctx, s as string, x + (circleSize), curY + (circleSize/2), (circleSize * 0.8), 1, drawScale);
                  ctx.fillStyle = '#334155';
                  ctx.fillText(`${k} ${count ? `(n=${count})` : ''}`, x + xOffset, curY + (circleSize/2));
                  curY += spacing;
              });
              curY += fontSizeTitle;
          }

          if (opts.showLineType && lineTypeKey && lineTypeKey !== colorKey) {
             ctx.font = `bold ${fontSizeTitle}px Inter`;
             const title = opts.lineTypeTitle || lineTypeKey.toUpperCase();
             ctx.fillStyle = '#0f172a';
             ctx.fillText(title + titleSuffix, x, curY);
             curY += fontSizeTitle * 1.4;

             ctx.font = `${fontSizeItem}px Inter`;
             Object.entries(lineTypeMap).sort().forEach(([k, dash]) => {
                 const count = lineTypeCounts ? (lineTypeCounts[k] || 0) : 0;
                 ctx.strokeStyle = '#64748b';
                 ctx.lineWidth = (2 * drawScale);
                 ctx.setLineDash((dash as number[]).map(d => d * drawScale));
                 ctx.beginPath();
                 ctx.moveTo(x, curY + (circleSize/2));
                 ctx.lineTo(x + (circleSize * 2), curY + (circleSize/2));
                 ctx.stroke();
                 ctx.setLineDash([]);

                 ctx.fillStyle = '#334155';
                 ctx.fillText(`${k} ${count ? `(n=${count})` : ''}`, x + xOffset + circleSize, curY + (circleSize/2));
                 curY += spacing;
             });
             curY += fontSizeTitle;
          }
      };

      // Determine which layers to draw legend for
      const legendLayerIds = exportConfig?.legendLayers || layers.filter(l => l.visible).map(l => l.id);
      const legendLayers = legendLayerIds.map(id => layers.find(l => l.id === id)).filter(Boolean) as Layer[];
      const showMultiple = legendLayers.length > 1;

      legendLayers.forEach(layer => {
          const m = allMappings[layer.id];
          if (!m) return;

          // Find per-layer legend config if available
          const layerLegendCfg = exportConfig?.layerLegends?.find(ll => ll.layerId === layer.id);

          const opts: SectionOpts = {
              showColor: layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showColorLegend !== false),
              colorTitle: layerLegendCfg?.colorTitle || '',
              showShape: layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showShapeLegend !== false),
              shapeTitle: layerLegendCfg?.shapeTitle || '',
              showLineType: layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showLineTypeLegend !== false),
              lineTypeTitle: layerLegendCfg?.lineTypeTitle || '',
          };

          drawSection(m, opts, showMultiple ? ` (${layer.name})` : '', layer.config.plotType);
      });
  };

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
      const offscreen = document.createElement('canvas');
      const drawScale = exportConfig.scale;

      const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
      const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
      const basePlotWidth = 2400 * graphScaleX;
      const basePlotHeight = 2000 * graphScaleY;

      const graphX = (exportConfig.graphX || 0) * drawScale;
      const graphY = (exportConfig.graphY || 0) * drawScale;

      const margin = {
          top: ((exportConfig.showPlotTitle ? 200 : 100) * drawScale) + graphY,
          right: 100 * drawScale,
          bottom: 140 * drawScale,
          left: (200 * drawScale) + graphX
      };

      let legendSpaceRight = 0;
      let legendSpaceBottom = 0;

      if (exportConfig.showLegend) {
          if (exportConfig.legendPosition === 'right') {
              legendSpaceRight = 800 * drawScale;
          } else if (exportConfig.legendPosition === 'bottom') {
              legendSpaceBottom = 800 * drawScale;
          }
      }

      const plotWidth = basePlotWidth * drawScale;
      const plotHeight = basePlotHeight * drawScale;

      offscreen.width = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : Math.max(100, plotWidth + legendSpaceRight + margin.left + margin.right));
      offscreen.height = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : Math.max(100, plotHeight + legendSpaceBottom + margin.top + margin.bottom));
      const ctx = offscreen.getContext('2d');
      if (!ctx) return '';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);

      // Draw Title
      if (exportConfig.showPlotTitle && exportConfig.plotTitle) {
          ctx.save();
          ctx.fillStyle = '#0f172a';
          ctx.font = `bold ${exportConfig.plotTitleSize! * drawScale}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const defaultTitleX = exportConfig.legendPosition === 'right'
              ? margin.left + (plotWidth / 2)
              : offscreen.width / 2;
          const titleX = defaultTitleX + ((exportConfig.plotTitleX || 0) * drawScale);
          const titleY = (margin.top / 2) + ((exportConfig.plotTitleY || 0) * drawScale);
          ctx.fillText(exportConfig.plotTitle, titleX, titleY);
          ctx.restore();
      }

      ctx.save();
      ctx.translate(margin.left, margin.top);

      renderPlot(ctx, plotWidth, plotHeight, 1, {x: 0, y: 0}, drawScale, exportConfig);

      ctx.fillStyle = '#000000';

      const xAxisSize = exportConfig.xAxisLabelSize * drawScale;
      ctx.font = `bold ${xAxisSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      const xAxisTitleX = (plotWidth / 2) + ((exportConfig.xAxisLabelX || 0) * drawScale);
      const xAxisTitleY = plotHeight + (85 * drawScale) + ((exportConfig.xAxisLabelY || 0) * drawScale);
      ctx.fillText('F2 (Hz)', xAxisTitleX, xAxisTitleY);

      const yAxisSize = exportConfig.yAxisLabelSize * drawScale;
      ctx.font = `bold ${yAxisSize}px Inter, sans-serif`;
      ctx.save();

      const yAxisTitleX = -(160 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
      const yAxisTitleY = (plotHeight / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
      ctx.translate(yAxisTitleX, yAxisTitleY);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('F1 (Hz)', 0, 0);
      ctx.restore();

      ctx.restore();

      if (exportConfig.showLegend) {
          ctx.save();
          let lx = 0, ly = 0;

          if (exportConfig.legendPosition === 'right') {
              lx = margin.left + plotWidth + (40 * drawScale);
              ly = margin.top;
          } else if (exportConfig.legendPosition === 'bottom') {
              lx = margin.left;
              ly = margin.top + plotHeight + (150 * drawScale);
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

          if (['inside-top-right', 'inside-top-left', 'custom'].includes(exportConfig.legendPosition!)) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          }

          drawLegend(ctx, lx, ly, legendSpaceRight || (800 * drawScale), drawScale, exportConfig);
          ctx.restore();
      }

      return offscreen.toDataURL('image/png');
    };

    return {
        exportImage: () => {
            const defaultExportConfig: ExportConfig = {
                scale: 3, xAxisLabelSize: 32, yAxisLabelSize: 32, tickLabelSize: 24, dataLabelSize: 24,
                showLegend: true, legendTitleSize: 36, legendItemSize: 24,
                legendPosition: 'right', legendX: 0, legendY: 0,
                showPlotTitle: false, plotTitle: 'Vowel Space Plot', plotTitleSize: 48,
                showColorLegend: true, colorLegendTitle: 'COLOR',
                showShapeLegend: true, shapeLegendTitle: 'SHAPE',
                showTextureLegend: true, textureLegendTitle: 'TEXTURE',
                showLineTypeLegend: true, lineTypeLegendTitle: 'LINE TYPE',
            };
            const url = generateImage(defaultExportConfig);
            if(url) {
                const link = document.createElement('a');
                link.download = 'vowel_space_plot.png';
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
        renderPlot(ctx, width, height, transform.scale, {x: transform.x, y: transform.y}, 1);
        ctx.restore();
    }
  }, [layers, layerData, transform, allMappings, renderPlot]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else {
      // Throttle hover hit-testing to one per animation frame
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (hoverRafRef.current !== null) return; // already pending
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        if (!spatialGrid) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (clientX - rect.left - transform.x) / transform.scale;
        const mouseY = (clientY - rect.top - transform.y) / transform.scale;

        // Spatial grid lookup: check mouse cell + 8 neighbors
        const { grid, cols, rows, cellSize, originX, originY } = spatialGrid;
        const col = Math.floor((mouseX - originX) / cellSize);
        const row = Math.floor((mouseY - originY) / cellSize);
        let closest: SpeechToken | null = null;
        let closestLayerId: string | null = null;
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
              if (dist < minDist) {
                minDist = dist;
                closest = entry.token;
                closestLayerId = entry.layerId;
              }
            }
          }
        }

        // Only trigger re-render if hover actually changed
        if (hoveredTokenRef.current !== closest) {
          hoveredTokenRef.current = closest;
          hoveredLayerIdRef.current = closestLayerId;
          setHoverTick(t => t + 1); // lightweight re-render for tooltip only
        }
      });
    }
  };

  const handleMouseUp = () => { isDragging.current = false; };
  const handleMouseLeave = () => {
    isDragging.current = false;
    if (hoverRafRef.current !== null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    if (hoveredTokenRef.current !== null) {
      hoveredTokenRef.current = null;
      hoveredLayerIdRef.current = null;
      setHoverTick(t => t + 1);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
    setTransform(t => ({ ...t, scale: Math.max(0.1, Math.min(50, t.scale * scaleFactor)) }));
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-white select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        className="cursor-move"
      />
      <div className="absolute bottom-4 left-4 flex space-x-2">
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 1.2 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">+</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 0.8 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">-</button>
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="px-3 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[10px] font-bold">RESET VIEW</button>
      </div>
      {hoveredToken && (() => {
        const hoveredLayer = hoveredLayerId ? layers.find(l => l.id === hoveredLayerId) : layers[0];
        const fields = hoveredLayer?.config.tooltipFields || [];
        if (fields.length === 0) {
          return (
            <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md min-w-[200px]">
              <p className="text-slate-400 italic text-center">Select fields from the <span className="text-sky-400 font-bold">Tooltip</span> dropdown to see token data here.</p>
            </div>
          );
        }
        const getFieldLabel = (key: string) => {
          if (TOOLTIP_LABELS[key]) return TOOLTIP_LABELS[key];
          // Custom field — title-case the key
          return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };
        const [firstField, ...restFields] = fields;
        return (
          <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
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
      <div className="absolute right-4 top-4 max-h-[85%] overflow-y-auto w-64 z-40">
        <Legend layers={layers} allMappings={allMappings} onLegendClick={onLegendClick} />
      </div>
    </div>
  );
});

export default CanvasPlot;
