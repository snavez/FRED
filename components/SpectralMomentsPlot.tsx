import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig, DatasetMeta, Layer } from '../types';
import { getLabel } from '../utils/getLabel';
import {
  drawShape, ShapeIcon, hexToRgb, computeEncodingMaps, EncodingMaps,
} from '../utils/plotEncoding';
import {
  discoverSpectralMoments, getSpectralValue, nearestSpectralTimePoint,
  spectralAxisLabel, getSpectralMomentDef, SpectralMomentKey, SpectralMomentMeta,
} from '../utils/spectralMoments';

interface SpectralMomentsPlotProps {
  layers: Layer[];
  layerData: Record<string, SpeechToken[]>;
  activeLayerId: string;
  datasetMeta: DatasetMeta | null;
  onLegendClick?: (category: string, currentStyles: { color: string, shape: string, texture: number, lineType: string }, event: React.MouseEvent, layerId?: string) => void;
}

interface MomentStats { min: number; max: number; q1: number; median: number; q3: number; mean: number; sd: number; count: number; values: number[]; }

const calcStats = (values: number[]): MomentStats | null => {
  const v = values.filter(x => !isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { min: v[0], max: v[v.length - 1], q1: q(0.25), median: q(0.5), q3: q(0.75), mean, sd, count: v.length, values: v };
};

const niceTicks = (min: number, max: number, target = 6): number[] => {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const rawStep = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 0.001; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
};

const kde = (values: number[], grid: number[]): number[] => {
  const n = values.length;
  if (n === 0) return grid.map(() => 0);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  const sorted = [...values].sort((a, b) => a - b);
  const iqr = (sorted[Math.floor(n * 0.75)] - sorted[Math.floor(n * 0.25)]) || sd;
  const bw = 0.9 * Math.min(sd, iqr / 1.34) * Math.pow(n, -0.2) || 1;
  const norm = 1 / (n * bw * Math.sqrt(2 * Math.PI));
  return grid.map(g => { let s = 0; for (const v of values) { const u = (g - v) / bw; s += Math.exp(-0.5 * u * u); } return s * norm; });
};

const momentKey = (s: string): SpectralMomentKey => s as SpectralMomentKey;
const pickMoment = (want: string, available: SpectralMomentKey[], fallbackIdx = 0): SpectralMomentKey =>
  available.includes(momentKey(want)) ? momentKey(want) : (available[fallbackIdx] ?? available[0]);

/** A coloured/shaped group of tokens sharing colour (and optionally shape or line-type). */
interface EncGroup { key: string; tokens: SpeechToken[]; color: string; shape: string; dash: number[]; label: string; }

/** Group tokens by colour (and a secondary shape/line-type channel), mirroring F1/F2 grouping. */
const buildGroups = (data: SpeechToken[], enc: EncodingMaps, secondary: 'shape' | 'lineType' | null, defaultColor: string, meanLabelType: string): EncGroup[] => {
  const secKey = secondary === 'shape' ? enc.shapeKey : secondary === 'lineType' ? enc.lineTypeKey : null;
  const map: Record<string, { tokens: SpeechToken[], cVal: string, sVal: string }> = {};
  data.forEach(t => {
    const cVal = enc.colorKey ? getLabel(t, enc.colorKey) : '';
    const sVal = secKey ? getLabel(t, secKey) : '';
    let key = '__all__';
    if (enc.colorKey && secKey && enc.colorKey !== secKey) key = `${cVal}|${sVal}`;
    else if (enc.colorKey) key = cVal;
    else if (secKey) key = sVal;
    (map[key] ||= { tokens: [], cVal, sVal }).tokens.push(t);
  });
  return Object.entries(map).map(([key, g]) => {
    const color = enc.colorKey ? (enc.colorMap[g.cVal] || defaultColor) : defaultColor;
    const shape = (secondary === 'shape' && secKey) ? (enc.shapeMap[g.sVal] || 'circle')
      : (enc.shapeKey && enc.shapeKey === enc.colorKey ? (enc.shapeMap[g.cVal] || 'circle') : 'circle');
    const dash = (secondary === 'lineType' && secKey) ? (enc.lineTypePatternMap[g.sVal] || [])
      : (enc.lineTypeKey && enc.lineTypeKey === enc.colorKey ? (enc.lineTypePatternMap[g.cVal] || []) : []);
    let label = key === '__all__' ? '' : key.replace('|', ' ');
    if (key.includes('|')) label = meanLabelType === 'color' ? g.cVal : meanLabelType === 'shape' ? g.sVal : `${g.cVal} ${g.sVal}`;
    return { key, tokens: g.tokens, color, shape, dash, label };
  });
};

const SpectralMomentsPlot = forwardRef<PlotHandle, SpectralMomentsPlotProps>(({ layers, layerData, activeLayerId, datasetMeta, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ lines: string[] } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const scatterHits = useRef<{ token: SpeechToken, layer: Layer, x: number, y: number, extra: string[] }[]>([]);

  const bgLayer = layers[0];
  const bgConfig = bgLayer.config;
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);
  const activeConfig = activeLayer.config;
  const activeData = useMemo(() => layerData[activeLayerId] || [], [layerData, activeLayerId]);

  const allTokens = useMemo(() => Object.values(layerData).flat(), [layerData]);
  const sm = useMemo<SpectralMomentMeta>(() => discoverSpectralMoments(allTokens, datasetMeta), [allTokens, datasetMeta]);
  const availableKeys = useMemo(() => sm.moments.map(m => m.key), [sm]);

  const defaultColor = (cfg: PlotConfig) => cfg.bwMode ? '#000000' : '#64748b';

  const tooltipValue = (t: SpeechToken, field: string): string => {
    if (field === 'duration') return t.duration != null ? `${t.duration}` : '';
    if (field === 'xmin') return t.xmin != null ? `${t.xmin}` : '';
    if (field === 'file_id') return t.file_id || '';
    if (field === 'speaker') return t.speaker || '';
    if (t.fields[field] !== undefined) return t.fields[field];
    return getLabel(t, field) || '';
  };
  const tooltipLines = (t: SpeechToken, layer: Layer, coords: string[]): string[] => {
    const fields = layer.config.tooltipFields && layer.config.tooltipFields.length > 0 ? layer.config.tooltipFields : ['file_id'];
    const header = getLabel(t, layer.config.colorBy) || t.file_id || t.id;
    const lines = [header];
    fields.forEach(f => { const v = tooltipValue(t, f); if (v) lines.push(`${prettyField(f)}: ${v}`); });
    return [...lines, ...coords];
  };

  // ─── Shared axis frame ────────────────────────────────────────────
  const drawFrame = (ctx: CanvasRenderingContext2D, area: { x: number, y: number, w: number, h: number }, xTicks: { pos: number, label: string }[], yTicks: { pos: number, label: string }[], xLabel: string, yLabel: string, s: number) => {
    ctx.lineWidth = 1 * s; ctx.fillStyle = '#64748b'; ctx.font = `${11 * s}px Inter, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yTicks.forEach(t => { ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(area.x, t.pos); ctx.lineTo(area.x + area.w, t.pos); ctx.stroke(); ctx.fillText(t.label, area.x - 6 * s, t.pos); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xTicks.forEach(t => { ctx.strokeStyle = '#f1f5f9'; ctx.beginPath(); ctx.moveTo(t.pos, area.y); ctx.lineTo(t.pos, area.y + area.h); ctx.stroke(); ctx.fillText(t.label, t.pos, area.y + area.h + 6 * s); });
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.strokeRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = '#334155'; ctx.font = `600 ${13 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(xLabel, area.x + area.w / 2, area.y + area.h + 34 * s);
    ctx.save(); ctx.translate(area.x - 52 * s, area.y + area.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  };
  const drawEmpty = (ctx: CanvasRenderingContext2D, w: number, h: number, msg: string, s: number) => {
    ctx.fillStyle = '#94a3b8'; ctx.font = `${14 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(msg, w / 2, h / 2);
  };

  // ─── Main render ──────────────────────────────────────────────────
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, _mode: number, s: number, exportConfig?: ExportConfig) => {
    const capture = s === 1 && !exportConfig;
    if (capture) scatterHits.current = [];
    if (!sm.available) { drawEmpty(ctx, width, height, 'No spectral-moment columns (COG / SD / skew / kurt) found in this dataset.', s); return; }

    const margin = { top: 24 * s, right: 24 * s, bottom: 56 * s, left: 82 * s };
    const area = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
    if (area.w <= 0 || area.h <= 0) return;
    const rangeOr = (cfg: [number, number], lo: number, hi: number): [number, number] => (cfg[0] === 0 && cfg[1] === 0) ? [lo, hi] : cfg;
    const view = activeConfig.spectralMode;

    // ═══ SCATTER (multi-layer, moment × moment) ═══
    if (view === 'scatter') {
      const xM = pickMoment(bgConfig.spectralXMoment, availableKeys, 0);
      const yM = pickMoment(bgConfig.spectralYMoment, availableKeys, 1);
      const visible = layers.filter(l => l.visible);

      const xs: number[] = [], ys: number[] = [];
      visible.forEach(layer => {
        const data = layerData[layer.id] || [];
        const tps = layer.config.plotType === 'trajectory' ? sm.timePoints : [nearestSpectralTimePoint(sm, layer.config.spectralTimePoint) ?? sm.timePoints[0]];
        data.forEach(t => tps.forEach(tp => { const x = getSpectralValue(t, sm, xM, tp), y = getSpectralValue(t, sm, yM, tp); if (!isNaN(x) && !isNaN(y)) { xs.push(x); ys.push(y); } }));
      });
      if (xs.length === 0) { drawEmpty(ctx, width, height, 'No valid values for the selected moments. Add/adjust a layer or timepoint.', s); return; }
      const pad = (arr: number[]): [number, number] => { const lo = Math.min(...arr), hi = Math.max(...arr), d = (hi - lo) * 0.06 || 1; return [lo - d, hi + d]; };
      const [xLo, xHi] = rangeOr(bgConfig.spectralXRange, ...pad(xs));
      const [yLo, yHi] = rangeOr(bgConfig.spectralYRange, ...pad(ys));
      const mapX = (v: number) => area.x + ((v - xLo) / (xHi - xLo)) * area.w;
      const mapY = (v: number) => area.y + area.h - ((v - yLo) / (yHi - yLo)) * area.h;

      drawFrame(ctx, area,
        niceTicks(xLo, xHi).filter(t => t >= xLo && t <= xHi).map(t => ({ pos: mapX(t), label: `${t}` })),
        niceTicks(yLo, yHi).filter(t => t >= yLo && t <= yHi).map(t => ({ pos: mapY(t), label: `${t}` })),
        spectralAxisLabel(xM), spectralAxisLabel(yM), s);

      visible.forEach(layer => {
        const cfg = layer.config;
        const data = layerData[layer.id] || [];
        const enc = computeEncodingMaps(data, cfg, layer.styleOverrides);
        const dc = defaultColor(cfg);
        const colorOf = (t: SpeechToken) => enc.colorKey ? (enc.colorMap[getLabel(t, enc.colorKey)] || dc) : dc;

        if (cfg.plotType === 'trajectory') {
          const xy = (t: SpeechToken, tp: number) => ({ x: getSpectralValue(t, sm, xM, tp), y: getSpectralValue(t, sm, yM, tp) });
          // Individual token paths (opacity 0 = hidden)
          if ((cfg.trajectoryLineOpacity ?? 0.5) > 0) {
            data.forEach(t => {
              const path = sm.timePoints.map(tp => ({ tp, ...xy(t, tp) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
              if (path.length < 2) return;
              ctx.beginPath();
              path.forEach((p, i) => { const px = mapX(p.x), py = mapY(p.y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
              ctx.setLineDash(enc.lineTypeKey ? (enc.lineTypePatternMap[getLabel(t, enc.lineTypeKey)] || []).map(d => d * s) : []);
              ctx.globalAlpha = cfg.trajectoryLineOpacity ?? 0.5;
              ctx.strokeStyle = colorOf(t); ctx.lineWidth = (cfg.trajectoryLineWidth || 1) * s; ctx.stroke();
              ctx.globalAlpha = 1; ctx.setLineDash([]);
              if (capture) path.forEach(p => scatterHits.current.push({ token: t, layer, x: mapX(p.x), y: mapY(p.y), extra: [`${getSpectralMomentDef(xM).short}@${p.tp}%: ${p.x.toFixed(1)}`, `${getSpectralMomentDef(yM).short}@${p.tp}%: ${p.y.toFixed(1)}`] }));
            });
          }
          // Mean trajectory per group
          if (cfg.showMeanTrajectories) {
            buildGroups(data, enc, 'lineType', dc, cfg.meanLabelType).forEach(g => {
              const mpath = sm.timePoints.map(tp => {
                const pts = g.tokens.map(t => xy(t, tp)).filter(p => !isNaN(p.x) && !isNaN(p.y));
                return pts.length ? { tp, x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : null;
              }).filter(Boolean) as { tp: number, x: number, y: number }[];
              if (mpath.length < 1) return;
              ctx.globalAlpha = cfg.meanTrajectoryOpacity ?? 1;
              ctx.setLineDash(g.dash.map(d => d * s));
              ctx.beginPath();
              mpath.forEach((p, i) => { const px = mapX(p.x), py = mapY(p.y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
              ctx.strokeStyle = g.color; ctx.lineWidth = (cfg.meanTrajectoryWidth || 3) * s; ctx.stroke();
              ctx.setLineDash([]);
              const ptSize = cfg.meanTrajectoryPointSize ?? 4;
              if (ptSize > 0) mpath.forEach(p => { ctx.beginPath(); ctx.arc(mapX(p.x), mapY(p.y), ptSize * s, 0, Math.PI * 2); ctx.fillStyle = g.color; ctx.fill(); });
              const arrow = cfg.meanTrajectoryArrowSize ?? 3;
              if (arrow > 0 && mpath.length >= 2) {
                const a = mpath[mpath.length - 2], b = mpath[mpath.length - 1];
                const ang = Math.atan2(mapY(b.y) - mapY(a.y), mapX(b.x) - mapX(a.x));
                const size = (arrow + 4) * s, hx = mapX(b.x), hy = mapY(b.y);
                ctx.beginPath(); ctx.moveTo(hx, hy);
                ctx.lineTo(hx - size * Math.cos(ang - Math.PI / 6), hy - size * Math.sin(ang - Math.PI / 6));
                ctx.lineTo(hx - size * Math.cos(ang + Math.PI / 6), hy - size * Math.sin(ang + Math.PI / 6));
                ctx.closePath(); ctx.fillStyle = g.color; ctx.fill();
              }
              ctx.globalAlpha = 1;
              if (cfg.showTrajectoryLabels && g.label && mpath.length) {
                const last = mpath[mpath.length - 1];
                const size = exportConfig ? exportConfig.dataLabelSize : (cfg.meanTrajectoryLabelSize || 12);
                ctx.font = `bold ${size * s}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'white'; ctx.lineWidth = 3 * s; ctx.lineJoin = 'round';
                ctx.strokeText(g.label, mapX(last.x) + 6 * s, mapY(last.y)); ctx.fillStyle = g.color; ctx.fillText(g.label, mapX(last.x) + 6 * s, mapY(last.y));
              }
              if (capture) mpath.forEach(p => scatterHits.current.push({ token: g.tokens[0], layer, x: mapX(p.x), y: mapY(p.y), extra: [`${g.label || layer.name} (mean, n=${g.tokens.length})`, `${getSpectralMomentDef(xM).short}@${p.tp}%: ${p.x.toFixed(1)}`, `${getSpectralMomentDef(yM).short}@${p.tp}%: ${p.y.toFixed(1)}`] }));
            });
          }
        } else {
          // ── Point layer ──
          const tp = nearestSpectralTimePoint(sm, cfg.spectralTimePoint) ?? sm.timePoints[0];
          const valid = (t: SpeechToken) => { const x = getSpectralValue(t, sm, xM, tp), y = getSpectralValue(t, sm, yM, tp); return isNaN(x) || isNaN(y) ? null : { x, y }; };
          const groups = buildGroups(data, enc, 'shape', dc, cfg.meanLabelType);

          if (cfg.showEllipses) {
            groups.forEach(g => {
              const pts = g.tokens.map(valid).filter(Boolean).map(p => ({ x: mapX(p!.x), y: mapY(p!.y) }));
              if (pts.length < 3) return;
              let mx = 0, my = 0; pts.forEach(p => { mx += p.x; my += p.y; }); mx /= pts.length; my /= pts.length;
              let sxx = 0, syy = 0, sxy = 0; pts.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }); sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
              const common = Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2);
              const l1 = (sxx + syy + common) / 2, l2 = (sxx + syy - common) / 2, angle = Math.atan2(l1 - sxx, sxy);
              ctx.save(); ctx.translate(mx, my); ctx.rotate(angle);
              ctx.fillStyle = g.color; ctx.strokeStyle = g.color;
              ctx.globalAlpha = cfg.ellipseFillOpacity ?? 0.1;
              ctx.beginPath(); ctx.ellipse(0, 0, Math.sqrt(Math.max(l1, 0)) * (cfg.ellipseSD || 1.5), Math.sqrt(Math.max(l2, 0)) * (cfg.ellipseSD || 1.5), 0, 0, Math.PI * 2); ctx.fill();
              ctx.globalAlpha = cfg.ellipseLineOpacity ?? 0.8; ctx.lineWidth = (cfg.ellipseLineWidth || 1.5) * s; ctx.stroke();
              ctx.restore(); ctx.globalAlpha = 1;
            });
          }
          if (cfg.showPoints) {
            ctx.globalAlpha = cfg.pointOpacity ?? 0.6;
            data.forEach(t => {
              const p = valid(t); if (!p) return;
              const px = mapX(p.x), py = mapY(p.y);
              const shape = enc.shapeKey ? (enc.shapeMap[getLabel(t, enc.shapeKey)] || 'circle') : 'circle';
              ctx.fillStyle = colorOf(t); ctx.strokeStyle = colorOf(t);
              drawShape(ctx, shape, px, py, (cfg.pointSize || 3) * s, 1, s);
              if (capture) scatterHits.current.push({ token: t, layer, x: px, y: py, extra: [`${getSpectralMomentDef(xM).short}@${tp}%: ${p.x.toFixed(1)}`, `${getSpectralMomentDef(yM).short}@${tp}%: ${p.y.toFixed(1)}`] });
            });
            ctx.globalAlpha = 1;
          }
          if (cfg.showCentroids) {
            ctx.globalAlpha = cfg.centroidOpacity ?? 1;
            groups.forEach(g => {
              const pts = g.tokens.map(valid).filter(Boolean).map(p => ({ x: mapX(p!.x), y: mapY(p!.y) }));
              if (!pts.length) return;
              let mx = 0, my = 0; pts.forEach(p => { mx += p.x; my += p.y; }); mx /= pts.length; my /= pts.length;
              if (cfg.labelAsCentroid) {
                const size = exportConfig ? exportConfig.dataLabelSize : (cfg.labelSize || 12);
                ctx.font = `bold ${size * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'white'; ctx.lineWidth = 4 * s; ctx.lineJoin = 'round';
                ctx.strokeText(g.label || activeLayer.name, mx, my); ctx.fillStyle = g.color; ctx.fillText(g.label || activeLayer.name, mx, my);
              } else {
                const cs = (cfg.centroidSize || 8) * s;
                ctx.fillStyle = 'white'; ctx.strokeStyle = 'white';
                drawShape(ctx, g.shape.replace('-open', ''), mx, my, cs + 2 * s, 1, s);
                ctx.fillStyle = g.color; ctx.strokeStyle = g.color;
                drawShape(ctx, g.shape, mx, my, cs, 1, s, cs * 0.25);
                if (!['plus', 'cross', 'asterisk'].includes(g.shape) && !g.shape.endsWith('-open')) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2 * s; ctx.stroke(); }
              }
              if (capture) scatterHits.current.push({ token: g.tokens[0], layer, x: mx, y: my, extra: [`${g.label || layer.name} (mean, n=${g.tokens.length})`] });
            });
            ctx.globalAlpha = 1;
          }
        }
      });
      return;
    }

    // ═══ SUMMARY MODES (active layer) ═══
    const data = activeData;
    const cfg = activeConfig;
    if (data.length === 0) { drawEmpty(ctx, width, height, 'No data in the active layer.', s); return; }
    const single = pickMoment(cfg.spectralMoment, availableKeys, 0);
    const tp = nearestSpectralTimePoint(sm, cfg.spectralTimePoint) ?? sm.timePoints[0];
    const enc = computeEncodingMaps(data, cfg, activeLayer.styleOverrides);
    const dc = defaultColor(cfg);
    const keys = enc.colorKey ? Object.keys(enc.colorMap) : ['__all__'];
    const colorForKey = (k: string) => enc.colorKey ? (enc.colorMap[k] || dc) : dc;
    const groups: Record<string, SpeechToken[]> = {}; keys.forEach(k => { groups[k] = []; });
    data.forEach(t => { const g = enc.colorKey ? getLabel(t, enc.colorKey) : '__all__'; (groups[g] ||= []).push(t); });

    if (view === 'box') {
      const stats = keys.map(k => ({ key: k, stats: calcStats((groups[k] || []).map(t => getSpectralValue(t, sm, single, tp))) })).filter(g => g.stats) as { key: string, stats: MomentStats }[];
      if (stats.length === 0) { drawEmpty(ctx, width, height, 'No valid values for the selected moment/timepoint.', s); return; }
      const allMin = Math.min(...stats.map(g => g.stats.min)), allMax = Math.max(...stats.map(g => g.stats.max));
      const dpad = (allMax - allMin) * 0.06 || 1;
      const [yLo, yHi] = rangeOr(cfg.spectralYRange, allMin - dpad, allMax + dpad);
      const mapY = (v: number) => area.y + area.h - ((v - yLo) / (yHi - yLo)) * area.h;
      const slotW = area.w / stats.length, boxW = Math.min(60 * s, slotW * 0.6);
      drawFrame(ctx, area, stats.map((g, i) => ({ pos: area.x + (i + 0.5) * slotW, label: g.key === '__all__' ? 'All' : g.key })),
        niceTicks(yLo, yHi).filter(t => t >= yLo && t <= yHi).map(t => ({ pos: mapY(t), label: `${t}` })),
        cfg.colorBy && cfg.colorBy !== 'none' ? cfg.colorBy : 'Group', spectralAxisLabel(single, tp), s);
      stats.forEach((g, i) => {
        const cx = area.x + (i + 0.5) * slotW, color = colorForKey(g.key), st = g.stats;
        if (cfg.spectralViolin) {
          const grid: number[] = []; const gN = 48; for (let k = 0; k <= gN; k++) grid.push(st.min + (st.max - st.min) * (k / gN));
          const dens = kde(st.values, grid), dMax = Math.max(...dens) || 1;
          ctx.beginPath();
          grid.forEach((v, k) => { const w = (dens[k] / dMax) * boxW / 2, yy = mapY(v); if (k === 0) ctx.moveTo(cx - w, yy); else ctx.lineTo(cx - w, yy); });
          for (let k = grid.length - 1; k >= 0; k--) ctx.lineTo(cx + (dens[k] / dMax) * boxW / 2, mapY(grid[k]));
          ctx.closePath(); ctx.fillStyle = `rgba(${hexToRgb(color)},0.35)`; ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s; ctx.fill(); ctx.stroke();
        } else {
          const iqr = st.q3 - st.q1;
          const wLow = st.values.find(v => v >= st.q1 - 1.5 * iqr) ?? st.min, wHigh = [...st.values].reverse().find(v => v <= st.q3 + 1.5 * iqr) ?? st.max;
          ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s;
          ctx.beginPath(); ctx.moveTo(cx, mapY(wHigh)); ctx.lineTo(cx, mapY(st.q3)); ctx.moveTo(cx, mapY(st.q1)); ctx.lineTo(cx, mapY(wLow));
          ctx.moveTo(cx - boxW / 4, mapY(wHigh)); ctx.lineTo(cx + boxW / 4, mapY(wHigh)); ctx.moveTo(cx - boxW / 4, mapY(wLow)); ctx.lineTo(cx + boxW / 4, mapY(wLow)); ctx.stroke();
          ctx.fillStyle = `rgba(${hexToRgb(color)},0.35)`; ctx.fillRect(cx - boxW / 2, mapY(st.q3), boxW, mapY(st.q1) - mapY(st.q3)); ctx.strokeRect(cx - boxW / 2, mapY(st.q3), boxW, mapY(st.q1) - mapY(st.q3));
          ctx.beginPath(); ctx.moveTo(cx - boxW / 2, mapY(st.median)); ctx.lineTo(cx + boxW / 2, mapY(st.median)); ctx.lineWidth = 2.5 * s; ctx.stroke();
          st.values.forEach(v => { if (v < wLow || v > wHigh) { ctx.beginPath(); ctx.arc(cx, mapY(v), 2 * s, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); } });
        }
        ctx.fillStyle = '#94a3b8'; ctx.font = `${10 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`n=${st.count}`, cx, area.y + area.h + 20 * s);
      });
      return;
    }

    if (view === 'timeline') {
      const tps = sm.timePoints;
      if (tps.length < 2) { drawEmpty(ctx, width, height, 'Timeline needs ≥2 timepoints; this dataset has one.', s); return; }
      let vLo = Infinity, vHi = -Infinity;
      data.forEach(t => tps.forEach(t2 => { const v = getSpectralValue(t, sm, single, t2); if (!isNaN(v)) { vLo = Math.min(vLo, v); vHi = Math.max(vHi, v); } }));
      if (!isFinite(vLo)) { drawEmpty(ctx, width, height, 'No valid values for the selected moment.', s); return; }
      const dpad = (vHi - vLo) * 0.06 || 1; [vLo, vHi] = rangeOr(cfg.spectralYRange, vLo - dpad, vHi + dpad);
      const mapX = (t2: number) => area.x + ((t2 - tps[0]) / (tps[tps.length - 1] - tps[0])) * area.w;
      const mapY = (v: number) => area.y + area.h - ((v - vLo) / (vHi - vLo)) * area.h;
      drawFrame(ctx, area, tps.map(t2 => ({ pos: mapX(t2), label: `${t2}%` })), niceTicks(vLo, vHi).filter(t => t >= vLo && t <= vHi).map(t => ({ pos: mapY(t), label: `${t}` })), 'Segment position', spectralAxisLabel(single), s);
      if (cfg.spectralShowIndividual) {
        data.forEach(t => {
          const path = tps.map(t2 => ({ t2, v: getSpectralValue(t, sm, single, t2) })).filter(p => !isNaN(p.v));
          if (path.length < 2) return;
          ctx.beginPath(); path.forEach((p, i) => { const x = mapX(p.t2), y = mapY(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.strokeStyle = `rgba(${hexToRgb(enc.colorKey ? (enc.colorMap[getLabel(t, enc.colorKey)] || dc) : dc)},0.12)`; ctx.lineWidth = 1 * s; ctx.stroke();
        });
      }
      keys.forEach(k => {
        const toks = groups[k] || [], color = colorForKey(k);
        const means = tps.map(t2 => { const vals = toks.map(t => getSpectralValue(t, sm, single, t2)).filter(v => !isNaN(v)); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN; });
        ctx.beginPath(); let started = false;
        means.forEach((m, i) => { if (isNaN(m)) return; const x = mapX(tps[i]), y = mapY(m); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
        ctx.strokeStyle = color; ctx.lineWidth = 3 * s; ctx.stroke();
        means.forEach((m, i) => { if (isNaN(m)) return; ctx.beginPath(); ctx.arc(mapX(tps[i]), mapY(m), 4 * s, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
      });
      return;
    }

    // density
    {
      let vLo = Infinity, vHi = -Infinity;
      data.forEach(t => { const v = getSpectralValue(t, sm, single, tp); if (!isNaN(v)) { vLo = Math.min(vLo, v); vHi = Math.max(vHi, v); } });
      if (!isFinite(vLo)) { drawEmpty(ctx, width, height, 'No valid values for the selected moment/timepoint.', s); return; }
      const dpad = (vHi - vLo) * 0.05 || 1;
      const [xLo, xHi] = rangeOr(cfg.spectralXRange, vLo - dpad, vHi + dpad);
      const grid: number[] = []; const gN = 160; for (let k = 0; k <= gN; k++) grid.push(xLo + (xHi - xLo) * (k / gN));
      const curves = keys.map(k => ({ key: k, dens: kde((groups[k] || []).map(t => getSpectralValue(t, sm, single, tp)).filter(v => !isNaN(v)), grid) }));
      const dMax = Math.max(...curves.flatMap(c => c.dens), 1e-9);
      const mapX = (v: number) => area.x + ((v - xLo) / (xHi - xLo)) * area.w;
      const mapY = (d: number) => area.y + area.h - (d / dMax) * area.h * 0.95;
      drawFrame(ctx, area, niceTicks(xLo, xHi).filter(t => t >= xLo && t <= xHi).map(t => ({ pos: mapX(t), label: `${t}` })), [], spectralAxisLabel(single, tp), 'Density', s);
      curves.forEach(c => {
        const color = colorForKey(c.key);
        ctx.beginPath(); c.dens.forEach((d, k) => { const x = mapX(grid[k]), y = mapY(d); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.lineTo(mapX(xHi), area.y + area.h); ctx.lineTo(mapX(xLo), area.y + area.h); ctx.closePath(); ctx.fillStyle = `rgba(${hexToRgb(color)},0.18)`; ctx.fill();
        ctx.beginPath(); c.dens.forEach((d, k) => { const x = mapX(grid[k]), y = mapY(d); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.stroke();
      });
    }
  }, [sm, availableKeys, layers, layerData, activeConfig, activeData, activeLayer, bgConfig]);

  // ─── Legend (per visible layer, colour/shape/line-type sections) ──
  const legendLayers = useMemo(() => {
    const view = activeConfig.spectralMode;
    const src = view === 'scatter' ? layers.filter(l => l.visible) : [activeLayer];
    return src.map(layer => ({ layer, enc: computeEncodingMaps(layerData[layer.id] || [], layer.config, layer.styleOverrides), isTraj: view === 'scatter' && layer.config.plotType === 'trajectory' }))
      .filter(x => x.enc.colorKey || x.enc.shapeKey || x.enc.lineTypeKey);
  }, [layers, layerData, activeConfig.spectralMode, activeLayer]);
  const showTitles = legendLayers.length > 1;

  // ─── Export handle ────────────────────────────────────────────────
  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
      const drawScale = exportConfig.scale;
      const baseW = 2000, baseH = 1400;
      const gsX = exportConfig.graphScaleX || exportConfig.graphScale || 1, gsY = exportConfig.graphScaleY || exportConfig.graphScale || 1;
      const plotW = baseW * gsX * drawScale, plotH = baseH * gsY * drawScale;
      const legendEntries: { color: string, label: string }[] = [];
      legendLayers.forEach(({ layer, enc }) => { if (enc.colorKey) Object.keys(enc.colorMap).sort().forEach(k => legendEntries.push({ color: enc.colorMap[k], label: showTitles ? `${k} · ${layer.name}` : k })); });
      const hasLegend = exportConfig.showLegend && legendEntries.length > 0;
      const legendW = hasLegend ? 460 * drawScale : 0;
      const titleH = exportConfig.showPlotTitle ? (exportConfig.plotTitleSize || 96) * drawScale + 40 * drawScale : 0;
      const offscreen = document.createElement('canvas');
      offscreen.width = plotW + legendW + 40 * drawScale; offscreen.height = plotH + titleH + 40 * drawScale;
      const ctx = offscreen.getContext('2d'); if (!ctx) return '';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      if (exportConfig.showPlotTitle) { ctx.font = `bold ${(exportConfig.plotTitleSize || 96) * drawScale}px Inter, sans-serif`; ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(exportConfig.plotTitle || 'Spectral Moments', plotW / 2, titleH / 2); }
      ctx.save(); ctx.translate(0, titleH); renderPlot(ctx, plotW, plotH, 1, drawScale, exportConfig); ctx.restore();
      if (hasLegend) {
        ctx.save(); ctx.translate(plotW + 40 * drawScale, titleH + 40 * drawScale);
        const itemS = (exportConfig.legendItemSize || 24) * drawScale; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        legendEntries.forEach((it, i) => { const y = (i + 0.5) * itemS * 1.7; ctx.fillStyle = it.color; ctx.fillRect(0, y - itemS / 2, itemS, itemS); ctx.fillStyle = '#334155'; ctx.font = `${itemS}px Inter, sans-serif`; ctx.fillText(it.label, itemS * 1.4, y); });
        ctx.restore();
      }
      return offscreen.toDataURL('image/png');
    };
    return {
      exportImage: () => {
        const url = generateImage({ scale: 3, xAxisLabelSize: 96, yAxisLabelSize: 96, tickLabelSize: 64, dataLabelSize: 64, showLegend: true, legendTitleSize: 96, legendItemSize: 40, legendPosition: 'right', showColorLegend: true, colorLegendTitle: 'COLOUR', showShapeLegend: false, shapeLegendTitle: '', showTextureLegend: false, textureLegendTitle: '', showLineTypeLegend: false, lineTypeLegendTitle: '' });
        if (url) { const a = document.createElement('a'); a.download = 'spectral_moments.png'; a.href = url; a.click(); }
      },
      generateImage,
    };
  });

  // Wheel zoom (non-passive)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const factor = e.deltaY > 0 ? 0.92 : 1.08; setTransform(t => { const ns = Math.max(0.2, Math.min(20, t.scale * factor)); const r = ns / t.scale; return { x: mx - r * (mx - t.x), y: my - r * (my - t.y), scale: ns }; }); };
    canvas.addEventListener('wheel', onWheel, { passive: false }); return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Canvas sizing + render
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !containerRef.current) return;
    canvas.style.width = ''; canvas.style.height = '';
    const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.save(); ctx.scale(dpr, dpr); ctx.translate(transform.x, transform.y); ctx.scale(transform.scale, transform.scale);
    renderPlot(ctx, rect.width, rect.height, 1, 1); ctx.restore();
  }, [renderPlot, transform]);

  const handleMouseDown = (e: React.MouseEvent) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
  const handleMouseUp = () => { isDragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (container) { const cr = container.getBoundingClientRect(); setMousePos({ x: e.clientX - cr.left, y: e.clientY - cr.top }); }
    if (isDragging.current) { const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y; lastMouse.current = { x: e.clientX, y: e.clientY }; setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy })); setHovered(null); return; }
    if (activeConfig.spectralMode !== 'scatter') { if (hovered) setHovered(null); return; }
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - transform.x) / transform.scale, my = (e.clientY - rect.top - transform.y) / transform.scale;
    let best: typeof scatterHits.current[number] | null = null; let bestD = 12 / transform.scale;
    for (const h of scatterHits.current) { const d = Math.hypot(h.x - mx, h.y - my); if (d < bestD) { bestD = d; best = h; } }
    if (best) setHovered({ lines: tooltipLines(best.token, best.layer, best.extra) }); else if (hovered) setHovered(null);
  };
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  const dashArray = (name: number[]) => name.length ? name.join(',') : undefined;

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={() => { handleMouseUp(); setHovered(null); }} onMouseMove={handleMouseMove} />
      {legendLayers.length > 0 && (
        <div className="absolute right-4 top-4 max-h-[85%] overflow-y-auto w-64 z-40">
          <div className="flex flex-col">
            {legendLayers.map(({ layer, enc, isTraj }) => (
              <div key={layer.id} className="flex flex-col space-y-3 mb-4">
                {showTitles && <h3 className="text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 pb-1 mb-2">{layer.name}</h3>}

                {enc.colorKey && (
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center border-b border-slate-100 pb-1 mb-1">
                      <span>{enc.colorKey}</span>
                    </h4>
                    {Object.keys(enc.colorMap).sort().map(k => (
                      <div key={k} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => onLegendClick?.(k, { color: enc.colorMap[k], shape: enc.shapeKey === enc.colorKey ? (enc.shapeMap[k] || 'circle') : 'circle', texture: 0, lineType: enc.lineTypeNameMap[k] || 'solid' }, e, layer.id)}>
                        <div className="flex items-center space-x-2">
                          {isTraj ? (
                            <svg width="24" height="4" className="shrink-0">
                              <line x1="0" y1="2" x2="24" y2="2" stroke={enc.colorMap[k]} strokeWidth="2"
                                strokeDasharray={enc.lineTypeKey === enc.colorKey ? dashArray(enc.lineTypePatternMap[k] || []) : undefined} />
                            </svg>
                          ) : enc.shapeKey === enc.colorKey ? (
                            <ShapeIcon shape={enc.shapeMap[k] || 'circle'} color={enc.colorMap[k]} />
                          ) : enc.lineTypeKey === enc.colorKey ? (
                            <svg width="24" height="4" className="shrink-0">
                              <line x1="0" y1="2" x2="24" y2="2" stroke={enc.colorMap[k]} strokeWidth="2" strokeDasharray={dashArray(enc.lineTypePatternMap[k] || [])} />
                            </svg>
                          ) : (
                            <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: enc.colorMap[k] }}></div>
                          )}
                          <span className="text-slate-700 font-medium truncate w-24">{k}</span>
                        </div>
                        <span className="text-slate-400 font-mono">({enc.colorCounts[k] || 0})</span>
                      </div>
                    ))}
                  </div>
                )}

                {!isTraj && enc.shapeKey && enc.shapeKey !== enc.colorKey && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                      <span>{enc.shapeKey}</span>
                    </h4>
                    {Object.keys(enc.shapeMap).sort().map(k => (
                      <div key={k} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => onLegendClick?.(k, { color: '#64748b', shape: enc.shapeMap[k] || 'circle', texture: 0, lineType: 'solid' }, e, layer.id)}>
                        <div className="flex items-center space-x-2">
                          <ShapeIcon shape={enc.shapeMap[k] || 'circle'} color="#64748b" />
                          <span className="text-slate-700 font-medium truncate w-24">{k}</span>
                        </div>
                        <span className="text-slate-400 font-mono">({enc.shapeCounts[k] || 0})</span>
                      </div>
                    ))}
                  </div>
                )}

                {enc.lineTypeKey && enc.lineTypeKey !== enc.colorKey && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                      <span>{enc.lineTypeKey}</span>
                    </h4>
                    {Object.keys(enc.lineTypePatternMap).sort().map(k => (
                      <div key={k} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => onLegendClick?.(k, { color: '#64748b', shape: 'circle', texture: 0, lineType: enc.lineTypeNameMap[k] || 'solid' }, e, layer.id)}>
                        <div className="flex items-center space-x-2">
                          <svg width="24" height="4" className="shrink-0">
                            <line x1="0" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="2" strokeDasharray={dashArray(enc.lineTypePatternMap[k] || [])} />
                          </svg>
                          <span className="text-slate-700 font-medium truncate w-24">{k}</span>
                        </div>
                        <span className="text-slate-400 font-mono">({enc.lineTypeCounts[k] || 0})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {(transform.scale !== 1 || transform.x !== 0 || transform.y !== 0) && (
        <button onClick={resetView} className="absolute bottom-2 left-2 px-2 py-1 text-[10px] font-semibold bg-white/90 border border-slate-200 rounded shadow-sm hover:bg-slate-50">Reset view</button>
      )}
      {hovered && (
        <div className="absolute pointer-events-none z-10 bg-slate-800 text-white text-[11px] rounded px-2 py-1 shadow-lg" style={{ left: mousePos.x + 12, top: mousePos.y + 12, maxWidth: 260 }}>
          {hovered.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</div>)}
        </div>
      )}
    </div>
  );
});

function prettyField(f: string): string {
  if (f === 'file_id') return 'File';
  if (f === 'duration') return 'Duration';
  if (f === 'speaker') return 'Speaker';
  return f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

SpectralMomentsPlot.displayName = 'SpectralMomentsPlot';
export default SpectralMomentsPlot;
