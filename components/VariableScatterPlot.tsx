import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig, DatasetMeta, Layer } from '../types';
import { getLabel } from '../utils/getLabel';
import { drawShape, hexToRgb, computeEncodingMaps, EncodingMaps, encodingGroupKey } from '../utils/plotEncoding';
import { axisTicks, formatMeasureValue } from '../utils/axisTicks';
import { measureLabel, measureValue } from '../utils/measures';
import { fitRange } from '../utils/plotRange';
import { tooltipFieldsFor } from '../utils/pointInfo';
import { axisFraction, panRange, zoomRange } from '../utils/zoomRange';
import { linearFit, LinearFit } from '../services/statistics';

/**
 * Any numeric variable against any other.
 *
 * The specialised plots answer a question you already have — where a vowel sits, how a
 * contour moves. This one is for the question you are still forming: whether two
 * measurements separate your categories at all. So it takes any two measures the dataset
 * carries, draws the same point/ellipse/mean vocabulary as the F1/F2 plot, and can fit a
 * line to say how strong the relationship is.
 */

interface VariableScatterPlotProps {
  layers: Layer[];
  layerData: Record<string, SpeechToken[]>;
  activeLayerId: string;
  datasetMeta: DatasetMeta | null;
  onLegendClick?: (category: string, currentStyles: { color: string, shape: string, texture: number, lineType: string }, event: React.MouseEvent, layerId?: string) => void;
  /** Reports the range actually drawn, so the Min/Max inputs can show real numbers. */
  onAutoRange?: (range: { x: [number, number], y: [number, number] }) => void;
  /**
   * Zoom and pan move the axes rather than scaling the canvas: the frame stays put and
   * the numbers on it change, so zooming out actually brings more data into view.
   */
  onViewRange?: (x: [number, number], y: [number, number]) => void;
}

interface Plotted { token: SpeechToken; x: number; y: number; }
interface DrawGroup { key: string; label: string; color: string; shape: string; points: Plotted[]; }

const prettyField = (key: string): string =>
  key === 'file_id' ? 'File ID' : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Group tokens exactly as the F1/F2 plot does, so the two read the same. */
const buildGroups = (
  data: SpeechToken[], enc: EncodingMaps, cfg: PlotConfig, defaultColor: string,
  valueOf: (t: SpeechToken) => Plotted | null,
): DrawGroup[] => {
  const byKey = new Map<string, Plotted[]>();
  for (const t of data) {
    const p = valueOf(t);
    if (!p) continue;
    const key = encodingGroupKey(t, enc, 'point');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(p);
  }
  return Array.from(byKey, ([key, points]) => {
    const [colorValue, secondValue] = key.split('|');
    const color = enc.colorKey ? (enc.colorMap[colorValue] || defaultColor) : defaultColor;
    const shape = enc.shapeKey
      ? (enc.shapeMap[enc.colorKey && enc.shapeKey !== enc.colorKey ? (secondValue ?? colorValue) : colorValue] || 'circle')
      : 'circle';
    const label = cfg.meanLabelType === 'color' ? colorValue
      : cfg.meanLabelType === 'shape' ? (secondValue ?? colorValue)
      : key === 'default' ? '' : key.replace('|', ' ');
    return { key, label, color, shape, points };
  });
};

