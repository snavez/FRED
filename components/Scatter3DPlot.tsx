
import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig } from '../types';
import { Layers, Rotate3D, Box, LayoutTemplate } from 'lucide-react';

interface Scatter3DPlotProps {
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

// 3D Point Interface
interface Point3D {
  x: number;
  y: number;
  z: number;
  original: SpeechToken;
  color: string;
  shape: string;
}

// Draw Shape in 2D (Projected)
const drawShape = (ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, drawScale: number = 1) => {
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
  if (shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape)) {
    ctx.lineWidth = 2 * drawScale;
    ctx.stroke();
  } else {
    ctx.fill();
  }
};

const ShapeIcon = ({ shape, color, className }: { shape: string, color: string, className?: string }) => {
    return (
      <svg width="14" height="14" viewBox="0 0 20 20" className={className}>
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
};

const Scatter3DPlot = forwardRef<PlotHandle, Scatter3DPlotProps>(({ data, config, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Camera State
  const [rotation, setRotation] = useState({ alpha: 45, beta: 60 }); // alpha: rotation around Y, beta: elevation
  const [translation, setTranslation] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  
  // Interaction State
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const dragMode = useRef<'pan' | 'rotate'>('pan');

  // Axis Align Handlers
  const alignView = (axisPair: 'f1f2' | 'f2f3' | 'f1f3') => {
      setTranslation({x: 0, y: 0});
      setZoom(1);
      switch(axisPair) {
          case 'f1f2': // Look from Top: Z(F1) vs X(F2)
              setRotation({ alpha: 0, beta: 90 });
              break;
          case 'f2f3': // Look from Front: Y(F3) vs X(F2)
              setRotation({ alpha: 0, beta: 0 });
              break;
          case 'f1f3': // Look from Side: Y(F3) vs Z(F1)
              setRotation({ alpha: 90, beta: 0 });
              break;
      }
  };

  const mappings = useMemo(() => {
    const colorKey = config.colorBy === 'none' ? null : config.colorBy;
    const shapeKey = config.shapeBy === 'none' ? null : config.shapeBy;
    const colorValues: string[] = (Array.from(new Set(data.map(t => getLabel(t, colorKey || '')))) as string[]).filter(v => v !== '').sort();
    const shapeValues: string[] = (Array.from(new Set(data.map(t => getLabel(t, shapeKey || '')))) as string[]).filter(v => v !== '').sort();

    const colorMap: Record<string, string> = {};
    const palette = config.bwMode ? ['#000', '#555', '#aaa'] : COLORS;
    colorValues.forEach((v: string, i: number) => { 
        colorMap[v] = styleOverrides?.colors?.[v] || palette[i % palette.length]; 
    });

    const shapeMap: Record<string, string> = {};
    shapeValues.forEach((v: string, i: number) => { 
        shapeMap[v] = styleOverrides?.shapes?.[v] || SHAPES[i % SHAPES.length]; 
    });

    // Counts for Legend
    const colorCounts: Record<string, number> = {};
    const shapeCounts: Record<string, number> = {};
    if (colorKey) data.forEach(t => { const k = getLabel(t, colorKey); colorCounts[k] = (colorCounts[k] || 0) + 1; });
    if (shapeKey) data.forEach(t => { const k = getLabel(t, shapeKey); shapeCounts[k] = (shapeCounts[k] || 0) + 1; });

    return { colorMap, shapeMap, colorKey, shapeKey, colorCounts, shapeCounts };
  }, [data, config.colorBy, config.shapeBy, config.bwMode, styleOverrides]);

  // drawScale added
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2 + translation.x;
    const centerY = height / 2 + translation.y;
    const cubeSize = Math.min(width, height) * 0.4 * zoom;

    // Normalization Ranges
    const f1Min = config.f1Range[0], f1Max = config.f1Range[1];
    const f2Min = config.f2Range[0], f2Max = config.f2Range[1];
    const f3Min = config.f3Range[0], f3Max = config.f3Range[1];

    // Helper: Project 3D (normalized -1 to 1) to 2D
    const project = (x: number, y: number, z: number) => {
      const radAlpha = (rotation.alpha * Math.PI) / 180;
      const radBeta = (rotation.beta * Math.PI) / 180;

      // Rotate around Y axis (Alpha)
      const x1 = x * Math.cos(radAlpha) - z * Math.sin(radAlpha);
      const z1 = x * Math.sin(radAlpha) + z * Math.cos(radAlpha);
      
      // Rotate around X axis (Beta)
      const y2 = y * Math.cos(radBeta) - z1 * Math.sin(radBeta);
      const z2 = y * Math.sin(radBeta) + z1 * Math.cos(radBeta);

      // Orthographic Projection
      return {
        x: centerX + x1 * cubeSize,
        y: centerY - y2 * cubeSize, // Y is up in 3D, down in Canvas
        depth: z2
      };
    };

    // --- Draw Axes (Wireframe Box & Ticks) ---
    // Corners
    const corners = [
      {x:-1, y:-1, z:-1}, {x:1, y:-1, z:-1}, {x:1, y:-1, z:1}, {x:-1, y:-1, z:1}, // Bottom
      {x:-1, y:1, z:-1}, {x:1, y:1, z:-1}, {x:1, y:1, z:1}, {x:-1, y:1, z:1}     // Top
    ];
    // Edges
    const edges = [
      [0,1], [1,2], [2,3], [3,0], // Bottom loop
      [4,5], [5,6], [6,7], [7,4], // Top loop
      [0,4], [1,5], [2,6], [3,7]  // Pillars
    ];

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 * drawScale;
    edges.forEach(([s, e]) => {
      const p1 = project(corners[s].x, corners[s].y, corners[s].z);
      const p2 = project(corners[e].x, corners[e].y, corners[e].z);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    // Helper to draw axis with ticks and label
    const drawAxisTicks = (axis: 'x' | 'y' | 'z', start: {x:number, y:number, z:number}, end: {x:number, y:number, z:number}, minVal: number, maxVal: number, label: string) => {
        const steps = 4;
        ctx.fillStyle = '#64748b';
        ctx.strokeStyle = '#94a3b8';
        const isExport = !!exportConfig;
        
        const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 28 : 14);
        const tickFontSize = (tickBaseSize * drawScale) / scale;
        ctx.font = `${tickFontSize}px Inter`;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Offsets
        const xTickOffX = (exportConfig?.xAxisTickX || 0) * drawScale;
        const xTickOffY = (exportConfig?.xAxisTickY || 0) * drawScale;
        const yTickOffX = (exportConfig?.yAxisTickX || 0) * drawScale;
        const yTickOffY = (exportConfig?.yAxisTickY || 0) * drawScale;

        // Ticks
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cx = start.x + (end.x - start.x) * t;
            const cy = start.y + (end.y - start.y) * t;
            const cz = start.z + (end.z - start.z) * t;
            
            const p = project(cx, cy, cz);
            
            // Draw tick point
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2 * drawScale, 0, Math.PI*2);
            ctx.fill();

            // Draw Value
            const val = minVal + (maxVal - minVal) * t;
            
            let lx = p.x, ly = p.y;
            // Offsets for values to avoid overlapping lines
            if (axis === 'x') { 
                ly += (30 * drawScale); 
                lx += xTickOffX; ly += xTickOffY;
            } 
            if (axis === 'y') { 
                lx -= (40 * drawScale); 
                lx += yTickOffX; ly += yTickOffY;
            } 
            if (axis === 'z') { 
                lx -= (35 * drawScale); ly += (20 * drawScale); 
                // Reuse Y offsets for Z axis as it is vertical
                lx += yTickOffX; ly += yTickOffY;
            } 

            ctx.fillText(Math.round(val).toString(), lx, ly);
        }

        // Draw Axis Title at Midpoint
        const mx = (start.x + end.x) / 2;
        const my = (start.y + end.y) / 2;
        const mz = (start.z + end.z) / 2;
        const mp = project(mx, my, mz);
        
        const titleBaseSize = isExport ? 36 : 18;
        // Use user X/Y/X Axis sizes if provided, otherwise default. 
        // For 3D, map X->X, Y->Y, Z->Y (since Z is vertical usually)
        let axisSize = titleBaseSize;
        if (exportConfig) {
            axisSize = (axis === 'x' ? exportConfig.xAxisLabelSize : exportConfig.yAxisLabelSize);
        }

        ctx.font = `bold ${(axisSize * drawScale) / scale}px Inter`;
        ctx.fillStyle = '#0f172a';
        
        let tx = mp.x, ty = mp.y;
        
        const xLabelOffX = (exportConfig?.xAxisLabelX || 0) * drawScale;
        const xLabelOffY = (exportConfig?.xAxisLabelY || 0) * drawScale;
        const yLabelOffX = (exportConfig?.yAxisLabelX || 0) * drawScale;
        const yLabelOffY = (exportConfig?.yAxisLabelY || 0) * drawScale;

        // Offsets for titles
        if (axis === 'x') { 
            ty += (60 * drawScale); 
            tx += xLabelOffX; ty += xLabelOffY;
        }
        if (axis === 'y') { 
            tx -= (80 * drawScale); 
            tx += yLabelOffX; ty += yLabelOffY;
        }
        if (axis === 'z') { 
            tx -= (60 * drawScale); ty += (40 * drawScale); 
            tx += yLabelOffX; ty += yLabelOffY;
        }
        
        ctx.fillText(label, tx, ty);
    };

    // X Axis (F2)
    drawAxisTicks('x', {x:-1, y:-1, z:1}, {x:1, y:-1, z:1}, 
        config.invertX ? f2Max : f2Min, 
        config.invertX ? f2Min : f2Max, 
        "F2 (Hz)"
    );

    // Y Axis (F3)
    drawAxisTicks('y', {x:-1, y:-1, z:-1}, {x:-1, y:1, z:-1}, f3Min, f3Max, "F3 (Hz)");

    // Z Axis (F1)
    drawAxisTicks('z', {x:-1, y:-1, z:-1}, {x:-1, y:-1, z:1}, 
        config.invertY ? f1Max : f1Min,
        config.invertY ? f1Min : f1Max,
        "F1 (Hz)"
    );

    // Prepare Points
    const points: (Point3D & { px: number, py: number, depth: number })[] = [];
    
    data.forEach(t => {
      const pt = t.trajectory.find(p => p.time === config.timePoint);
      if (!pt) return;

      const f1 = config.useSmoothing ? (pt.f1_smooth ?? pt.f1) : pt.f1;
      const f2 = config.useSmoothing ? (pt.f2_smooth ?? pt.f2) : pt.f2;
      const f3 = config.useSmoothing ? (pt.f3_smooth ?? pt.f3) : pt.f3;

      // Filter out invalid points
      if (isNaN(f1) || isNaN(f2) || isNaN(f3)) return;

      // Normalize to -1 to 1 range
      let nx = (f2 - f2Min) / (f2Max - f2Min) * 2 - 1; 
      if (config.invertX) nx = -nx; 

      let nz = (f1 - f1Min) / (f1Max - f1Min) * 2 - 1;
      if (config.invertY) nz = -nz; 

      let ny = (f3 - f3Min) / (f3Max - f3Min) * 2 - 1;

      const proj = project(nx, ny, nz);
      
      const cKey = mappings.colorKey ? getLabel(t, mappings.colorKey) : '';
      const sKey = mappings.shapeKey ? getLabel(t, mappings.shapeKey) : '';
      
      points.push({
        x: nx, y: ny, z: nz,
        px: proj.x, py: proj.y, depth: proj.depth,
        original: t,
        color: mappings.colorKey ? (mappings.colorMap[cKey] || '#64748b') : (config.bwMode ? '#000' : '#64748b'),
        shape: mappings.shapeKey ? (mappings.shapeMap[sKey] || 'circle') : 'circle'
      });
    });

    // Sort by Depth (Painter's Algorithm) - High depth (far) drawn first
    points.sort((a, b) => a.depth - b.depth);

    // Calculate Groups for Means/Ellipses
    const groups: Record<string, typeof points> = {};
    if (config.showCentroids || config.showEllipses) {
        points.forEach(p => {
            const cKey = mappings.colorKey ? getLabel(p.original, mappings.colorKey) : '';
            const sKey = mappings.shapeKey ? getLabel(p.original, mappings.shapeKey) : '';
            
            let key = 'All';
            if (mappings.colorKey && mappings.shapeKey && mappings.colorKey !== mappings.shapeKey) {
                key = `${cKey}|${sKey}`;
            } else if (mappings.colorKey) {
                key = cKey;
            } else if (mappings.shapeKey) {
                key = sKey;
            }

            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });
    }

    // Draw Ellipses (Wireframe)
    if (config.showEllipses) {
        Object.entries(groups).forEach(([key, groupPts]) => {
           if (groupPts.length < 3) return;
           
           // Calc Mean
           let mx=0, my=0, mz=0;
           groupPts.forEach(p => { mx+=p.x; my+=p.y; mz+=p.z; });
           mx /= groupPts.length; my /= groupPts.length; mz /= groupPts.length;

           // Approx SD 
           let varX=0, varY=0, varZ=0;
           groupPts.forEach(p => { varX+=(p.x-mx)**2; varY+=(p.y-my)**2; varZ+=(p.z-mz)**2; });
           const sdX = Math.sqrt(varX/groupPts.length) * config.ellipseSD;
           const sdY = Math.sqrt(varY/groupPts.length) * config.ellipseSD;
           const sdZ = Math.sqrt(varZ/groupPts.length) * config.ellipseSD;

           const color = groupPts[0].color;
           ctx.strokeStyle = color;
           ctx.lineWidth = 1 * drawScale;
           ctx.globalAlpha = config.ellipseLineOpacity;

           // Helper to draw projected ellipse
           const drawProjectedEllipse = (ax: 'x'|'y'|'z') => {
               ctx.beginPath();
               for(let a=0; a<=360; a+=10) {
                   const rad = a*Math.PI/180;
                   let lx=mx, ly=my, lz=mz;
                   if (ax === 'z') { // XY Plane
                       lx += Math.cos(rad)*sdX; ly += Math.sin(rad)*sdY;
                   } else if (ax === 'y') { // XZ Plane
                       lx += Math.cos(rad)*sdX; lz += Math.sin(rad)*sdZ;
                   } else { // YZ Plane
                       ly += Math.cos(rad)*sdY; lz += Math.sin(rad)*sdZ;
                   }
                   const p = project(lx,ly,lz);
                   if(a===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
               }
               ctx.closePath();
               ctx.stroke();
               if (config.ellipseFillOpacity > 0) {
                   ctx.fillStyle = color;
                   ctx.save();
                   ctx.globalAlpha = config.ellipseFillOpacity;
                   ctx.fill();
                   ctx.restore();
               }
           };

           drawProjectedEllipse('z'); // XY
           drawProjectedEllipse('y'); // XZ
           drawProjectedEllipse('x'); // YZ
           
           ctx.globalAlpha = 1; // Reset
        });
    }

    // Draw Centroids & Labels
    if (config.showCentroids) {
       Object.entries(groups).forEach(([key, groupPts]) => {
           if (groupPts.length === 0) return;
           let mx=0, my=0, mz=0;
           groupPts.forEach(p => { mx+=p.x; my+=p.y; mz+=p.z; });
           mx /= groupPts.length; my /= groupPts.length; mz /= groupPts.length;
           
           const projM = project(mx, my, mz);
           const color = groupPts[0].color;
           const shape = groupPts[0].shape;

           let labelText = key;
           if (key.includes('|')) {
               const [cLabel, sLabel] = key.split('|');
               if (config.meanLabelType === 'color') labelText = cLabel;
               else if (config.meanLabelType === 'shape') labelText = sLabel;
               else if (config.meanLabelType === 'both') labelText = `${cLabel} ${sLabel}`;
           }

           if (config.labelAsCentroid) {
               ctx.font = `bold ${config.labelSize * drawScale}px Inter`;
               ctx.textAlign = 'center';
               ctx.textBaseline = 'middle';
               
               // Stroke (Halo) for contrast
               ctx.strokeStyle = 'white';
               ctx.lineWidth = 3 * drawScale;
               ctx.lineJoin = 'round';
               ctx.strokeText(labelText, projM.x, projM.y);
               
               // Fill
               ctx.fillStyle = color;
               ctx.fillText(labelText, projM.x, projM.y);
           } else {
               // Draw point
               ctx.fillStyle = color;
               ctx.strokeStyle = 'white';
               ctx.lineWidth = 2 * drawScale;
               drawShape(ctx, shape, projM.x, projM.y, config.centroidSize * drawScale, drawScale);
           }
       });
    }

    // Draw Points
    if (config.showPoints) {
      ctx.globalAlpha = config.pointOpacity;
      points.forEach(p => {
         ctx.fillStyle = p.color;
         ctx.strokeStyle = p.color;
         const depthScale = 1 + (p.depth * 0.3); 
         drawShape(ctx, p.shape, p.px, p.py, Math.max(1, config.pointSize * depthScale * zoom) * drawScale, drawScale);
      });
    }

  }, [data, config, mappings, rotation, translation, zoom]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    const { colorMap, shapeMap, colorKey, shapeKey, colorCounts, shapeCounts } = mappings;
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
    const colorTitle = (layerLegendCfg?.colorTitle) || (exportConfig?.colorLegendTitle) || (colorKey ? colorKey.toUpperCase() : 'COLOR');
    const showShape = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showShapeLegend !== false);
    const shapeTitle = (layerLegendCfg?.shapeTitle) || (exportConfig?.shapeLegendTitle) || (shapeKey ? shapeKey.toUpperCase() : 'SHAPE');

    const legendLayerIds = exportConfig?.legendLayers;
    const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');

    if (isInLegend && showColor && colorKey) {
        ctx.font = `bold ${fontSizeTitle}px Inter`;
        ctx.fillText(colorTitle, x, curY);
        curY += fontSizeTitle * 1.4;

        ctx.font = `${fontSizeItem}px Inter`;
        Object.entries(colorMap).sort().forEach(([k, c]) => {
            const count = colorCounts[k] || 0;
            ctx.fillStyle = c as string;
            ctx.beginPath(); ctx.arc(x + (circleSize), curY + (circleSize), circleSize, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#334155';
            ctx.fillText(`${k} (n=${count})`, x + xOffset, curY + (circleSize));
            curY += spacing;
        });
        curY += fontSizeTitle;
    }

    if (isInLegend && showShape && shapeKey && shapeKey !== colorKey) {
        ctx.font = `bold ${fontSizeTitle}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(shapeTitle, x, curY);
        curY += fontSizeTitle * 1.4;

        ctx.font = `${fontSizeItem}px Inter`;
        Object.entries(shapeMap).sort().forEach(([k, s]) => {
            const count = shapeCounts[k] || 0;
            ctx.fillStyle = '#64748b';
            ctx.strokeStyle = '#64748b';
            drawShape(ctx, s as string, x + (circleSize), curY + (circleSize), (5 * drawScale), drawScale);
            ctx.fillStyle = '#334155';
            ctx.fillText(`${k} (n=${count})`, x + xOffset, curY + (circleSize));
            curY += spacing;
        });
    }
  };

  useImperativeHandle(ref, () => ({
    exportImage: () => {
        // Legacy support
        const defaultExportConfig: ExportConfig = {
            scale: 3, xAxisLabelSize: 32, yAxisLabelSize: 32, tickLabelSize: 24, dataLabelSize: 24,
            showLegend: true, legendTitleSize: 36, legendItemSize: 24,
            showColorLegend: true, colorLegendTitle: config.colorBy.toUpperCase(),
            showShapeLegend: true, shapeLegendTitle: config.shapeBy.toUpperCase(),
            showTextureLegend: true, textureLegendTitle: '',
            showLineTypeLegend: true, lineTypeLegendTitle: '',
            showOverlayColorLegend: true, overlayColorLegendTitle: '',
            showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
            showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: ''
        };
        const offscreen = document.createElement('canvas');
        const drawScale = 3;
        const plotW = 2400;
        const plotH = 1800;
        const legendWidth = 800; 
        const margin = 100;
        
        offscreen.width = plotW + legendWidth + margin * 2;
        offscreen.height = plotH + margin * 2;
        const ctx = offscreen.getContext('2d');
        if(ctx) {
            ctx.fillStyle = '#fff'; ctx.fillRect(0,0,offscreen.width, offscreen.height);
            renderPlot(ctx, plotW, plotH, 1, drawScale, defaultExportConfig);
            ctx.save();
            ctx.translate(plotW + margin * 1.5, margin); 
            drawLegend(ctx, 0, 0, legendWidth, drawScale, defaultExportConfig);
            ctx.restore();

            const link = document.createElement('a');
            link.download = '3d_scatter.png';
            link.href = offscreen.toDataURL();
            link.click();
        }
    },
    generateImage: (exportConfig: ExportConfig) => {
        const offscreen = document.createElement('canvas');
        const drawScale = exportConfig.scale;
        
        // Base dimensions
        const baseWidth = 2400;
        const baseHeight = 1800;

        // Apply Graph Geometry
        const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
        const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
        const plotW = baseWidth * graphScaleX;
        const plotH = baseHeight * graphScaleY;

        // Margins
        const margin = {
            top: (100 * drawScale) + ((exportConfig.graphY || 0) * drawScale),
            right: 100 * drawScale,
            bottom: 100 * drawScale,
            left: (100 * drawScale) + ((exportConfig.graphX || 0) * drawScale)
        };

        // Legend Calculation
        let legendW = 0;
        let lx = 0;
        let ly = 0;

        if (exportConfig.showLegend) {
            if (exportConfig.legendPosition === 'right') {
                legendW = 800 * drawScale;
                lx = margin.left + plotW + (100 * drawScale);
                ly = margin.top;
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
                ctx.translate(lx, ly);
                drawLegend(ctx, 0, 0, legendW, drawScale, exportConfig);
                ctx.restore();
            }
            return offscreen.toDataURL();
        }
        return '';
    }
  }));

  // ... (rest unchanged)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) renderPlot(ctx, width, height, 1, 1);
  }, [data, config, rotation, translation, zoom, renderPlot]);

  // ... Interaction handlers unchanged
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    dragMode.current = e.shiftKey ? 'rotate' : 'pan';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;

      if (dragMode.current === 'rotate') {
        setRotation(r => ({
          alpha: (r.alpha + dx * 0.5) % 360,
          beta: Math.max(-90, Math.min(90, r.beta - dy * 0.5))
        }));
      } else {
        setTranslation(t => ({
          x: t.x + dx,
          y: t.y + dy
        }));
      }
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => isDragging.current = false;

  const handleWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY > 0 ? 0.95 : 1.05;
    setZoom(z => Math.max(0.1, Math.min(10, z * factor)));
  };

  // Helper for Legend Clicks
  const handleLegendClickWrapper = (category: string, type: 'color'|'shape', event: React.MouseEvent) => {
      if (onLegendClick) {
          const { colorMap, shapeMap } = mappings;
          onLegendClick(category, {
             color: type === 'color' ? (colorMap[category] as string || '#000') : '#000',
             shape: type === 'shape' ? (shapeMap[category] as string || 'circle') : 'circle',
             texture: 0,
             lineType: 'solid'
          }, event);
      }
  };

  // Screen Legend
  const renderScreenLegend = () => {
      const { colorMap, shapeMap, colorKey, shapeKey, colorCounts, shapeCounts } = mappings;
      if (!colorKey && !shapeKey) return null;

      return (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-56 pointer-events-auto">
            {colorKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{colorKey}</h4>
                    {Object.entries(colorMap).sort().map(([k, c]) => (
                        <div key={k} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(k, 'color', e)}>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{background: c as string}}></div>
                                <span>{k}</span>
                            </div>
                            <span className="text-slate-400 text-[10px]">({colorCounts[k]})</span>
                        </div>
                    ))}
                </div>
            )}
            {shapeKey && shapeKey !== colorKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{shapeKey}</h4>
                    {Object.entries(shapeMap).sort().map(([k, s]) => (
                        <div key={k} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(k, 'shape', e)}>
                            <div className="flex items-center gap-2">
                                <ShapeIcon shape={s as string} color="#64748b" />
                                <span>{k}</span>
                            </div>
                            <span className="text-slate-400 text-[10px]">({shapeCounts[k]})</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
      );
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-white select-none">
      
      {/* Alignment Buttons */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
          {/* ... buttons ... */}
          <button onClick={() => alignView('f1f2')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition-colors" title="Standard F1 vs F2 View (Top Down)"><LayoutTemplate size={14} className="text-indigo-500" />F1 vs F2</button>
          <button onClick={() => alignView('f2f3')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition-colors" title="F2 vs F3 View (Front)"><Layers size={14} className="text-emerald-500" />F2 vs F3</button>
          <button onClick={() => alignView('f1f3')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition-colors" title="F1 vs F3 View (Side)"><Box size={14} className="text-amber-500" />F1 vs F3</button>
      </div>

      <canvas 
        ref={canvasRef} 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="cursor-move w-full h-full"
      />
      <div className="absolute bottom-4 left-4 flex flex-col space-y-2 pointer-events-none">
          <div className="bg-slate-900/80 text-white p-2 rounded text-[10px] backdrop-blur">
              <p>Drag to Pan</p>
              <p>Shift + Drag to Rotate</p>
              <p>Scroll to Zoom</p>
          </div>
          <button onClick={() => { setTranslation({x:0, y:0}); setRotation({alpha:45, beta:60}); setZoom(1); }} className="pointer-events-auto flex items-center justify-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded shadow-sm text-[10px] font-bold hover:bg-slate-50">
              <Rotate3D size={12} />
              RESET VIEW
          </button>
      </div>
      {renderScreenLegend()}
    </div>
  );
});

export default Scatter3DPlot;
