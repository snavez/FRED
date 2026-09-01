import React, { useRef, useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, ExportConfig, DatasetMeta, Layer } from '../types';
import { getLabel } from '../utils/getLabel';
import { fitRange, quantile } from '../utils/plotRange';
import { durationFieldForRegion, getTokenDurationInUnit } from '../utils/duration';
import { axisTicks, formatMeasureValue } from '../utils/axisTicks';
import {
  drawShape, ShapeIcon, hexToRgb, computeEncodingMaps, EncodingMaps,
} from '../utils/plotEncoding';
import { generateTexture } from '../utils/textureGenerator';
import { computeExportPlotSize } from '../utils/exportLayout';
import {
  discoverSpectralColumns, spectralAxisLabel, getSpectralMeasureDef,
  SpectralMeasureKey, SpectralMeta, SpectralFeature,
  getSpectralFeatureValue, spectralFeatureAxisLabel,
  spectralFeatureLabel, getSpectralCoeffValue, coefficientLabel,
  spectralFeatureAt, spectralIndicesOfKind, spectralMeasuresOfKind, resolveSpectralAxes,
  resolveSpectralMeasure, resolveSpectralContour, spectralContourSteps, hasSpectralFeature,
  isCentredAtZero,
} from '../utils/spectralMoments';

interface SpectralMomentsPlotProps {
  layers: Layer[];
  layerData: Record<string, SpeechToken[]>;
  activeLayerId: string;
  datasetMeta: DatasetMeta | null;
  onLegendClick?: (category: string, currentStyles: { color: string, shape: string, texture: number, lineType: string }, event: React.MouseEvent, layerId?: string) => void;
  /** Reports the axis range actually drawn, so the range inputs can show real numbers. */
  onAutoRange?: (range: { x: [number, number], y: [number, number] }) => void;
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

/** Ticks for a value axis, already positioned and labelled for `drawFrame`. */
const valueTicks = (
  lo: number, hi: number, mapPos: (v: number) => number, limit = 99,
): { pos: number, label: string }[] => {
  const ticks = axisTicks(lo, hi, 6);
  return ticks.values.slice(0, limit).map((v, i) => ({ pos: mapPos(v), label: ticks.labels[i] }));
};

/** Where 0 sits on an axis, when the measure has a meaningful zero and the axis shows it. */
const zeroPos = (
  measure: SpectralMeasureKey, lo: number, hi: number, mapPos: (v: number) => number,
): number | undefined =>
  isCentredAtZero(measure) && lo <= 0 && hi >= 0 ? mapPos(0) : undefined;

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

/** A coloured/shaped group of tokens sharing colour (and optionally shape or line-type). */
interface EncGroup { key: string; tokens: SpeechToken[]; color: string; shape: string; dash: number[]; texture: number; label: string; }

/** Group tokens by colour (and a secondary shape/line-type channel), mirroring F1/F2 grouping. */
const buildGroups = (data: SpeechToken[], enc: EncodingMaps, secondary: 'shape' | 'lineType' | 'texture' | null, defaultColor: string, meanLabelType: string): EncGroup[] => {
  const secKey = secondary === 'shape' ? enc.shapeKey : secondary === 'lineType' ? enc.lineTypeKey : secondary === 'texture' ? enc.textureKey : null;
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
    const texture = (secondary === 'texture' && secKey) ? (enc.textureMap[g.sVal] ?? 0)
      : (enc.textureKey && enc.textureKey === enc.colorKey ? (enc.textureMap[g.cVal] ?? 0) : 0);
    let label = key === '__all__' ? '' : key.replace('|', ' ');
    if (key.includes('|')) label = meanLabelType === 'color' ? g.cVal : meanLabelType === 'shape' ? g.sVal : `${g.cVal} ${g.sVal}`;
    return { key, tokens: g.tokens, color, shape, dash, texture, label };
  });
};

