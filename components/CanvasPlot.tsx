
// ... existing imports
import React, { useRef, useEffect, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig } from '../types';

interface CanvasPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
  overlayData?: SpeechToken[];
  overlayConfig?: PlotConfig;
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

const getLabel = (t: SpeechToken, key: string): string => {
  if (!key || key === 'none') return '';
  if (key === 'phoneme') return t.canonical;
  if (key === 'syllable_mark') {
    const val = parseInt(t.syllable_mark, 10);
    if (isNaN(val)) return t.syllable_mark;
    return val > 0 ? 'accepted' : 'rejected';
  }
  const val = (t as any)[key];
  return val !== undefined && val !== null ? String(val) : '';
};

const drawShape = (ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, scale: number, drawScale: number = 1) => {
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
  const lineWidth = (2 * drawScale) / scale;
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

const Legend = ({ data, mappings, config, onLegendClick, overlayMappings, overlayConfig }: { 
    data: SpeechToken[], 
    mappings: any, 
    config: PlotConfig, 
    onLegendClick?: any,
    overlayMappings?: any,
    overlayConfig?: PlotConfig
}) => {
  const source = config.legendSource || 'background';

  const renderSection = (m: any, titleSuffix: string = '') => {
      if (!m) return null;
      const { colorMap, shapeMap, lineTypeMap, colorKey, shapeKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts } = m;
      
      const handleClick = (key: string, type: 'color' | 'shape' | 'lineType', e: React.MouseEvent) => {
        if (onLegendClick) {
            onLegendClick(key, {
                color: type === 'color' ? colorMap[key] : '#000',
                shape: type === 'shape' ? shapeMap[key] : 'circle',
                texture: 0,
                lineType: type === 'lineType' ? lineTypeMap[key] : []
            }, e);
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
                        <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: colorMap[key] }}></div>
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
                        <div className="w-6 h-0.5 bg-slate-400" style={{ borderBottom: lineTypeMap[key].length ? '2px dashed #94a3b8' : '2px solid #94a3b8' }}></div>
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
         {(source === 'background' || source === 'both') && renderSection(mappings, source === 'both' ? 'Background' : '')}
         {(source === 'overlay' || source === 'both') && overlayMappings && renderSection(overlayMappings, 'Overlay')}
    </div>
  );
};

const CanvasPlot = forwardRef<PlotHandle, CanvasPlotProps>(({ data, config, styleOverrides, onLegendClick, overlayData, overlayConfig }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const mappings = useMemo(() => {
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
    const lineTypes = [[], [5, 5], [2, 2], [10, 5], [15, 5], [20, 5, 5, 5]];
    lineTypeValues.forEach((v: string, i) => { 
        // If styleOverrides has lineTypes as string (e.g. 'solid', 'dash'), we need to map to number[]
        // For now, assume simple mapping or default
        lineTypeMap[v] = lineTypes[i % lineTypes.length]; 
    });

    const colorCounts: Record<string, number> = {};
    const shapeCounts: Record<string, number> = {};
    const lineTypeCounts: Record<string, number> = {};

    if (colorKey) { data.forEach(t => { const k = getLabel(t, colorKey); colorCounts[k] = (colorCounts[k] || 0) + 1; }); }
    if (shapeKey) { data.forEach(t => { const k = getLabel(t, shapeKey); shapeCounts[k] = (shapeCounts[k] || 0) + 1; }); }
    if (lineTypeKey) { data.forEach(t => { const k = getLabel(t, lineTypeKey); lineTypeCounts[k] = (lineTypeCounts[k] || 0) + 1; }); }

    return { colorMap, shapeMap, lineTypeMap, colorKey, shapeKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts };
  }, [data, config.colorBy, config.shapeBy, config.lineTypeBy, config.bwMode, styleOverrides]);

  const overlayMappings = useMemo(() => {
    if (!overlayData || !overlayConfig) return null;
    const colorKey = overlayConfig.colorBy === 'none' ? null : overlayConfig.colorBy;
    const lineTypeKey = overlayConfig.lineTypeBy === 'none' ? null : overlayConfig.lineTypeBy;
    const shapeKey = overlayConfig.shapeBy === 'none' ? null : overlayConfig.shapeBy;
    
    const colorValues = Array.from(new Set(overlayData.map(t => getLabel(t, colorKey || '')))).filter(v => v !== '').sort();
    const lineTypeValues = Array.from(new Set(overlayData.map(t => getLabel(t, lineTypeKey || '')))).filter(v => v !== '').sort();
    const shapeValues = Array.from(new Set(overlayData.map(t => getLabel(t, shapeKey || '')))).filter(v => v !== '').sort();
    
    const palette = overlayConfig.bwMode ? BW_COLORS : COLORS;
    const colorMap: Record<string, string> = {};
    colorValues.forEach((v: string, i) => { colorMap[v] = styleOverrides?.colors[v] || palette[i % palette.length]; });
    
    const lineTypeMap: Record<string, number[]> = {};
    const lineTypes = [[], [5, 5], [2, 2], [10, 5], [15, 5], [20, 5, 5, 5]];
    lineTypeValues.forEach((v: string, i) => { lineTypeMap[v] = styleOverrides?.lineTypes[v] || lineTypes[i % lineTypes.length]; });
    
    const shapeMap: Record<string, string> = {};
    shapeValues.forEach((v: string, i) => { shapeMap[v] = styleOverrides?.shapes[v] || SHAPES[i % SHAPES.length]; });
    
    const colorCounts: Record<string, number> = {};
    const lineTypeCounts: Record<string, number> = {};
    const shapeCounts: Record<string, number> = {};
    
    if (colorKey) { overlayData.forEach(t => { const k = getLabel(t, colorKey); colorCounts[k] = (colorCounts[k] || 0) + 1; }); }
    if (lineTypeKey) { overlayData.forEach(t => { const k = getLabel(t, lineTypeKey); lineTypeCounts[k] = (lineTypeCounts[k] || 0) + 1; }); }
    if (shapeKey) { overlayData.forEach(t => { const k = getLabel(t, shapeKey); shapeCounts[k] = (shapeCounts[k] || 0) + 1; }); }

    return { colorMap, lineTypeMap, shapeMap, colorKey, lineTypeKey, shapeKey, colorCounts, lineTypeCounts, shapeCounts };
  }, [overlayData, overlayConfig, styleOverrides]);

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
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#94a3b8';
    
    // Balanced Sizing
    const isExport = drawScale > 1.5;
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 28 : 11);
    const tickFontSize = (tickBaseSize * drawScale) / scale;
    
    ctx.font = `bold ${tickFontSize}px Inter`;

    const f2Span = config.f2Range[1] - config.f2Range[0];
    const f2Step = f2Span > 1500 ? 500 : 250;
    const startF2 = Math.ceil(config.f2Range[0] / f2Step) * f2Step;

    const f1Span = config.f1Range[1] - config.f1Range[0];
    const f1Step = f1Span > 800 ? 200 : 100;
    const startF1 = Math.ceil(config.f1Range[0] / f1Step) * f1Step;

    const tickOffset = isExport ? (10 * drawScale) : (4 * drawScale);
    
    // Threshold for corner clearance (approx 30px)
    const cornerThreshold = 30 * drawScale / scale;

    for (let f2 = startF2; f2 <= config.f2Range[1]; f2 += f2Step) {
      const x = mapX(f2);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      
      // Avoid overlapping with Y-axis at x=0
      if (x > cornerThreshold) {
          const xOffset = exportConfig ? (exportConfig.xAxisTickX || 0) * drawScale : 0;
          const yOffset = exportConfig ? (exportConfig.xAxisTickY || 0) * drawScale : 0;
          ctx.fillText(`${f2}`, x + (2*drawScale) + xOffset, height - tickOffset + yOffset);
      }
    }
    for (let f1 = startF1; f1 <= config.f1Range[1]; f1 += f1Step) {
      const y = mapY(f1);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      
      // Avoid overlapping with X-axis at y=height
      if (y < height - cornerThreshold) {
          const xOffset = exportConfig ? (exportConfig.yAxisTickX || 0) * drawScale : 0;
          const yOffset = exportConfig ? (exportConfig.yAxisTickY || 0) * drawScale : 0;
          ctx.fillText(`${f1}`, tickOffset + xOffset, y - (2*drawScale) + yOffset);
      }
    }

    const groups: Record<string, SpeechToken[]> = {};
    data.forEach(t => {
      let key = 'default';
      const cVal = mappings.colorKey ? getLabel(t, mappings.colorKey) : '';
      const sVal = mappings.shapeKey ? getLabel(t, mappings.shapeKey) : '';
      const lVal = mappings.lineTypeKey ? getLabel(t, mappings.lineTypeKey) : '';

      if (config.plotType === 'trajectory') {
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

    // Draw Base Plot based on Type
    if (config.plotType === 'trajectory') {
        // 1. Draw Individual Lines
        if (config.showIndividualLines) {
            ctx.globalAlpha = config.trajectoryLineOpacity !== undefined ? config.trajectoryLineOpacity : 0.5;
            ctx.lineWidth = (1 * drawScale) / scale;
            
            data.forEach(t => {
                const color = mappings.colorKey ? (mappings.colorMap[getLabel(t, mappings.colorKey)] || '#64748b') : (config.bwMode ? '#000' : '#64748b');
                const lineTypeVal = mappings.lineTypeKey ? getLabel(t, mappings.lineTypeKey) : '';
                const lineDash = mappings.lineTypeKey ? (mappings.lineTypeMap[lineTypeVal] || []) : [];
                
                ctx.strokeStyle = color;
                ctx.setLineDash(lineDash.map(d => (d * drawScale) / scale));
                
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
            });
            ctx.setLineDash([]);
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
                } 
                else if (mappings.colorKey) { groupColor = mappings.colorMap[key] || groupColor; }
                else if (mappings.lineTypeKey) { lineDash = mappings.lineTypeMap[key] || []; }

                // Calculate mean trajectory
                const timeSteps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter(t => t >= (config.trajectoryOnset ?? 0) && t <= (config.trajectoryOffset ?? 100));
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
                ctx.setLineDash(lineDash.map(d => (d * drawScale) / scale));
                
                ctx.beginPath();
                meanPts.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.stroke();
                
                ctx.setLineDash([]); // Reset for text

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

    } else {
        // Point Plot Mode (Existing Logic)
        if (config.showEllipses) {
          Object.entries(groups).forEach(([key, tokens]) => {
            if (tokens.length < 3) return;
            let groupColor = config.bwMode ? '#000' : '#64748b';
            if (key.includes('|')) { const [c] = key.split('|'); groupColor = mappings.colorMap[c] || groupColor; } 
            else if (mappings.colorKey) { groupColor = mappings.colorMap[key] || groupColor; }

            const pts = tokens.map(t => {
              const p = t.trajectory.find(pt => pt.time === config.timePoint);
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
            ctx.lineWidth = (1.5 * drawScale) / scale;
            ctx.stroke();
            ctx.restore();
          });
        }

        if (config.showPoints) {
          ctx.globalAlpha = config.pointOpacity;
          data.forEach(t => {
            const pt = t.trajectory.find(p => p.time === config.timePoint);
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
              const p = t.trajectory.find(pt => pt.time === config.timePoint);
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
              ctx.save();
              ctx.fillStyle = 'white';
              ctx.strokeStyle = 'white';
              drawShape(ctx, shape, mx, my, centroidSize + ((2*drawScale)/scale), scale, drawScale);
              ctx.fill();
              ctx.stroke();
              ctx.restore();
              ctx.fillStyle = groupColor;
              ctx.strokeStyle = groupColor;
              drawShape(ctx, shape, mx, my, centroidSize, scale, drawScale);
              if (!['plus', 'cross', 'asterisk'].includes(shape)) {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = (2 * drawScale) / scale;
                ctx.stroke();
              }
            }
          });
        }
    }

    // Draw Overlay
    if (overlayData && overlayConfig && overlayMappings) {
        if (overlayConfig.plotType === 'trajectory') {
            // 1. Overlay Individual Lines
            if (overlayConfig.showIndividualLines !== false) { // Default to true if undefined for backward compatibility? Or check MainDisplay init.
                 ctx.globalAlpha = overlayConfig.trajectoryLineOpacity !== undefined ? overlayConfig.trajectoryLineOpacity : 0.5;
                 ctx.lineWidth = (2 * drawScale) / scale;
                 
                 overlayData.forEach(token => {
                     const colorVal = overlayMappings.colorKey ? getLabel(token, overlayMappings.colorKey) : '';
                     const lineTypeVal = overlayMappings.lineTypeKey ? getLabel(token, overlayMappings.lineTypeKey) : '';
                     
                     const color = overlayMappings.colorKey ? (overlayMappings.colorMap[colorVal] || '#000') : (overlayConfig.bwMode ? '#000' : '#64748b');
                     const lineDash = overlayMappings.lineTypeKey ? (overlayMappings.lineTypeMap[lineTypeVal] || []) : [];
                     
                     ctx.strokeStyle = color;
                     ctx.setLineDash(lineDash.map(d => (d * drawScale) / scale));
                     
                     const pts = token.trajectory
                         .filter(p => p.time >= (overlayConfig.trajectoryOnset ?? 0) && p.time <= (overlayConfig.trajectoryOffset ?? 100))
                         .map(p => {
                             const f1 = overlayConfig.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1;
                             const f2 = overlayConfig.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2;
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
                     
                     if (overlayConfig.showPoints) {
                         const pointSize = (overlayConfig.pointSize * drawScale) / scale;
                         ctx.save();
                         ctx.globalAlpha = overlayConfig.pointOpacity;
                         ctx.fillStyle = color;
                         pts.forEach(p => {
                             ctx.beginPath();
                             ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                             ctx.fill();
                         });
                         ctx.restore();
                     }
     
                     if (overlayConfig.showArrows && pts.length > 1) {
                         const last = pts[pts.length - 1];
                         const prev = pts[pts.length - 2];
                         const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
                         const arrowLen = (8 * drawScale) / scale;
                         
                         ctx.save();
                         ctx.translate(last.x, last.y);
                         ctx.rotate(angle);
                         ctx.fillStyle = color;
                         ctx.beginPath();
                         ctx.moveTo(0, 0);
                         ctx.lineTo(-arrowLen, -arrowLen/2);
                         ctx.lineTo(-arrowLen, arrowLen/2);
                         ctx.closePath();
                         ctx.fill();
                         ctx.restore();
                     }
                 });
                 ctx.setLineDash([]);
            }

            // 2. Overlay Mean Trajectories
            if (overlayConfig.showMeanTrajectories) {
                // Group overlay data
                const overlayGroups: Record<string, SpeechToken[]> = {};
                overlayData.forEach(t => {
                    let key = 'default';
                    const cVal = overlayMappings.colorKey ? getLabel(t, overlayMappings.colorKey) : '';
                    const lVal = overlayMappings.lineTypeKey ? getLabel(t, overlayMappings.lineTypeKey) : '';
                    
                    if (overlayMappings.colorKey && overlayMappings.lineTypeKey && overlayMappings.colorKey !== overlayMappings.lineTypeKey) key = `${cVal}|${lVal}`;
                    else if (overlayMappings.colorKey) key = cVal;
                    else if (overlayMappings.lineTypeKey) key = lVal;

                    if (!overlayGroups[key]) overlayGroups[key] = [];
                    overlayGroups[key].push(t);
                });

                Object.entries(overlayGroups).forEach(([key, tokens]) => {
                    let groupColor = overlayConfig.bwMode ? '#000' : '#000';
                    let lineDash: number[] = [];

                    if (key.includes('|')) { 
                        const [c, l] = key.split('|'); 
                        groupColor = overlayMappings.colorMap[c] || groupColor; 
                        lineDash = overlayMappings.lineTypeMap[l] || [];
                    } 
                    else if (overlayMappings.colorKey) { groupColor = overlayMappings.colorMap[key] || groupColor; }
                    else if (overlayMappings.lineTypeKey) { lineDash = overlayMappings.lineTypeMap[key] || []; }

                    const timeSteps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter(t => t >= (overlayConfig.trajectoryOnset ?? 0) && t <= (overlayConfig.trajectoryOffset ?? 100));
                    const meanPts = timeSteps.map(t => {
                        let sumF1 = 0, sumF2 = 0, count = 0;
                        tokens.forEach(token => {
                            const pt = token.trajectory.find(p => p.time === t);
                            if (pt) {
                                const f1 = overlayConfig.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
                                const f2 = overlayConfig.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
                                if (f1 !== undefined && f2 !== undefined && !isNaN(f1) && !isNaN(f2)) {
                                    sumF1 += f1; sumF2 += f2; count++;
                                }
                            }
                        });
                        if (count === 0) return null;
                        return { x: mapX(sumF2 / count), y: mapY(sumF1 / count) };
                    }).filter(p => p !== null) as {x: number, y: number}[];

                    if (meanPts.length < 2) return;

                    ctx.globalAlpha = overlayConfig.meanTrajectoryOpacity !== undefined ? overlayConfig.meanTrajectoryOpacity : 1;
                    ctx.lineWidth = ((overlayConfig.meanTrajectoryWidth || 3) * drawScale) / scale;
                    ctx.strokeStyle = groupColor;
                    ctx.setLineDash(lineDash.map(d => (d * drawScale) / scale));

                    ctx.beginPath();
                    meanPts.forEach((p, i) => {
                        if (i === 0) ctx.moveTo(p.x, p.y);
                        else ctx.lineTo(p.x, p.y);
                    });
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset for text

                    if (overlayConfig.showTrajectoryLabels && meanPts.length > 0) {
                        const labelPt = meanPts[Math.floor(meanPts.length / 2)];
                        
                        let label = key;
                        if (key.includes('|')) { 
                            const [c, l] = key.split('|'); 
                            if (overlayConfig.meanLabelType === 'color') label = c;
                            else if (overlayConfig.meanLabelType === 'shape') label = l;
                            else if (overlayConfig.meanLabelType === 'both') label = `${c} ${l}`;
                        }

                        const labelSize = exportConfig ? exportConfig.dataLabelSize : (drawScale > 1.5 ? 36 : overlayConfig.meanTrajectoryLabelSize || overlayConfig.labelSize);
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

        } else {
            // Overlay Point Plot
            if (overlayConfig.showPoints) {
                ctx.globalAlpha = overlayConfig.pointOpacity;
                overlayData.forEach(t => {
                    const pt = t.trajectory.find(p => p.time === overlayConfig.timePoint);
                    if (!pt) return;
                    const f1 = overlayConfig.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
                    const f2 = overlayConfig.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
                    if (isNaN(f1) || isNaN(f2)) return;
                    const x = mapX(f2);
                    const y = mapY(f1);
                    
                    const colorVal = overlayMappings.colorKey ? getLabel(t, overlayMappings.colorKey) : '';
                    const color = overlayMappings.colorKey ? (overlayMappings.colorMap[colorVal] || '#64748b') : (overlayConfig.bwMode ? '#000' : '#64748b');
                    
                    const shapeVal = overlayMappings.shapeKey ? getLabel(t, overlayMappings.shapeKey) : '';
                    const shape = overlayMappings.shapeKey ? (overlayMappings.shapeMap[shapeVal] || 'circle') : 'circle';
                    
                    ctx.fillStyle = color;
                    ctx.strokeStyle = color;
                    drawShape(ctx, shape, x, y, (overlayConfig.pointSize * drawScale) / scale, scale, drawScale);
                });
            }
            
            // Overlay Ellipses?
            if (overlayConfig.showEllipses) {
                // ... Implementation for overlay ellipses ...
                // Similar to base plot ellipses but using overlayData and overlayConfig.
                // Grouping logic needed.
                const overlayGroups: Record<string, SpeechToken[]> = {};
                overlayData.forEach(t => {
                    let key = 'default';
                    const cVal = overlayMappings.colorKey ? getLabel(t, overlayMappings.colorKey) : '';
                    if (overlayMappings.colorKey) key = cVal;
                    if (!overlayGroups[key]) overlayGroups[key] = [];
                    overlayGroups[key].push(t);
                });
                
                Object.entries(overlayGroups).forEach(([key, tokens]) => {
                    if (tokens.length < 3) return;
                    let groupColor = overlayConfig.bwMode ? '#000' : '#64748b';
                    if (overlayMappings.colorKey) { groupColor = overlayMappings.colorMap[key] || groupColor; }

                    const pts = tokens.map(t => {
                        const p = t.trajectory.find(pt => pt.time === overlayConfig.timePoint);
                        const f1 = overlayConfig.useSmoothing && p ? (p.f1_smooth ?? p.f1) : p?.f1;
                        const f2 = overlayConfig.useSmoothing && p ? (p.f2_smooth ?? p.f2) : p?.f2;
                        if (!p || f1 === undefined || f2 === undefined || isNaN(f1) || isNaN(f2)) return null;
                        return { x: mapX(f2), y: mapY(f1) };
                    }).filter(p => p !== null) as {x: number, y: number}[];

                    if (pts.length < 3) return;
                    // ... Ellipse calculation ...
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
                    ctx.globalAlpha = overlayConfig.ellipseFillOpacity;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, Math.sqrt(l1) * overlayConfig.ellipseSD, Math.sqrt(l2) * overlayConfig.ellipseSD, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = overlayConfig.ellipseLineOpacity;
                    ctx.lineWidth = (1.5 * drawScale) / scale;
                    ctx.stroke();
                    ctx.restore();
                });
            }
            
            // Overlay Centroids?
            if (overlayConfig.showCentroids) {
                 // ... Implementation for overlay centroids ...
                 // Similar to base plot.
            }
        }
    }

    ctx.restore();
  }, [data, config, mappings, overlayData, overlayConfig, overlayMappings]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
      let curY = y;
      const isExport = drawScale > 1.5;
      
      const fontSizeTitle = exportConfig ? exportConfig.legendTitleSize : (isExport ? 36 : 14) * drawScale;
      const fontSizeItem = exportConfig ? exportConfig.legendItemSize : (isExport ? 24 : 12) * drawScale;
      const spacing = fontSizeItem * 1.6;
      const circleSize = fontSizeItem * 0.5;
      const xOffset = fontSizeItem * 1.5;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';

      const source = exportConfig?.legendSource || 'background';

      const drawSection = (m: any, titleSuffix: string = '') => {
          if (!m) return;
          const { colorMap, shapeMap, lineTypeMap, colorKey, shapeKey, lineTypeKey, colorCounts, shapeCounts, lineTypeCounts } = m;

          if (exportConfig?.showColorLegend !== false && colorKey) {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              const title = (exportConfig && exportConfig.colorLegendTitle) ? exportConfig.colorLegendTitle : colorKey.toUpperCase();
              ctx.fillStyle = '#0f172a';
              ctx.fillText(title + titleSuffix, x, curY);
              curY += fontSizeTitle * 1.4;
              
              ctx.font = `${fontSizeItem}px Inter`;
              Object.entries(colorMap).sort().forEach(([k, c]) => {
                  const count = colorCounts ? (colorCounts[k] || 0) : 0;
                  ctx.fillStyle = c as string;
                  ctx.beginPath(); ctx.arc(x + (circleSize), curY + (circleSize/2), circleSize, 0, Math.PI*2); ctx.fill();
                  ctx.fillStyle = '#334155';
                  ctx.fillText(`${k} ${count ? `(n=${count})` : ''}`, x + xOffset, curY + (circleSize/2));
                  curY += spacing;
              });
              curY += fontSizeTitle;
          }

          if (exportConfig?.showShapeLegend !== false && shapeKey && shapeKey !== colorKey) {
              ctx.font = `bold ${fontSizeTitle}px Inter`;
              const title = (exportConfig && exportConfig.shapeLegendTitle) ? exportConfig.shapeLegendTitle : shapeKey.toUpperCase();
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

          if (exportConfig?.showLineTypeLegend !== false && lineTypeKey && lineTypeKey !== colorKey) {
             ctx.font = `bold ${fontSizeTitle}px Inter`;
             const title = (exportConfig && exportConfig.lineTypeLegendTitle) ? exportConfig.lineTypeLegendTitle : lineTypeKey.toUpperCase();
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

      if (source === 'background' || source === 'both') {
          drawSection(mappings);
      }
      if ((source === 'overlay' || source === 'both') && overlayMappings) {
          drawSection(overlayMappings, source === 'both' ? ' (Overlay)' : '');
      }
  };

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
      const offscreen = document.createElement('canvas');
      const drawScale = exportConfig.scale; 
      
      // Base dimensions (at 1x)
      const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
      const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
      const basePlotWidth = 2400 * graphScaleX; 
      const basePlotHeight = 2000 * graphScaleY;
      
      // Margins should scale with drawScale to keep proportions
      // Add graphX/Y as additional margin offsets
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

      // Legend space should also scale
      if (exportConfig.showLegend) {
          if (exportConfig.legendPosition === 'right') {
              legendSpaceRight = 800 * drawScale;
          } else if (exportConfig.legendPosition === 'bottom') {
              legendSpaceBottom = 800 * drawScale; 
          }
      }
      
      // Final dimensions
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
          ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const defaultTitleX = exportConfig.legendPosition === 'right' 
              ? margin.left + (plotWidth / 2) 
              : offscreen.width / 2;
          const titleX = defaultTitleX + ((exportConfig.plotTitleX || 0) * drawScale);
          // Title Y is relative to margin.top, but margin.top now includes graphY.
          // We want title to stay relative to the top of the canvas or the graph?
          // Usually relative to graph top.
          // Let's position it relative to the graph top (margin.top)
          const titleY = (margin.top / 2) + ((exportConfig.plotTitleY || 0) * drawScale);
          ctx.fillText(exportConfig.plotTitle, titleX, titleY);
          ctx.restore();
      }

      ctx.save();
      ctx.translate(margin.left, margin.top);
      
      // Pass drawScale to renderPlot, but plot dimensions are already scaled
      // We need to ensure renderPlot handles the coordinate mapping correctly
      // The `scale` param in renderPlot is for zoom/pan, which we set to 1 here.
      // However, since we increased plotWidth/Height by drawScale, the mapping functions inside renderPlot
      // will naturally map to the larger area.
      // The `drawScale` param is used for line widths and font sizes.
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
      
      ctx.restore(); // Return to canvas origin
      
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
              console.log('Custom Legend Pos:', { legendX: exportConfig.legendX, legendY: exportConfig.legendY, lx, ly, drawScale });
          }

          if (['inside-top-right', 'inside-top-left', 'custom'].includes(exportConfig.legendPosition)) {
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
                showLineTypeLegend: true, lineTypeLegendTitle: 'LINE TYPE'
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
  }, [data, config, transform, mappings, renderPlot]);

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
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - transform.x) / transform.scale;
      const mouseY = (e.clientY - rect.top - transform.y) / transform.scale;
      const dprWidth = canvas.width / window.devicePixelRatio;
      const dprHeight = canvas.height / window.devicePixelRatio;
      const mapX = (f2: number) => {
        const norm = (f2 - config.f2Range[0]) / (config.f2Range[1] - config.f2Range[0]);
        return config.invertX ? (1 - norm) * dprWidth : norm * dprWidth;
      };
      const mapY = (f1: number) => {
        const norm = (f1 - config.f1Range[0]) / (config.f1Range[1] - config.f1Range[0]);
        return config.invertY ? norm * dprHeight : (1 - norm) * dprHeight;
      };
      let closest: SpeechToken | null = null;
      let minDist = 15 / transform.scale;
      data.forEach(t => {
        const pt = t.trajectory.find(p => p.time === config.timePoint);
        if (!pt) return;
        const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
        const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
        if (isNaN(f1) || isNaN(f2)) return;
        const tx = mapX(f2);
        const ty = mapY(f1);
        const dist = Math.sqrt((tx - mouseX)**2 + (ty - mouseY)**2);
        if (dist < minDist) {
          minDist = dist;
          closest = t;
        }
      });
      setHoveredToken(closest);
    }
  };

  const handleMouseUp = () => isDragging.current = false;
  
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
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="cursor-move"
      />
      <div className="absolute bottom-4 left-4 flex space-x-2">
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 1.2 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">+</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: t.scale * 0.8 }))} className="w-8 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 font-bold">-</button>
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="px-3 h-8 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[10px] font-bold">RESET VIEW</button>
      </div>
      {hoveredToken && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white p-3 rounded-xl shadow-2xl text-[11px] z-50 left-16 top-16 border border-slate-700 backdrop-blur-md space-y-1.5 min-w-[200px]">
          <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-indigo-400">File ID: {hoveredToken.file_id}</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Word:</span> {hoveredToken.word}</p>
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Syllable:</span> {hoveredToken.syllable}</p>
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Phoneme:</span> {hoveredToken.canonical}</p>
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Allophone:</span> {hoveredToken.produced}</p>
             <p className="col-span-2"><span className="text-slate-400 font-bold uppercase text-[9px]">Time (xmin):</span> {hoveredToken.xmin.toFixed(3)}s</p>
          </div>
        </div>
      )}
      <div className="absolute right-4 top-4 max-h-[85%] overflow-y-auto w-64 z-40">
        <Legend data={data} mappings={mappings} config={config} onLegendClick={onLegendClick} overlayMappings={overlayMappings} overlayConfig={overlayConfig} />
      </div>
    </div>
  );
});

export default CanvasPlot;