const VariableScatterPlot = forwardRef<PlotHandle, VariableScatterPlotProps>((
  { layers, layerData, activeLayerId, datasetMeta, onLegendClick, onAutoRange, onViewRange }, ref,
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ lines: string[] } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const hits = useRef<{ token: SpeechToken, layer: Layer, x: number, y: number, coords: string[] }[]>([]);
  const lastRange = useRef<{ x: [number, number], y: [number, number] } | null>(null);

  const bgLayer = layers[0];
  const bgConfig = bgLayer.config;
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);

  // Both axes live on the background layer: every layer shares one coordinate space.
  const xField = bgConfig.varXField, yField = bgConfig.varYField;
  const xTime = bgConfig.varXTime ?? 50, yTime = bgConfig.varYTime ?? 50;

  const legendLayers = useMemo(() =>
    layers.filter(l => l.visible)
      .map(layer => ({ layer, enc: computeEncodingMaps(layerData[layer.id] || [], layer.config, layer.styleOverrides) }))
      .filter(x => x.enc.colorKey || x.enc.shapeKey),
    [layers, layerData]);
  const showTitles = legendLayers.length > 1;

  const tooltipValue = (t: SpeechToken, field: string): string => {
    if (field === 'duration') return t.duration != null ? `${t.duration}` : '';
    if (field === 'xmin') return t.xmin != null ? `${t.xmin}` : '';
    if (field === 'file_id') return t.file_id || '';
    if (field === 'speaker') return t.speaker || '';
    if (t.fields[field] !== undefined) return t.fields[field];
    return getLabel(t, field) || '';
  };

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, _mode: number, s: number, exportConfig?: ExportConfig) => {
    const capture = s === 1 && !exportConfig;
    if (capture) hits.current = [];
    const drawEmpty = (msg: string) => {
      ctx.fillStyle = '#94a3b8'; ctx.font = `${14 * s}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, width / 2, height / 2);
    };
    if (!xField || !yField) { drawEmpty('Choose a variable for each axis.'); return; }

    const legendGutter = (!exportConfig && legendLayers.length > 0) ? 288 : 24;
    const margin = { top: 24 * s, right: legendGutter * s, bottom: 64 * s, left: 88 * s };
    const area = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
    if (area.w <= 0 || area.h <= 0) return;

    const valueOf = (t: SpeechToken): Plotted | null => {
      const x = measureValue(t, xField, xTime);
      const y = measureValue(t, yField, yTime);
      return isFinite(x) && isFinite(y) ? { token: t, x, y } : null;
    };

    const visible = layers.filter(l => l.visible);
    const layerGroups = visible.map(layer => {
      const cfg = layer.config;
      const data = layerData[layer.id] || [];
      const enc = computeEncodingMaps(data, cfg, layer.styleOverrides);
      const defaultColor = cfg.bwMode ? '#000000' : '#64748b';
      return { layer, cfg, enc, groups: buildGroups(data, enc, cfg, defaultColor, valueOf) };
    });
    const allPoints = layerGroups.flatMap(l => l.groups.flatMap(g => g.points));
    if (allPoints.length === 0) { drawEmpty('No tokens carry both of these variables.'); return; }

    const manual = (r: [number, number]) => !(r[0] === 0 && r[1] === 0);
    const [xLo, xHi] = manual(bgConfig.varXRange) ? bgConfig.varXRange : fitRange(allPoints.map(p => p.x));
    const [yLo, yHi] = manual(bgConfig.varYRange) ? bgConfig.varYRange : fitRange(allPoints.map(p => p.y));
    if (!exportConfig && s === 1) {
      const prev = lastRange.current;
      if (!prev || prev.x[0] !== xLo || prev.x[1] !== xHi || prev.y[0] !== yLo || prev.y[1] !== yHi) {
        lastRange.current = { x: [xLo, xHi], y: [yLo, yHi] };
        onAutoRange?.({ x: [xLo, xHi], y: [yLo, yHi] });
      }
    }
    const mapX = (v: number) => area.x + ((v - xLo) / (xHi - xLo)) * area.w;
    const mapY = (v: number) => area.y + area.h - ((v - yLo) / (yHi - yLo)) * area.h;

    // ─── Frame ───
    const xt = axisTicks(xLo, xHi, 6), yt = axisTicks(yLo, yHi, 6);
    ctx.lineWidth = 1 * s; ctx.font = `${11 * s}px Inter, sans-serif`; ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.values.forEach(v => {
      const y = mapY(v);
      ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      ctx.fillText(formatMeasureValue(v), area.x - 6 * s, y);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.values.forEach(v => {
      const x = mapX(v);
      ctx.strokeStyle = '#f1f5f9'; ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      ctx.fillText(formatMeasureValue(v), x, area.y + area.h + 6 * s);
    });
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.strokeRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = '#334155'; ctx.font = `600 ${13 * s}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(measureLabel(xField, xTime, datasetMeta), area.x + area.w / 2, area.y + area.h + 42 * s);
    ctx.save(); ctx.translate(area.x - 60 * s, area.y + area.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(measureLabel(yField, yTime, datasetMeta), 0, 0); ctx.restore();

    // Data is clipped to the frame: a hand-set range must not spill over the axes.
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();

    layerGroups.forEach(({ layer, cfg, enc, groups }) => {
      // ─── Ellipses ───
      if (cfg.showEllipses) {
        groups.forEach(g => {
          if (g.points.length < 3) return;
          const px = g.points.map(p => ({ x: mapX(p.x), y: mapY(p.y) }));
          const n = px.length;
          const mx = px.reduce((a, p) => a + p.x, 0) / n, my = px.reduce((a, p) => a + p.y, 0) / n;
          let sxx = 0, syy = 0, sxy = 0;
          px.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); });
          sxx /= n; syy /= n; sxy /= n;
          const common = Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2);
          const l1 = (sxx + syy + common) / 2, l2 = (sxx + syy - common) / 2;
          ctx.save();
          ctx.translate(mx, my); ctx.rotate(Math.atan2(l1 - sxx, sxy));
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.sqrt(Math.max(l1, 0)) * cfg.ellipseSD, Math.sqrt(Math.max(l2, 0)) * cfg.ellipseSD, 0, 0, Math.PI * 2);
          ctx.fillStyle = g.color; ctx.globalAlpha = cfg.ellipseFillOpacity; ctx.fill();
          ctx.strokeStyle = g.color; ctx.globalAlpha = cfg.ellipseLineOpacity;
          ctx.lineWidth = (cfg.ellipseLineWidth || 1.5) * s; ctx.stroke();
          ctx.restore(); ctx.globalAlpha = 1;
        });
      }

      // ─── Points ───
      if (cfg.showPoints) {
        ctx.globalAlpha = cfg.pointOpacity;
        groups.forEach(g => g.points.forEach(p => {
          const x = mapX(p.x), y = mapY(p.y);
          ctx.fillStyle = g.color; ctx.strokeStyle = g.color;
          drawShape(ctx, g.shape, x, y, cfg.pointSize * s, 1, s);
          if (capture) {
            hits.current.push({
              token: p.token, layer, x, y,
              coords: [`${measureLabel(xField, xTime, datasetMeta)}: ${formatMeasureValue(p.x)}`,
                       `${measureLabel(yField, yTime, datasetMeta)}: ${formatMeasureValue(p.y)}`],
            });
          }
        }));
        ctx.globalAlpha = 1;
      }

      // ─── Regression ───
      // Per group when the plot is grouped, else one line over everything: a single line
      // through several clouds can suggest a relationship that holds in none of them.
      if (cfg.varShowRegression) {
        const series = cfg.varRegressionPerGroup && enc.colorKey
          ? groups.map(g => ({ label: g.label || g.key, color: g.color, points: g.points }))
          : [{ label: '', color: cfg.bwMode ? '#000000' : '#0f172a', points: groups.flatMap(g => g.points) }];
        series.forEach(sr => {
          const fit = linearFit(sr.points);
          if (!fit) return;
          const xs = sr.points.map(p => p.x);
          const from = Math.max(xLo, Math.min(...xs)), to = Math.min(xHi, Math.max(...xs));
          ctx.beginPath();
          ctx.moveTo(mapX(from), mapY(fit.intercept + fit.slope * from));
          ctx.lineTo(mapX(to), mapY(fit.intercept + fit.slope * to));
          ctx.strokeStyle = sr.color; ctx.lineWidth = (cfg.varRegressionWidth || 2) * s;
          ctx.setLineDash([]); ctx.stroke();
        });
      }

      // ─── Group means ───
      if (cfg.showCentroids) {
        ctx.globalAlpha = cfg.centroidOpacity ?? 1;
        groups.forEach(g => {
          if (g.points.length === 0) return;
          const mx = mapX(g.points.reduce((a, p) => a + p.x, 0) / g.points.length);
          const my = mapY(g.points.reduce((a, p) => a + p.y, 0) / g.points.length);
          if (cfg.labelAsCentroid && g.label) {
            const size = exportConfig ? exportConfig.dataLabelSize : (cfg.labelSize || 12);
            ctx.font = `bold ${size * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'white'; ctx.lineWidth = 4 * s; ctx.lineJoin = 'round';
            ctx.strokeText(g.label, mx, my); ctx.fillStyle = g.color; ctx.fillText(g.label, mx, my);
          } else {
            const cs = (cfg.centroidSize || 8) * s;
            ctx.fillStyle = 'white'; ctx.strokeStyle = 'white';
            drawShape(ctx, g.shape.replace('-open', ''), mx, my, cs + 2 * s, 1, s);
            ctx.fillStyle = g.color; ctx.strokeStyle = g.color;
            drawShape(ctx, g.shape, mx, my, cs, 1, s, cs * 0.25);
          }
        });
        ctx.globalAlpha = 1;
      }
    });
    ctx.restore();

    // ─── Fit statistics, over the active layer ───
    if (activeLayer.config.varShowRegression && activeLayer.config.varShowStats) {
      const active = layerGroups.find(l => l.layer.id === activeLayer.id);
      if (active) {
        const perGroup = active.cfg.varRegressionPerGroup && active.enc.colorKey;
        const series = perGroup
          ? active.groups.map(g => ({ label: g.label || g.key, color: g.color, points: g.points }))
          : [{ label: 'All tokens', color: '#334155', points: active.groups.flatMap(g => g.points) }];
        const lines = series
          .map(sr => ({ sr, fit: linearFit(sr.points) }))
          .filter((x): x is { sr: typeof series[0]; fit: LinearFit } => x.fit !== null);
        ctx.font = `${11 * s}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        lines.forEach(({ sr, fit }, i) => {
          const text = `${sr.label ? sr.label + ': ' : ''}r = ${fit.r.toFixed(2)}  R² = ${fit.r2.toFixed(2)}  p ${formatP(fit.pValue)}  n = ${fit.n}`;
          const y = area.y + 6 * s + i * 15 * s;
          ctx.fillStyle = 'white'; ctx.globalAlpha = 0.75;
          ctx.fillRect(area.x + 4 * s, y - 1 * s, ctx.measureText(text).width + 8 * s, 14 * s);
          ctx.globalAlpha = 1; ctx.fillStyle = sr.color;
          ctx.fillText(text, area.x + 8 * s, y);
        });
      }
    }

    // ─── On-screen legend ───
    if (!exportConfig && legendLayers.length > 0) {
      let ly = area.y + 4;
      const lx = area.x + area.w + 20;
      legendLayers.forEach(({ layer, enc }) => {
        if (showTitles) {
          ctx.fillStyle = '#0f172a'; ctx.font = `bold 11px Inter, sans-serif`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(layer.name, lx, ly); ly += 16;
        }
        if (enc.colorKey) {
          ctx.fillStyle = '#64748b'; ctx.font = `bold 9px Inter, sans-serif`;
          ctx.fillText(enc.colorKey.toUpperCase(), lx, ly); ly += 14;
          Object.keys(enc.colorMap).sort().forEach(k => {
            ctx.fillStyle = enc.colorMap[k]; ctx.beginPath(); ctx.arc(lx + 5, ly + 5, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#334155'; ctx.font = `11px Inter, sans-serif`;
            // Counts belong in every legend, so a group's weight is never guessed at
            ctx.fillText(`${k} (n=${enc.colorCounts[k] || 0})`, lx + 16, ly); ly += 16;
          });
          ly += 6;
        }
      });
    }
  }, [layers, layerData, bgConfig, activeLayer, datasetMeta, legendLayers, showTitles, xField, yField, xTime, yTime, onAutoRange]);

  // ─── Canvas plumbing ───
  const draw = useCallback(() => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth, h = container.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(dpr, dpr);
    renderPlot(ctx, w, h, 0, 1);
    ctx.restore();
  }, [renderPlot]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw]);

  useImperativeHandle(ref, () => ({
    exportImage: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png'); a.download = 'fred_scatter.png'; a.click();
    },
    generateImage: (exportConfig: ExportConfig) => {
      const scale = exportConfig.scale;
      const gsX = exportConfig.graphScaleX || exportConfig.graphScale || 1;
      const gsY = exportConfig.graphScaleY || exportConfig.graphScale || 1;
      const plotW = 2000 * gsX * scale, plotH = 1400 * gsY * scale;
      const entries: { color: string, label: string }[] = [];
      legendLayers.forEach(({ layer, enc }) => {
        if (enc.colorKey) Object.keys(enc.colorMap).sort().forEach(k => {
          const label = `${k} (n=${enc.colorCounts[k] || 0})`;
          entries.push({ color: enc.colorMap[k], label: showTitles ? `${label} · ${layer.name}` : label });
        });
      });
      const hasLegend = exportConfig.showLegend && entries.length > 0;
      const legendW = hasLegend ? 460 * scale : 0;
      const titleH = exportConfig.showPlotTitle ? (exportConfig.plotTitleSize || 96) * scale + 40 * scale : 0;
      const off = document.createElement('canvas');
      off.width = plotW + legendW + 40 * scale; off.height = plotH + titleH + 40 * scale;
      const ctx = off.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, off.width, off.height);
      if (exportConfig.showPlotTitle) {
        ctx.font = `bold ${(exportConfig.plotTitleSize || 96) * scale}px Inter, sans-serif`;
        ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(exportConfig.plotTitle || 'Scatter', plotW / 2, titleH / 2);
      }
      ctx.save(); ctx.translate(0, titleH); renderPlot(ctx, plotW, plotH, 1, scale, exportConfig); ctx.restore();
      if (hasLegend) {
        ctx.save(); ctx.translate(plotW + 40 * scale, titleH + 40 * scale);
        const itemS = (exportConfig.legendItemSize || 24) * scale;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        entries.forEach((it, i) => {
          const y = (i + 0.5) * itemS * 1.7;
          ctx.fillStyle = it.color; ctx.fillRect(0, y - itemS / 2, itemS, itemS);
          ctx.fillStyle = '#334155'; ctx.font = `${itemS}px Inter, sans-serif`;
          ctx.fillText(it.label, itemS * 1.4, y);
        });
        ctx.restore();
      }
      return off.toDataURL('image/png');
    },
  }), [renderPlot, legendLayers, showTitles]);

  // ─── Interaction ───
  /** The frame in canvas pixels — the same margins renderPlot uses. */
  const frame = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 0, h = rect?.height ?? 0;
    const gutter = legendLayers.length > 0 ? 288 : 24;
    return { x: 88, y: 24, w: w - 88 - gutter, h: h - 24 - 64 };
  };

  /** Zoom both axes about a point in canvas pixels, by moving the ranges. */
  const zoomAbout = (px: number, py: number, factor: number) => {
    const view = lastRange.current;
    if (!onViewRange || !view) return;
    const area = frame();
    if (area.w <= 0 || area.h <= 0) return;
    onViewRange(
      zoomRange(view.x, axisFraction(px, area.x, area.w), factor),
      zoomRange(view.y, axisFraction(py, area.y, area.h, true), factor),
    );
  };

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });
    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      const view = lastRange.current, area = frame();
      if (onViewRange && view && area.w > 0 && area.h > 0) {
        onViewRange(panRange(view.x, -dx / area.w), panRange(view.y, dy / area.h));
      }
      return;
    }
    const px = mx, py = my;
    let best: typeof hits.current[0] | null = null, bestD = 12;
    for (const h of hits.current) {
      const d = Math.hypot(h.x - px, h.y - py);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (!best) { setHovered(null); return; }
    const cfg = best.layer.config;
    const chosen = tooltipFieldsFor(layers, best.layer);
    const fields = chosen.length > 0 ? chosen : ['file_id'];
    const header = getLabel(best.token, cfg.colorBy) || best.token.file_id || best.token.id;
    const lines = [header];
    fields.forEach(f => { const v = tooltipValue(best!.token, f); if (v) lines.push(`${prettyField(f)}: ${v}`); });
    setHovered({ lines: [...lines, ...best.coords] });
  };

  return (
    <div ref={containerRef} className="w-full h-full relative"
      onMouseDown={e => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }}
      onMouseUp={() => { isDragging.current = false; }}
      onMouseLeave={() => { isDragging.current = false; setHovered(null); }}
      onMouseMove={onMove}
      onWheel={e => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        zoomAbout(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
      {hovered && (
        <div className="absolute pointer-events-none bg-slate-900/90 text-white text-[11px] rounded px-2 py-1 z-10"
          style={{ left: mousePos.x + 12, top: mousePos.y + 12 }}>
          {hovered.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>)}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex gap-1">
        <button onClick={() => onViewRange?.([0, 0], [0, 0])}
          className="px-2 py-1 text-[10px] font-bold bg-white/90 border border-slate-200 rounded hover:bg-white"
          title="Fit the axes to the data again">
          Fit to data
        </button>
      </div>
    </div>
  );
});

/** p-values below the resolution of the test read as a bound, not a number. */
const formatP = (p: number): string => p < 0.001 ? '< 0.001' : `= ${p.toFixed(3)}`;

export default VariableScatterPlot;