const SpectralMomentsPlot = forwardRef<PlotHandle, SpectralMomentsPlotProps>(({ layers, layerData, activeLayerId, datasetMeta, onLegendClick, onAutoRange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ lines: string[] } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const scatterHits = useRef<{ token: SpeechToken, layer: Layer, x: number, y: number, extra: string[] }[]>([]);
  const lastReportedRange = useRef<{ x: [number, number], y: [number, number] } | null>(null);

  const bgLayer = layers[0];
  const bgConfig = bgLayer.config;
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);
  const activeConfig = activeLayer.config;
  const activeData = useMemo(() => layerData[activeLayerId] || [], [layerData, activeLayerId]);

  const allTokens = useMemo(() => Object.values(layerData).flat(), [layerData]);
  const sm = useMemo<SpectralMeta>(() => discoverSpectralColumns(allTokens, datasetMeta), [allTokens, datasetMeta]);

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
  /**
   * Axes, gridlines and labels. `zero` marks where a signed measure's zero falls: the
   * band ratio's 0 dB is equal energy in both bands, so which side of it a token sits
   * on is the reading, and the line has to be visible without being mistaken for a
   * gridline.
   */
  const drawFrame = (ctx: CanvasRenderingContext2D, area: { x: number, y: number, w: number, h: number }, xTicks: { pos: number, label: string }[], yTicks: { pos: number, label: string }[], xLabel: string, yLabel: string, s: number, zero?: { x?: number, y?: number }, exportConfig?: ExportConfig) => {
    const xTickSize = exportConfig ? (exportConfig.xTickLabelSize ?? exportConfig.tickLabelSize) : 11;
    const yTickSize = exportConfig ? (exportConfig.yTickLabelSize ?? exportConfig.tickLabelSize) : 11;
    const xLabelSize = exportConfig ? exportConfig.xAxisLabelSize : 13;
    const yLabelSize = exportConfig ? exportConfig.yAxisLabelSize : 13;
    const xTickX = (exportConfig?.xAxisTickX ?? 0) * s;
    const xTickY = (exportConfig?.xAxisTickY ?? 0) * s;
    const yTickX = (exportConfig?.yAxisTickX ?? 0) * s;
    const yTickY = (exportConfig?.yAxisTickY ?? 0) * s;
    const xLabelX = (exportConfig?.xAxisLabelX ?? 0) * s;
    const xLabelY = (exportConfig?.xAxisLabelY ?? 0) * s;
    const yLabelX = (exportConfig?.yAxisLabelX ?? 0) * s;
    const yLabelY = (exportConfig?.yAxisLabelY ?? 0) * s;
    ctx.lineWidth = 1 * s; ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = `${yTickSize * s}px Inter, sans-serif`;
    yTicks.forEach(t => { ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(area.x, t.pos); ctx.lineTo(area.x + area.w, t.pos); ctx.stroke(); ctx.fillText(t.label, area.x - 6 * s + yTickX, t.pos + yTickY); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = `${xTickSize * s}px Inter, sans-serif`;
    xTicks.forEach(t => { ctx.strokeStyle = '#f1f5f9'; ctx.beginPath(); ctx.moveTo(t.pos, area.y); ctx.lineTo(t.pos, area.y + area.h); ctx.stroke(); ctx.fillText(t.label, t.pos + xTickX, area.y + area.h + 6 * s + xTickY); });
    if (zero?.y !== undefined) {
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([5 * s, 4 * s]);
      ctx.beginPath(); ctx.moveTo(area.x, zero.y); ctx.lineTo(area.x + area.w, zero.y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (zero?.x !== undefined) {
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([5 * s, 4 * s]);
      ctx.beginPath(); ctx.moveTo(zero.x, area.y); ctx.lineTo(zero.x, area.y + area.h); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5 * s; ctx.strokeRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = '#334155'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${xLabelSize * s}px Inter, sans-serif`;
    ctx.fillText(xLabel, area.x + area.w / 2 + xLabelX, area.y + area.h + 42 * s + xLabelY);
    ctx.save(); ctx.translate(area.x - 52 * s + yLabelX, area.y + area.h / 2 + yLabelY); ctx.rotate(-Math.PI / 2); ctx.font = `600 ${yLabelSize * s}px Inter, sans-serif`; ctx.fillText(yLabel, 0, 0); ctx.restore();
  };
  const drawEmpty = (ctx: CanvasRenderingContext2D, w: number, h: number, msg: string, s: number) => {
    ctx.fillStyle = '#94a3b8'; ctx.font = `${14 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(msg, w / 2, h / 2);
  };

  // ─── Legend (per visible layer, colour/shape/line-type sections) ──
  // Declared before the renderer because the plot frame reserves a gutter for it.
  const legendLayers = useMemo(() => {
    const view = activeConfig.spectralMode;
    const src = view === 'scatter' ? layers.filter(l => l.visible) : [activeLayer];
    return src.map(layer => {
      const raw = computeEncodingMaps(layerData[layer.id] || [], layer.config, layer.styleOverrides);
      const enc: EncodingMaps = { ...raw,
        shapeKey: view === 'scatter' ? raw.shapeKey : null,
        lineTypeKey: view === 'box' ? null : raw.lineTypeKey,
        textureKey: view === 'box' ? raw.textureKey : null,
      };
      return { layer, enc, isTraj: view === 'scatter' && layer.config.plotType === 'trajectory' };
    }).filter(x => x.enc.colorKey || x.enc.shapeKey || x.enc.lineTypeKey || x.enc.textureKey);
  }, [layers, layerData, activeConfig.spectralMode, activeLayer]);
  const showTitles = legendLayers.length > 1;

  // ─── Main render ──────────────────────────────────────────────────
  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, _mode: number, s: number, exportConfig?: ExportConfig) => {
    const capture = s === 1 && !exportConfig;
    if (capture) scatterHits.current = [];
    if (!sm.available) { drawEmpty(ctx, width, height, 'No spectral columns (COG / SD / skew / kurt / band ratio, tracks or coefficients) found in this dataset.', s); return; }

    // Reserve room for the on-screen legend so the frame sits entirely to its left —
    // the border never cuts through the key, and no data hides behind it. Export draws
    // its own legend beside the plot, so it keeps the plain margin.
    const legendGutter = (!exportConfig && legendLayers.length > 0) ? 288 : 24;
    const exportXTickSize = exportConfig ? (exportConfig.xTickLabelSize ?? exportConfig.tickLabelSize) : 11;
    const exportYTickSize = exportConfig ? (exportConfig.yTickLabelSize ?? exportConfig.tickLabelSize) : 11;
    const margin = exportConfig
      ? { top: 24 * s, right: legendGutter * s,
          bottom: Math.max(64, exportXTickSize * 1.4 + exportConfig.xAxisLabelSize * 1.5 + 42) * s,
          left: Math.max(82, exportYTickSize * 2.5 + exportConfig.yAxisLabelSize * 1.5 + 52) * s }
      : { top: 24 * s, right: legendGutter * s, bottom: 64 * s, left: 82 * s };
    const area = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
    if (area.w <= 0 || area.h <= 0) return;
    const rangeOr = (cfg: [number, number], lo: number, hi: number): [number, number] => (cfg[0] === 0 && cfg[1] === 0) ? [lo, hi] : cfg;
    const view = activeConfig.spectralMode;
    // Report the range actually drawn (only for the live canvas, not export renders) so
    // the Min/Max inputs can show real numbers instead of a placeholder 0.
    const reportRange = (x: [number, number], y: [number, number]) => {
      if (exportConfig || s !== 1) return;
      const r = { x, y };
      const prev = lastReportedRange.current;
      if (prev && prev.x[0] === x[0] && prev.x[1] === x[1] && prev.y[0] === y[0] && prev.y[1] === y[1]) return;
      lastReportedRange.current = r;
      onAutoRange?.(r);
    };

    // ═══ SCATTER (multi-layer, feature × feature) ═══
    if (view === 'scatter') {
      const { x: xF, y: yF } = resolveSpectralAxes(bgConfig.spectralXFeature, bgConfig.spectralYFeature, sm);
      if (!xF || !yF) { drawEmpty(ctx, width, height, 'No spectral measurements available for the axes.', s); return; }
      const visible = layers.filter(l => l.visible);

      // A trajectory sweeps the axis features' measures along whichever grid the axes
      // sit on — the track when they are track samples, else the %-timepoints. Both
      // axes always share a kind, so one grid serves both. Coefficients have no time
      // axis, so a coefficient axis falls back to plotting points.
      const onTrack = xF.kind === 'track';
      const sweepable = xF.kind !== 'coeff' && yF.kind !== 'coeff';
      const sweepAt = (t: SpeechToken, i: number) => ({
        x: getSpectralFeatureValue(t, sm, spectralFeatureAt(xF, i)),
        y: getSpectralFeatureValue(t, sm, spectralFeatureAt(yF, i)),
      });
      // Both axes share a kind, so one grid serves both; the X axis names the region.
      const fullGrid = spectralIndicesOfKind(sm, xF.kind, xF.region);
      // Range trims the sweep; [0,0] means the whole grid.
      const [rFrom, rTo] = bgConfig.spectralTrajRange || [0, 0];
      const sweepSteps = (rFrom === 0 && rTo === 0)
        ? fullGrid
        : fullGrid.filter(i => i >= Math.min(rFrom, rTo) && i <= Math.max(rFrom, rTo));
      const stepLabel = (i: number) => onTrack ? `t${i}` : `${i}%`;
      const isSweeping = (cfg: PlotConfig) => cfg.plotType === 'trajectory' && sweepable && sweepSteps.length >= 2;
      const pointXY = (t: SpeechToken) => ({ x: getSpectralFeatureValue(t, sm, xF), y: getSpectralFeatureValue(t, sm, yF) });

      const xs: number[] = [], ys: number[] = [];
      visible.forEach(layer => {
        const data = layerData[layer.id] || [];
        data.forEach(t => {
          const pts = isSweeping(layer.config) ? sweepSteps.map(i => sweepAt(t, i)) : [pointXY(t)];
          pts.forEach(p => { if (!isNaN(p.x) && !isNaN(p.y)) { xs.push(p.x); ys.push(p.y); } });
        });
      });
      if (xs.length === 0) { drawEmpty(ctx, width, height, 'No valid values for the selected axes. Adjust the axis measurements or layer filters.', s); return; }
      const pad = (arr: number[]): [number, number] => { const lo = Math.min(...arr), hi = Math.max(...arr), d = (hi - lo) * 0.06 || 1; return [lo - d, hi + d]; };
      const [xLo, xHi] = rangeOr(bgConfig.spectralXRange, ...pad(xs));
      const [yLo, yHi] = rangeOr(bgConfig.spectralYRange, ...pad(ys));
      reportRange([xLo, xHi], [yLo, yHi]);
      const mapX = (v: number) => area.x + ((v - xLo) / (xHi - xLo)) * area.w;
      const mapY = (v: number) => area.y + area.h - ((v - yLo) / (yHi - yLo)) * area.h;

      drawFrame(ctx, area,
        valueTicks(xLo, xHi, mapX), valueTicks(yLo, yHi, mapY),
        spectralFeatureAxisLabel(xF, sm.bandRatio), spectralFeatureAxisLabel(yF, sm.bandRatio), s,
        { x: zeroPos(xF.measure, xLo, xHi, mapX), y: zeroPos(yF.measure, yLo, yHi, mapY) }, exportConfig);

      ctx.save();
      ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
      visible.forEach(layer => {
        const cfg = layer.config;
        const data = layerData[layer.id] || [];
        const enc = computeEncodingMaps(data, cfg, layer.styleOverrides);
        const dc = defaultColor(cfg);
        const colorOf = (t: SpeechToken) => enc.colorKey ? (enc.colorMap[getLabel(t, enc.colorKey)] || dc) : dc;

        if (isSweeping(cfg)) {
          const xy = (t: SpeechToken, i: number) => sweepAt(t, i);
          // Individual token paths (opacity 0 = hidden)
          if ((cfg.trajectoryLineOpacity ?? 0.5) > 0) {
            data.forEach(t => {
              const path = sweepSteps.map(tp => ({ tp, ...xy(t, tp) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
              if (path.length < 2) return;
              ctx.beginPath();
              path.forEach((p, i) => { const px = mapX(p.x), py = mapY(p.y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
              ctx.setLineDash(enc.lineTypeKey ? (enc.lineTypePatternMap[getLabel(t, enc.lineTypeKey)] || []).map(d => d * s) : []);
              ctx.globalAlpha = cfg.trajectoryLineOpacity ?? 0.5;
              ctx.strokeStyle = colorOf(t); ctx.lineWidth = (cfg.trajectoryLineWidth || 1) * s; ctx.stroke();
              ctx.globalAlpha = 1; ctx.setLineDash([]);
              if (capture) path.forEach(p => scatterHits.current.push({ token: t, layer, x: mapX(p.x), y: mapY(p.y), extra: [`${getSpectralMeasureDef(xF.measure).short} ${stepLabel(p.tp)}: ${p.x.toFixed(1)}`, `${getSpectralMeasureDef(yF.measure).short} ${stepLabel(p.tp)}: ${p.y.toFixed(1)}`] }));
            });
          }
          // Mean trajectory per group
          if (cfg.showMeanTrajectories) {
            buildGroups(data, enc, 'lineType', dc, cfg.meanLabelType).forEach(g => {
              const mpath = sweepSteps.map(tp => {
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
                // Clear the arrowhead and end point, which both extend past the last vertex.
                const gap = (10 + (arrow > 0 ? arrow + 4 : 0) + ptSize) * s;
                ctx.font = `bold ${size * s}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'white'; ctx.lineWidth = 3 * s; ctx.lineJoin = 'round';
                ctx.strokeText(g.label, mapX(last.x) + gap, mapY(last.y)); ctx.fillStyle = g.color; ctx.fillText(g.label, mapX(last.x) + gap, mapY(last.y));
              }
              if (capture) mpath.forEach(p => scatterHits.current.push({ token: g.tokens[0], layer, x: mapX(p.x), y: mapY(p.y), extra: [`${g.label || layer.name} (mean, n=${g.tokens.length})`, `${getSpectralMeasureDef(xF.measure).short} ${stepLabel(p.tp)}: ${p.x.toFixed(1)}`, `${getSpectralMeasureDef(yF.measure).short} ${stepLabel(p.tp)}: ${p.y.toFixed(1)}`] }));
            });
          }
        } else {
          // ── Point layer ──
          const valid = (t: SpeechToken) => { const { x, y } = pointXY(t); return isNaN(x) || isNaN(y) ? null : { x, y }; };
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
              if (capture) scatterHits.current.push({ token: t, layer, x: px, y: py, extra: [`${spectralFeatureLabel(xF)}: ${p.x.toFixed(1)}`, `${spectralFeatureLabel(yF)}: ${p.y.toFixed(1)}`] });
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
      ctx.restore();
      return;
    }

    // ═══ SUMMARY MODES (active layer) ═══
    const data = activeData;
    const cfg = activeConfig;
    if (data.length === 0) { drawEmpty(ctx, width, height, 'No data in the active layer.', s); return; }
    // Box and density plot one scalar feature; the sign flip exists because a rising
    // contour has a negative k1, which reads backwards on a chart.
    const feature = resolveSpectralMeasure(cfg.spectralFeature, bgConfig.spectralXFeature, sm);
    const flip = cfg.spectralFlipSign && feature?.kind === 'coeff';
    const featureValue = (t: SpeechToken) => {
      if (!feature) return NaN;
      const v = getSpectralFeatureValue(t, sm, feature);
      return flip ? -v : v;
    };
    const enc = computeEncodingMaps(data, cfg, activeLayer.styleOverrides);
    const dc = defaultColor(cfg);
    const secondary: 'lineType' | 'texture' | null = view === 'box' ? 'texture' : (view === 'timeline' || view === 'density') ? 'lineType' : null;
    const grouped = buildGroups(data, enc, secondary, dc, view === 'box' ? 'both' : cfg.meanLabelType);
    const keys = grouped.map(g => g.key);
    const groupForKey: Record<string, EncGroup> = {};
    grouped.forEach(g => { groupForKey[g.key] = g; });
    const colorForKey = (k: string) => groupForKey[k]?.color || dc;
    const dashForKey = (k: string) => groupForKey[k]?.dash || [];
    const textureForKey = (k: string) => groupForKey[k]?.texture ?? 0;
    const labelForKey = (k: string) => groupForKey[k]?.label || (k === '__all__' ? 'All' : k);
    const groups: Record<string, SpeechToken[]> = {};
    grouped.forEach(g => { groups[g.key] = g.tokens; });
    const secondaryKey = secondary === 'texture' ? enc.textureKey : secondary === 'lineType' ? enc.lineTypeKey : null;
    const groupAxisLabel = Array.from(new Set([enc.colorKey, secondaryKey].filter((k): k is string => !!k))).join(' × ') || 'Group';

    if (view === 'box') {
      if (!feature) { drawEmpty(ctx, width, height, 'No spectral measurements available.', s); return; }

      /** Draw one box/violin panel for a given value accessor into an arbitrary rect. */
      const drawBoxPanel = (
        panel: { x: number, y: number, w: number, h: number },
        valueOf: (t: SpeechToken) => number,
        yLabel: string,
        panelMeasure: SpectralMeasureKey,
        useConfigRange: boolean,
        compact: boolean,
      ) => {
        const stats = keys.map(k => ({ key: k, stats: calcStats((groups[k] || []).map(valueOf)) }))
          .filter(g => g.stats) as { key: string, stats: MomentStats }[];
        if (stats.length === 0) return false;
        // The boxes and their whiskers always fit; points beyond them (outliers, raw
        // points) only widen the range to their trimmed quantiles, so one wild token
        // cannot flatten every box into a line.
        const must: number[] = [], tail: number[] = [];
        stats.forEach(g => {
          const w = whiskers(g.stats);
          must.push(w.low, w.high, g.stats.mean);
          if (cfg.showOutliers !== false || cfg.boxShowPoints) tail.push(...g.stats.values);
        });
        const [fitLo, fitHi] = fitRange(must, tail);
        const [yLo, yHi] = useConfigRange ? rangeOr(cfg.spectralYRange, fitLo, fitHi) : [fitLo, fitHi];
        if (useConfigRange) reportRange([0, 0], [yLo, yHi]);
        const mapY = (v: number) => panel.y + panel.h - ((v - yLo) / (yHi - yLo)) * panel.h;
        const slotW = panel.w / stats.length;
        const boxW = cfg.boxWidth > 0 ? Math.min(cfg.boxWidth * s, slotW * 0.9) : Math.min(60 * s, slotW * 0.6);
        drawFrame(ctx, panel,
          stats.map((g, i) => ({ pos: panel.x + (i + 0.5) * slotW, label: labelForKey(g.key) })),
          valueTicks(yLo, yHi, mapY, compact ? 4 : 99),
          compact ? '' : groupAxisLabel, yLabel, s,
          { y: zeroPos(panelMeasure, yLo, yHi, mapY) }, exportConfig);
        ctx.save();
        ctx.beginPath(); ctx.rect(panel.x, panel.y, panel.w, panel.h); ctx.clip();
        drawBoxes(stats, panel, mapY, slotW, boxW);
        ctx.restore();
        if (!compact) stats.forEach((g, i) => {
          ctx.fillStyle = '#94a3b8'; ctx.font = `${10 * s}px Inter, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(`n=${g.stats.count}`, panel.x + (i + 0.5) * slotW, panel.y + panel.h + 22 * s);
        });
        return true;
      };

      // "All coefficients" small multiples: one panel per coefficient, each on its own
      // scale — k0 runs to ~19000 while k1 is ~±1500, so a shared axis would flatten them.
      const coeffRegion = feature.kind === 'coeff' ? (feature.region ?? '') : (sm.regions[0] ?? '');
      const coeffMoments = spectralMeasuresOfKind(sm, 'coeff', coeffRegion);
      const coeffIndices = spectralIndicesOfKind(sm, 'coeff', coeffRegion);
      if (cfg.spectralCoeffFacets && coeffMoments.length > 0 && coeffIndices.length > 1) {
        const measure = feature.kind === 'coeff' ? feature.measure : coeffMoments[0].key;
        const panels = coeffIndices.filter(i =>
          hasSpectralFeature(sm, { measure, kind: 'coeff', index: i, region: coeffRegion }));
        if (panels.length === 0) { drawEmpty(ctx, width, height, 'No coefficients available.', s); return; }
        const cols = Math.min(panels.length, 2);
        const rows = Math.ceil(panels.length / cols);
        const gapX = 76 * s, gapY = 62 * s;
        const pw = (area.w - gapX * (cols - 1)) / cols, ph = (area.h - gapY * (rows - 1)) / rows;
        panels.forEach((k, idx) => {
          const cx = idx % cols, cy = Math.floor(idx / cols);
          drawBoxPanel(
            { x: area.x + cx * (pw + gapX), y: area.y + cy * (ph + gapY), w: pw, h: ph },
            t => { const v = getSpectralCoeffValue(t, sm, measure, k, coeffRegion); return flip ? -v : v; },
            `${getSpectralMeasureDef(measure).short} ${coefficientLabel(k)}`,
            measure, false, true,
          );
        });
        return;
      }

      const ok = drawBoxPanel(area, featureValue, spectralFeatureAxisLabel(feature, sm.bandRatio, flip), feature.measure, true, false);
      if (!ok) { drawEmpty(ctx, width, height, 'No valid values for the selected measurement.', s); return; }
      return;
    }

    /** Where the whiskers reach: 1.5x IQR inside the data, or the full extent. */
    function whiskers(st: MomentStats): { low: number, high: number } {
      if ((cfg.boxWhiskerMode || 'iqr') === 'minmax') return { low: st.min, high: st.max };
      const iqr = st.q3 - st.q1;
      return {
        low: st.values.find(v => v >= st.q1 - 1.5 * iqr) ?? st.min,
        high: [...st.values].reverse().find(v => v <= st.q3 + 1.5 * iqr) ?? st.max,
      };
    }

    /** Shared box/violin geometry, used by the single plot and by each facet. */
    function drawBoxes(
      stats: { key: string, stats: MomentStats }[],
      panel: { x: number, y: number, w: number, h: number },
      mapY: (v: number) => number,
      slotW: number, boxW: number,
    ) {
      stats.forEach((g, i) => {
        const cx = panel.x + (i + 0.5) * slotW, color = colorForKey(g.key), st = g.stats;
        const fillStyle: string | CanvasPattern = enc.textureKey
          ? generateTexture(ctx, textureForKey(g.key), color, '#ffffff') : `rgba(${hexToRgb(color)},0.35)`;
        if (cfg.spectralViolin) {
          const grid: number[] = []; const gN = 48; for (let k = 0; k <= gN; k++) grid.push(st.min + (st.max - st.min) * (k / gN));
          const dens = kde(st.values, grid), dMax = Math.max(...dens) || 1;
          ctx.beginPath();
          grid.forEach((v, k) => { const w = (dens[k] / dMax) * boxW / 2, yy = mapY(v); if (k === 0) ctx.moveTo(cx - w, yy); else ctx.lineTo(cx - w, yy); });
          for (let k = grid.length - 1; k >= 0; k--) ctx.lineTo(cx + (dens[k] / dMax) * boxW / 2, mapY(grid[k]));
          ctx.closePath(); ctx.fillStyle = fillStyle; ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s; ctx.stroke();
        } else {
          const { low: wLow, high: wHigh } = whiskers(st);
          ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s;
          ctx.beginPath(); ctx.moveTo(cx, mapY(wHigh)); ctx.lineTo(cx, mapY(st.q3)); ctx.moveTo(cx, mapY(st.q1)); ctx.lineTo(cx, mapY(wLow));
          ctx.moveTo(cx - boxW / 4, mapY(wHigh)); ctx.lineTo(cx + boxW / 4, mapY(wHigh)); ctx.moveTo(cx - boxW / 4, mapY(wLow)); ctx.lineTo(cx + boxW / 4, mapY(wLow)); ctx.stroke();
          if (cfg.showQuartiles !== false) {
            ctx.fillStyle = fillStyle; ctx.fillRect(cx - boxW / 2, mapY(st.q3), boxW, mapY(st.q1) - mapY(st.q3));
            ctx.strokeRect(cx - boxW / 2, mapY(st.q3), boxW, mapY(st.q1) - mapY(st.q3));
          }
          const centre = (cfg.boxCenterLine || 'median') === 'mean' ? st.mean : st.median;
          ctx.beginPath(); ctx.moveTo(cx - boxW / 2, mapY(centre)); ctx.lineTo(cx + boxW / 2, mapY(centre)); ctx.lineWidth = 2.5 * s; ctx.stroke();
          if (cfg.showCenterValueLabels) {
            ctx.font = `600 ${10 * s}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#0f172a';
            ctx.fillText(formatMeasureValue(centre), cx + boxW / 2 + 4 * s, mapY(centre) - 2 * s);
          }
          if (cfg.showOutliers !== false) {
            st.values.forEach(v => { if (v < wLow || v > wHigh) { ctx.beginPath(); ctx.arc(cx, mapY(v), 2 * s, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); } });
          }
        }
        // Raw points, jittered across the slot so overlapping values stay countable
        if (cfg.boxShowPoints) {
          const r = Math.max(1, (cfg.pointSize || 4) * 0.4) * s, spread = boxW * 0.8;
          ctx.globalAlpha = cfg.pointOpacity ?? 0.5; ctx.fillStyle = color;
          st.values.forEach((v, j) => {
            // Deterministic offset: a token sits in the same place on every redraw
            const jitter = (Math.abs(Math.sin(j * 12.9898) * 43758.5453) % 1) * spread - spread / 2;
            ctx.beginPath(); ctx.arc(cx + jitter, mapY(v), r, 0, Math.PI * 2); ctx.fill();
          });
          ctx.globalAlpha = 1;
        }
        // Mean marker: a white-ringed diamond, so it reads over the box and the points
        if (cfg.showMeanMarker) {
          const my = mapY(st.mean), r = Math.max(4 * s, boxW * 0.16);
          ctx.beginPath(); ctx.moveTo(cx, my - r); ctx.lineTo(cx + r, my); ctx.lineTo(cx, my + r); ctx.lineTo(cx - r, my); ctx.closePath();
          ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5 * s; ctx.stroke();
        }
        // Values past the axis are clipped rather than allowed to rescale the plot, so
        // say how many and which way — the range boxes can then be widened deliberately.
        const above = st.values.filter(v => mapY(v) < panel.y).length;
        const below = st.values.filter(v => mapY(v) > panel.y + panel.h).length;
        ctx.font = `${9 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = color;
        if (above > 0) { ctx.textBaseline = 'top'; ctx.fillText(`▲ ${above}`, cx, panel.y + 3 * s); }
        if (below > 0) { ctx.textBaseline = 'bottom'; ctx.fillText(`▼ ${below}`, cx, panel.y + panel.h - 3 * s); }
      });
    }

    if (view === 'timeline') {
      // Prefer the dense track grid; fall back to %-timepoints for datasets without one.
      // Every token shares the grid, so pointwise averaging across tokens is valid.
      const family = resolveSpectralContour(cfg.spectralTimelineMoment, bgConfig.spectralXFeature, sm);
      if (!family) { drawEmpty(ctx, width, height, 'Timeline needs ≥2 positions; this dataset has one.', s); return; }
      const { measure, region } = family;
      const onTrack = family.kind === 'track';
      const steps = spectralContourSteps(sm, family);
      const valueAt = (t: SpeechToken, i: number) =>
        getSpectralFeatureValue(t, sm, { measure, kind: family.kind, index: i, region });
      // Track samples are an index grid — label them as normalised time 0→1.
      const first = steps[0], last = steps[steps.length - 1];
      const axisLabel = onTrack ? 'Normalised time (0 → 1)' : 'Segment position';
      const tickLabel = (i: number) => onTrack ? `${((i - first) / (last - first)).toFixed(1)}` : `${i}%`;

      const rawValues: number[] = [];
      data.forEach(t => steps.forEach(i => { const v = valueAt(t, i); if (!isNaN(v)) rawValues.push(v); }));
      if (rawValues.length === 0) { drawEmpty(ctx, width, height, 'No valid values for the selected measurement.', s); return; }

      // Absolute mode places each token's samples at its own real times, so tokens no
      // longer share an x-grid. Values are resampled onto a common millisecond grid and
      // averaged only where enough tokens still reach — short tokens drop out of the
      // tail rather than dragging the mean toward themselves.
      // The contour is stretched over the duration of the *region* it measures, which is
      // rarely the token's whole duration: a release contour drawn across the segment
      // duration would misreport how long the release lasted. The column is chosen in the
      // controls, defaulting to whichever duration column names this region.
      const durationField = cfg.spectralDurationField || durationFieldForRegion(datasetMeta ?? null, region);
      const durMs = (t: SpeechToken) => getTokenDurationInUnit(t, true, durationField || undefined);
      const absolute = cfg.spectralContourAbsolute && data.some(t => durMs(t) > 0);
      // Only tokens that carry this contour set the time axis, and the longest few do not
      // get to leave the rest in the first tenth of the plot: the axis reaches the 98th
      // percentile, and anything past it is clipped like any other out-of-range point.
      const drawnDurations = absolute
        ? data.filter(t => steps.some(i => !isNaN(valueAt(t, i)))).map(durMs).filter(d => d > 0).sort((a, b) => a - b)
        : [];
      const maxDur = drawnDurations.length ? quantile(drawnDurations, 0.98) : 0;
      const MIN_TOKENS_FOR_MEAN = 2;
      const absGrid = absolute
        ? Array.from({ length: 40 }, (_, j) => (j / 39) * maxDur)
        : [];
      /** Value of a token's contour at an absolute time, by linear interpolation. */
      const valueAtMs = (t: SpeechToken, ms: number): number => {
        const d = durMs(t);
        if (!(d > 0) || ms > d) return NaN;
        const pos = (ms / d) * (steps.length - 1);
        const lo = Math.floor(pos), hi = Math.min(steps.length - 1, lo + 1);
        const a = valueAt(t, steps[lo]), b = valueAt(t, steps[hi]);
        if (isNaN(a)) return NaN;
        if (isNaN(b) || lo === hi) return a;
        return a + (b - a) * (pos - lo);
      };

      const xValues = absolute ? absGrid : steps;
      const perGroup = keys.map(k => {
        const toks = groups[k] || [];
        const cells = xValues.map((x, j) => {
          const vals = (absolute ? toks.map(t => valueAtMs(t, x)) : toks.map(t => valueAt(t, steps[j])))
            .filter(v => !isNaN(v));
          if (vals.length < (absolute ? MIN_TOKENS_FOR_MEAN : 1)) return { mean: NaN, sd: NaN };
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
          return { mean, sd };
        });
        return { key: k, cells, n: toks.length };
      });
      // The mean contours are what this plot exists to show, so they always fit; the band
      // too when drawn. The individual lines are a long-tailed cloud around them and only
      // widen the range to their trimmed quantiles — otherwise a few extreme tokens leave
      // the means as a flat line along the bottom.
      const must: number[] = [];
      perGroup.forEach(g => g.cells.forEach(c => {
        if (isNaN(c.mean)) return;
        must.push(c.mean);
        if (cfg.spectralShowBand && !isNaN(c.sd)) { must.push(c.mean - c.sd); must.push(c.mean + c.sd); }
      }));
      const [fitLo, fitHi] = fitRange(must, cfg.spectralShowIndividual ? rawValues : []);
      const [vLo, vHi] = rangeOr(cfg.spectralYRange, fitLo, fitHi);
      reportRange([0, 0], [vLo, vHi]);
      const xLo = absolute ? 0 : first, xHi = absolute ? maxDur : last;
      const mapX = (x: number) => area.x + ((x - xLo) / (xHi - xLo || 1)) * area.w;
      const mapY = (v: number) => area.y + area.h - ((v - vLo) / (vHi - vLo)) * area.h;
      const xTicks = absolute
        ? axisTicks(0, maxDur, 6).values.map(t => ({ pos: mapX(t), label: `${Math.round(t)}` }))
        : steps.map(i => ({ pos: mapX(i), label: tickLabel(i) }));
      drawFrame(ctx, area, xTicks, valueTicks(vLo, vHi, mapY),
        absolute ? 'Time (ms)' : axisLabel, spectralAxisLabel(measure, undefined, region, sm.bandRatio), s,
        { y: zeroPos(measure, vLo, vHi, mapY) }, exportConfig);

      // Everything from here draws data: clip it to the frame so nothing spills outside
      // the axes when a range is trimmed or set by hand.
      ctx.save();
      ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();

      if (cfg.spectralShowIndividual) {
        const lineOpacity = cfg.trajectoryLineOpacity ?? 0.15;
        data.forEach(t => {
          const path = (absolute
            ? absGrid.map(x => ({ x, v: valueAtMs(t, x) }))
            : steps.map(i => ({ x: i, v: valueAt(t, i) }))).filter(p => !isNaN(p.v));
          if (path.length < 2) return;
          ctx.beginPath(); path.forEach((p, j) => { const x = mapX(p.x), y = mapY(p.v); if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.strokeStyle = `rgba(${hexToRgb(enc.colorKey ? (enc.colorMap[getLabel(t, enc.colorKey)] || dc) : dc)},${lineOpacity})`;
          const dash = enc.lineTypeKey ? (enc.lineTypePatternMap[getLabel(t, enc.lineTypeKey)] || []) : [];
          ctx.setLineDash(dash.map(v => v * s)); ctx.lineWidth = (cfg.trajectoryLineWidth || 1) * s; ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      // ±1 SD ribbons first, so the mean lines read on top of them.
      if (cfg.spectralShowBand) {
        perGroup.forEach(g => {
          const band = g.cells.map((c, j) => ({ ...c, x: xValues[j] })).filter(c => !isNaN(c.mean) && !isNaN(c.sd));
          if (band.length < 2) return;
          ctx.beginPath();
          band.forEach((c, j) => { const x = mapX(c.x), y = mapY(c.mean + c.sd); if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          for (let j = band.length - 1; j >= 0; j--) ctx.lineTo(mapX(band[j].x), mapY(band[j].mean - band[j].sd));
          ctx.closePath();
          ctx.fillStyle = `rgba(${hexToRgb(colorForKey(g.key))},${cfg.spectralBandOpacity ?? 0.18})`; ctx.fill();
        });
      }

      const meanWidth = (cfg.meanTrajectoryWidth || 3) * s;
      const pointSize = cfg.showMeanTrajectoryPoints === false ? 0 : (cfg.meanTrajectoryPointSize ?? 4);
      perGroup.forEach(g => {
        const color = colorForKey(g.key);
        ctx.globalAlpha = cfg.meanTrajectoryOpacity ?? 1;
        ctx.beginPath(); let started = false;
        g.cells.forEach((c, j) => { if (isNaN(c.mean)) { started = false; return; } const x = mapX(xValues[j]), y = mapY(c.mean); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
        ctx.setLineDash(dashForKey(g.key).map(v => v * s)); ctx.strokeStyle = color; ctx.lineWidth = meanWidth; ctx.stroke();
        ctx.setLineDash([]);
        // Absolute mode resamples onto a fine grid, so per-sample dots would be noise.
        if (!absolute && pointSize > 0) g.cells.forEach((c, j) => { if (isNaN(c.mean)) return; ctx.beginPath(); ctx.arc(mapX(xValues[j]), mapY(c.mean), pointSize * s, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
        ctx.globalAlpha = 1;
        // Group label at the end of its contour, halo'd so it stays readable over the cloud
        if (cfg.showTrajectoryLabels && g.key !== '__all__') {
          const last = g.cells.map((c, j) => ({ c, j })).reverse().find(({ c }) => !isNaN(c.mean));
          if (last) {
            const size = exportConfig ? exportConfig.dataLabelSize : (cfg.meanTrajectoryLabelSize || 12);
            ctx.font = `bold ${size * s}px Inter, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            const x = mapX(xValues[last.j]) - 4 * s, y = mapY(last.c.mean) - (pointSize + 3) * s;
            ctx.strokeStyle = 'white'; ctx.lineWidth = 3 * s; ctx.lineJoin = 'round';
            const label = labelForKey(g.key); ctx.strokeText(label, x, y); ctx.fillStyle = color; ctx.fillText(label, x, y);
          }
        }
      });
      ctx.restore();
      return;
    }

    // density
    {
      if (!feature) { drawEmpty(ctx, width, height, 'No spectral measurements available.', s); return; }
      // Groups with no values would otherwise draw a flat line along the axis.
      const series = keys
        .map(k => ({ key: k, values: (groups[k] || []).map(featureValue).filter(v => !isNaN(v)) }))
        .filter(c => c.values.length > 1);
      if (series.length === 0) { drawEmpty(ctx, width, height, 'No valid values for the selected measurement.', s); return; }
      // Long tails are the norm for spectral measures, so the axis fits the bulk of each
      // group (its 1st–99th percentile) rather than its single most extreme token.
      const [fitLo, fitHi] = fitRange([], series.flatMap(c => c.values), { trim: 0.01, pad: 0.05 });
      const [xLo, xHi] = rangeOr(cfg.spectralXRange, fitLo, fitHi);
      reportRange([xLo, xHi], [0, 0]);
      const grid: number[] = []; const gN = 160; for (let k = 0; k <= gN; k++) grid.push(xLo + (xHi - xLo) * (k / gN));
      const curves = series.map(c => ({ key: c.key, dens: kde(c.values, grid) }));
      const dMax = Math.max(...curves.flatMap(c => c.dens), 1e-9);
      const mapX = (v: number) => area.x + ((v - xLo) / (xHi - xLo)) * area.w;
      const mapY = (d: number) => area.y + area.h - (d / dMax) * area.h * 0.95;
      drawFrame(ctx, area, valueTicks(xLo, xHi, mapX), [], spectralFeatureAxisLabel(feature, sm.bandRatio, flip), 'Density', s,
        { x: zeroPos(feature.measure, xLo, xHi, mapX) }, exportConfig);
      ctx.save();
      ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
      curves.forEach(c => {
        const color = colorForKey(c.key);
        const trace = () => c.dens.forEach((d, k) => { const x = mapX(grid[k]), y = mapY(d); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.globalAlpha = 1;
        ctx.beginPath(); trace();
        ctx.lineTo(mapX(xHi), area.y + area.h); ctx.lineTo(mapX(xLo), area.y + area.h); ctx.closePath();
        ctx.fillStyle = `rgba(${hexToRgb(color)},${cfg.spectralDensityFill ?? 0.18})`; ctx.fill();
        ctx.beginPath(); trace();
        ctx.globalAlpha = cfg.meanTrajectoryOpacity ?? 1;
        ctx.setLineDash(dashForKey(c.key).map(v => v * s));
        ctx.strokeStyle = color; ctx.lineWidth = (cfg.meanTrajectoryWidth || 2) * s; ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }
  }, [sm, layers, layerData, activeConfig, activeData, activeLayer, bgConfig, legendLayers]);

  // ─── Export handle ────────────────────────────────────────────────
  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
      const { drawScale, width: plotW, height: plotH } = computeExportPlotSize(exportConfig, 2000, 1400);
      const legendEntries: { color: string, label: string, dash?: number[], texture?: number }[] = [];
      legendLayers.forEach(({ layer, enc }) => {
        const suffix = showTitles ? ` · ${layer.name}` : '';
        if (enc.colorKey && exportConfig.showColorLegend !== false) Object.keys(enc.colorMap).sort().forEach(k =>
          legendEntries.push({ color: enc.colorMap[k], label: `${enc.colorKey}: ${k}${suffix}` }));
        if (enc.lineTypeKey && exportConfig.showLineTypeLegend !== false) Object.keys(enc.lineTypePatternMap).sort().forEach(k =>
          legendEntries.push({ color: '#475569', dash: enc.lineTypePatternMap[k], label: `${enc.lineTypeKey}: ${k}${suffix}` }));
        if (enc.textureKey && exportConfig.showTextureLegend !== false) Object.keys(enc.textureMap).sort().forEach(k =>
          legendEntries.push({ color: '#475569', texture: enc.textureMap[k], label: `${enc.textureKey}: ${k}${suffix}` }));
      });
      const hasLegend = exportConfig.showLegend && legendEntries.length > 0;
      const itemS = (exportConfig.legendItemSize || 24) * drawScale;
      const maxLegendChars = Math.max(0, ...legendEntries.map(it => it.label.length));
      const legendW = hasLegend ? Math.max(460 * drawScale, itemS * (2 + maxLegendChars * 0.62)) : 0;
      const legendH = hasLegend ? Math.max(160 * drawScale, legendEntries.length * itemS * 1.7 + 40 * drawScale) : 0;
      const titleH = exportConfig.showPlotTitle ? (exportConfig.plotTitleSize || 96) * drawScale + 40 * drawScale : 0;
      const pad = 40 * drawScale;
      let canvasW = plotW + pad * 2;
      let canvasH = titleH + plotH + pad * 2;
      let legendX = 0, legendY = 0;
      if (hasLegend) {
        if (exportConfig.legendPosition === 'bottom') {
          legendX = pad; legendY = titleH + plotH + pad; canvasH += legendH;
        } else if (exportConfig.legendPosition === 'inside-top-left') {
          legendX = pad * 2; legendY = titleH + pad * 2;
        } else if (exportConfig.legendPosition === 'inside-top-right') {
          legendX = Math.max(pad, plotW - legendW); legendY = titleH + pad * 2;
        } else if (exportConfig.legendPosition === 'custom') {
          legendX = (Number(exportConfig.legendX) || 0) * drawScale;
          legendY = (Number(exportConfig.legendY) || 0) * drawScale;
        } else {
          legendX = plotW + pad; legendY = titleH + pad; canvasW += legendW;
          canvasH = Math.max(canvasH, legendY + legendH + pad);
        }
      }
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.max(100, Math.ceil(canvasW)); offscreen.height = Math.max(100, Math.ceil(canvasH));
      const ctx = offscreen.getContext('2d'); if (!ctx) return '';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      if (exportConfig.showPlotTitle) {
        ctx.font = `bold ${(exportConfig.plotTitleSize || 96) * drawScale}px Inter, sans-serif`; ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(exportConfig.plotTitle || 'Spectral', pad + plotW / 2 + (exportConfig.plotTitleX || 0) * drawScale, titleH / 2 + (exportConfig.plotTitleY || 0) * drawScale);
      }
      ctx.save(); ctx.translate(pad, titleH + pad); renderPlot(ctx, plotW, plotH, 1, drawScale, exportConfig); ctx.restore();
      if (hasLegend) {
        ctx.save(); ctx.translate(legendX, legendY); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        legendEntries.forEach((it, i) => {
          const y = (i + 0.5) * itemS * 1.7;
          if (it.texture !== undefined) {
            ctx.fillStyle = generateTexture(ctx, it.texture, it.color, '#ffffff'); ctx.fillRect(0, y - itemS / 2, itemS, itemS);
          } else if (it.dash) {
            ctx.strokeStyle = it.color; ctx.lineWidth = Math.max(2 * drawScale, itemS * 0.12); ctx.setLineDash(it.dash.map(v => v * drawScale));
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(itemS, y); ctx.stroke(); ctx.setLineDash([]);
          } else { ctx.fillStyle = it.color; ctx.fillRect(0, y - itemS / 2, itemS, itemS); }
          ctx.fillStyle = '#334155'; ctx.font = `${itemS}px Inter, sans-serif`; ctx.fillText(it.label, itemS * 1.4, y);
        });
        ctx.restore();
      }
      return offscreen.toDataURL('image/png');
    };
    return {
      exportImage: () => {
        const url = generateImage({ scale: 3, xAxisLabelSize: 96, yAxisLabelSize: 96, tickLabelSize: 64, dataLabelSize: 64, showLegend: true, legendTitleSize: 96, legendItemSize: 40, legendPosition: 'right', showColorLegend: true, colorLegendTitle: 'COLOUR', showShapeLegend: false, shapeLegendTitle: '', showTextureLegend: false, textureLegendTitle: '', showLineTypeLegend: false, lineTypeLegendTitle: '' });
        if (url) { const a = document.createElement('a'); a.download = 'spectral.png'; a.href = url; a.click(); }
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
                        onClick={(e) => onLegendClick?.(k, { color: enc.colorMap[k], shape: enc.shapeKey === enc.colorKey ? (enc.shapeMap[k] || 'circle') : 'circle', texture: enc.textureKey === enc.colorKey ? (enc.textureMap[k] ?? 0) : 0, lineType: enc.lineTypeNameMap[k] || 'solid' }, e, layer.id)}>
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
                          ) : enc.textureKey === enc.colorKey ? (
                            <PatternPreview index={enc.textureMap[k] ?? 0} color={enc.colorMap[k]} />
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

                {enc.textureKey && enc.textureKey !== enc.colorKey && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 flex justify-between items-center">
                      <span>{enc.textureKey}</span>
                    </h4>
                    {Object.keys(enc.textureMap).sort().map(k => (
                      <div key={k} className="flex justify-between items-center text-[10px] cursor-pointer hover:bg-slate-100 p-1 rounded"
                        onClick={(e) => onLegendClick?.(k, { color: '#64748b', shape: 'circle', texture: enc.textureMap[k] ?? 0, lineType: 'solid' }, e, layer.id)}>
                        <div className="flex items-center space-x-2">
                          <PatternPreview index={enc.textureMap[k] ?? 0} color="#475569" />
                          <span className="text-slate-700 font-medium truncate w-24">{k}</span>
                        </div>
                        <span className="text-slate-400 font-mono">({enc.textureCounts[k] || 0})</span>
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
// Tiny canvas swatch used by the interactive fill-pattern legend.
const PatternPreview = ({ index, color }: { index: number; color: string }) => {
  const previewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = previewRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = generateTexture(ctx, index, color, '#ffffff');
      ctx.fillRect(0, 0, 12, 12);
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(0, 0, 12, 12);
    }
  }, [index, color]);
  return <canvas ref={previewRef} width={12} height={12} className="rounded-sm shrink-0" />;
};

export default SpectralMomentsPlot;
