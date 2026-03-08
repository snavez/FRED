
import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig } from '../types';
import { generateTexture } from '../utils/textureGenerator';

interface DurationPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626'
];

import { getLabel } from '../utils/getLabel';

// Statistical Helper
const calculateStats = (tokens: SpeechToken[]) => {
  if (tokens.length === 0) return null;
  const values = tokens.map(t => t.duration).sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const q1 = values[Math.floor(values.length * 0.25)];
  const median = values[Math.floor(values.length * 0.5)];
  const q3 = values[Math.floor(values.length * 0.75)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // SD
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);

  return { min, max, q1, median, q3, mean, sd, count: values.length, tokens };
};

const DurationPlot = forwardRef<PlotHandle, DurationPlotProps>(({ data, config }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredToken, setHoveredToken] = useState<SpeechToken | null>(null);

  const { stats, groupKeys, colorMap } = useMemo(() => {
    const groups: Record<string, SpeechToken[]> = {};
    const palette = config.bwMode ? ['#525252'] : COLORS;
    const cMap: Record<string, string> = {};

    // Grouping
    data.forEach(t => {
      const gKey = getLabel(t, config.groupBy || 'phoneme') || 'All';
      if (!groups[gKey]) groups[gKey] = [];
      groups[gKey].push(t);
    });

    const keys = Object.keys(groups).sort();
    
    // Coloring logic
    if (config.colorBy !== 'none') {
       if (config.colorBy === config.groupBy) {
           keys.forEach((k, i) => cMap[k] = palette[i % palette.length]);
       } else {
           keys.forEach((k, i) => cMap[k] = palette[i % palette.length]);
       }
    } else {
        keys.forEach(k => cMap[k] = config.bwMode ? '#000000' : '#64748b');
    }

    const calculatedStats = keys.map(k => ({ key: k, ...calculateStats(groups[k])! }));

    return { stats: calculatedStats, groupKeys: keys, colorMap: cMap };
  }, [data, config.groupBy, config.colorBy, config.bwMode]);

  // drawScale added
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    const isExport = !!exportConfig;

    // Scale margins with drawScale for export
    const margin = { 
        top: (60 * drawScale) + ((exportConfig?.graphY || 0) * drawScale), 
        right: 40 * drawScale, 
        bottom: 80 * drawScale, 
        left: (200 * drawScale) + ((exportConfig?.graphX || 0) * drawScale) // Giant left margin for axis
    };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // Y Axis Range
    const yMax = config.durationRange[1] > 0 ? config.durationRange[1] : Math.max(...stats.map(s => s.max)) * 1.1;
    const yMin = 0;

    const mapY = (val: number) => margin.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    
    // Grid
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = (1 * drawScale) / scale;
    ctx.fillStyle = '#64748b';
    
    // Axis Tick Labels (Use export config if available)
    const tickBaseSize = exportConfig ? exportConfig.tickLabelSize : (isExport ? 32 : 12);
    ctx.font = `bold ${(tickBaseSize * drawScale) / scale}px Inter`;
    ctx.textAlign = 'right';

    // Offsets
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale;

    // Y Axis Lines & Labels
    const ySteps = 5;
    for(let i=0; i<=ySteps; i++) {
        const val = yMin + (yMax - yMin) * (i/ySteps);
        const y = mapY(val);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartW, y);
        ctx.stroke();
        ctx.fillText(val.toFixed(2) + 's', margin.left - (15 * drawScale) + yTickOffsetX, y + (6 * drawScale) + yTickOffsetY);
    }

    // Y Axis Title (Added)
    if (exportConfig) {
        ctx.save();
        const yTitleSize = exportConfig.yAxisLabelSize * drawScale;
        ctx.font = `bold ${yTitleSize / scale}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        // Position at vertical center of chart, rotated
        const yLabelX = margin.left - (120 * drawScale) + ((exportConfig.yAxisLabelX || 0) * drawScale);
        const yLabelY = margin.top + (chartH / 2) + ((exportConfig.yAxisLabelY || 0) * drawScale);
        ctx.translate(yLabelX, yLabelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Duration (s)", 0, 0);
        ctx.restore();
    }

    // X Axis
    const spacing = chartW / stats.length;
    const barWidth = Math.min(60 * drawScale, (spacing) * 0.6);

    // Use xAxisLabelSize for the group labels at the bottom
    const labelFont = exportConfig ? exportConfig.xAxisLabelSize : (isExport ? 36 : 12);
    const metaFont = exportConfig ? (exportConfig.dataLabelSize * 0.8) : (isExport ? 28 : 10);

    stats.forEach((s, i) => {
        const xCenter = margin.left + (spacing * i) + spacing/2;
        const color = colorMap[s.key] || '#64748b';
        
        // Texture config
        let fillStyle: string | CanvasPattern = color;
        if (config.textureBy !== 'none' && config.textureBy === config.groupBy) {
             fillStyle = generateTexture(ctx, i, color, '#ffffff');
        }

        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = config.bwMode ? '#000' : color;
        ctx.lineWidth = (2 * drawScale) / scale;

        // Draw Box (Q1 to Q3)
        if (config.showQuartiles) {
            const yQ1 = mapY(s.q1);
            const yQ3 = mapY(s.q3);
            const yMedian = mapY(s.median);
            
            // Whiskers
            const yMinVal = mapY(s.min);
            const yMaxVal = mapY(s.max);
            
            ctx.beginPath();
            // Lower Whisker
            ctx.moveTo(xCenter, yQ1); ctx.lineTo(xCenter, yMinVal);
            ctx.moveTo(xCenter - barWidth/4, yMinVal); ctx.lineTo(xCenter + barWidth/4, yMinVal);
            
            // Upper Whisker
            ctx.moveTo(xCenter, yQ3); ctx.lineTo(xCenter, yMaxVal);
            ctx.moveTo(xCenter - barWidth/4, yMaxVal); ctx.lineTo(xCenter + barWidth/4, yMaxVal);
            ctx.stroke();

            // Box
            ctx.fillRect(xCenter - barWidth/2, yQ3, barWidth, yQ1 - yQ3);
            ctx.strokeRect(xCenter - barWidth/2, yQ3, barWidth, yQ1 - yQ3);
            
            // Median
            ctx.beginPath();
            ctx.moveTo(xCenter - barWidth/2, yMedian);
            ctx.lineTo(xCenter + barWidth/2, yMedian);
            ctx.lineWidth = (3 * drawScale) / scale;
            ctx.strokeStyle = config.bwMode ? 'white' : 'rgba(255,255,255,0.8)';
            ctx.stroke();
        } else {
            // Simple Bar (Mean)
            const yMean = mapY(s.mean);
            const yBase = mapY(0);
            ctx.fillRect(xCenter - barWidth/2, yMean, barWidth, yBase - yMean);
            ctx.strokeRect(xCenter - barWidth/2, yMean, barWidth, yBase - yMean);
            
            // Error Bars (SD)
            const ySDTop = mapY(s.mean + s.sd);
            ctx.beginPath();
            ctx.strokeStyle = '#334155';
            ctx.moveTo(xCenter, yMean); ctx.lineTo(xCenter, ySDTop);
            ctx.moveTo(xCenter - (5*drawScale), ySDTop); ctx.lineTo(xCenter + (5*drawScale), ySDTop);
            ctx.stroke();
        }

        // Mean Marker
        if (config.showMeanMarker) {
            const yMean = mapY(s.mean);
            ctx.fillStyle = 'white';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = (1 * drawScale) / scale;
            ctx.beginPath();
            ctx.moveTo(xCenter, yMean - (4*drawScale));
            ctx.lineTo(xCenter + (4*drawScale), yMean);
            ctx.lineTo(xCenter, yMean + (4*drawScale));
            ctx.lineTo(xCenter - (4*drawScale), yMean);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        // Labels
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.font = `bold ${(labelFont * drawScale) / scale}px Inter`;
        const xLabelX = xCenter + xTickOffsetX;
        const xLabelY = margin.top + chartH + (30 * drawScale) + xTickOffsetY;
        ctx.fillText(s.key, xLabelX, xLabelY);
        
        ctx.fillStyle = '#64748b';
        ctx.font = `${(metaFont * drawScale) / scale}px Inter`;
        ctx.fillText(`n=${s.count}`, xLabelX, xLabelY + (metaFont * 1.5 * drawScale));

        // Draw Individual Points (Jitter)
        if (config.showDurationPoints) {
            s.tokens.forEach((t, idx) => {
                // Deterministic pseudo-random jitter based on ID
                const hash = t.id.split('').reduce((a,b) => a + b.charCodeAt(0), 0);
                const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
                
                const px = xCenter + jitter;
                const py = mapY(t.duration);
                
                ctx.beginPath();
                ctx.arc(px, py, 2 * drawScale, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();
            });
        }
    });

  }, [stats, config, colorMap]);

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
        const plotWidth = baseWidth * graphScaleX;
        const plotHeight = baseHeight * graphScaleY;

        // Margins
        // DurationPlot renderPlot handles margins internally, but we set the canvas size here.
        
        let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || plotWidth;
        let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || plotHeight;
        
        offscreen.width = canvasWidth;
        offscreen.height = canvasHeight;
        
        const ctx = offscreen.getContext('2d');
        if(!ctx) return '';
        
        // White Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0, canvasWidth, canvasHeight);

        renderPlot(ctx, plotWidth, plotHeight, 1, drawScale, exportConfig);
        
        // Title
        if (exportConfig.showPlotTitle) {
            ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter`;
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            
            const titleX = (plotWidth/2) + ((exportConfig.plotTitleX || 0) * drawScale);
            const titleY = (100 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);
            
            ctx.fillText(exportConfig.plotTitle || `Duration Analysis by ${config.groupBy}`, titleX, titleY);
        }

        return offscreen.toDataURL('image/png');
    };

    return {
        exportImage: () => {
            // Legacy Support
            const defaultExportConfig: ExportConfig = {
                scale: 3, xAxisLabelSize: 48, yAxisLabelSize: 48, tickLabelSize: 24, dataLabelSize: 24,
                showLegend: true, legendTitleSize: 36, legendItemSize: 24,
                showColorLegend: true, colorLegendTitle: 'COLOR',
                showShapeLegend: true, shapeLegendTitle: 'SHAPE',
                showTextureLegend: true, textureLegendTitle: 'TEXTURE',
                showLineTypeLegend: true, lineTypeLegendTitle: 'LINE TYPE',
                showOverlayColorLegend: true, overlayColorLegendTitle: '',
                showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
                showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: '',
            };
            const url = generateImage(defaultExportConfig);
            if(url) {
                const link = document.createElement('a');
                link.download = 'duration_plot.png';
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
  }, [stats, config, renderPlot]);

  // Hit Test for Tooltips
  const handleMouseMove = (e: React.MouseEvent) => {
      if (!config.showDurationPoints) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left);
      const mouseY = (e.clientY - rect.top);
      
      const width = rect.width;
      const height = rect.height;
      const margin = { top: 60, right: 40, bottom: 80, left: 200 };
      const chartW = width - margin.left - margin.right;
      const chartH = height - margin.top - margin.bottom;
      
      const yMax = config.durationRange[1] > 0 ? config.durationRange[1] : Math.max(...stats.map(s => s.max)) * 1.1;
      const yMin = 0;
      const mapY = (val: number) => margin.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
      const spacing = chartW / stats.length;
      const barWidth = Math.min(60, (spacing) * 0.6);

      let closest: SpeechToken | null = null;
      let minDist = 10; // hit radius

      stats.forEach((s, i) => {
          const xCenter = margin.left + (spacing * i) + spacing/2;
          s.tokens.forEach(t => {
              const hash = t.id.split('').reduce((a,b) => a + b.charCodeAt(0), 0);
              const jitter = ((hash % 100) / 100 - 0.5) * barWidth * 0.8;
              const px = xCenter + jitter;
              const py = mapY(t.duration);
              
              const dist = Math.sqrt((px - mouseX)**2 + (py - mouseY)**2);
              if (dist < minDist) {
                  minDist = dist;
                  closest = t;
              }
          });
      });
      setHoveredToken(closest);
  };

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
          <div className="border-b border-slate-700 pb-1 mb-1 font-bold text-sky-400">File ID: {hoveredToken.file_id}</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Word:</span> {hoveredToken.word}</p>
             <p><span className="text-slate-400 font-bold uppercase text-[9px]">Phoneme:</span> {hoveredToken.canonical}</p>
             <p className="col-span-2"><span className="text-slate-400 font-bold uppercase text-[9px]">Duration:</span> {hoveredToken.duration.toFixed(3)}s</p>
          </div>
        </div>
      )}
    </div>
  );
});

export default DurationPlot;
