import React from 'react';
import { SpeechToken, PlotConfig, StyleOverrides } from '../types';
import { getLabel } from './getLabel';

/**
 * Shared visual-encoding primitives for scatter/trajectory plots (F1/F2 and Spectral
 * Moments): colour palette, marker shapes, line-dash patterns, and the mapping from a
 * categorical variable's values to those channels. Keeping these in one place lets the
 * plots present identical legends and styling controls.
 */

export const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626',
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

export const BW_COLORS = ['#000000', '#525252', '#969696', '#d4d4d4'];

export const SHAPES = [
  'circle', 'square', 'triangle', 'diamond', 'hexagon',
  'circle-open', 'square-open', 'triangle-open', 'diamond-open',
  'plus', 'cross', 'asterisk'
];

/** Line-type name ↔ canvas dash pattern. */
export const LINE_TYPE_PATTERNS: Record<string, number[]> = {
  solid: [], dash: [5, 5], dot: [2, 2], longdash: [10, 5], dotdash: [20, 5, 5, 5],
};
export const DEFAULT_LINE_TYPE_NAMES = ['solid', 'dash', 'dot', 'longdash', 'dotdash'];

/** True if a hex colour is achromatic (R≈G≈B within tolerance 8). */
export const isGreyHex = (hex: string): boolean => {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return Math.abs(r - g) <= 8 && Math.abs(r - b) <= 8 && Math.abs(g - b) <= 8;
};

/** Hex → "r,g,b" for use in rgba(). */
export const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  return `${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)}`;
};

/** Draw a marker of the named shape at (x,y). Open shapes/glyphs stroke; filled shapes fill. */
export const drawShape = (ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, scale: number, drawScale = 1, strokeWidth?: number) => {
  ctx.beginPath();
  switch (shape) {
    case 'circle': case 'circle-open': ctx.arc(x, y, size, 0, Math.PI * 2); break;
    case 'square': case 'square-open': ctx.rect(x - size, y - size, size * 2, size * 2); break;
    case 'triangle': case 'triangle-open': ctx.moveTo(x, y - size); ctx.lineTo(x + size, y + size); ctx.lineTo(x - size, y + size); ctx.closePath(); break;
    case 'diamond': case 'diamond-open': ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath(); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; ctx[i === 0 ? 'moveTo' : 'lineTo'](x + size * Math.cos(a), y + size * Math.sin(a)); } ctx.closePath(); break;
    case 'plus': ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); break;
    case 'cross': { const s = size * 0.7; ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); break; }
    case 'asterisk': { ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); const s2 = size * 0.7; ctx.moveTo(x - s2, y - s2); ctx.lineTo(x + s2, y + s2); ctx.moveTo(x + s2, y - s2); ctx.lineTo(x - s2, y + s2); break; }
    default: ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  const lineWidth = strokeWidth ?? (2 * drawScale) / scale;
  if (shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape)) { ctx.lineWidth = lineWidth; ctx.stroke(); }
  else ctx.fill();
};

/** Small SVG glyph for shape legends. */
export const ShapeIcon = ({ shape, color = '#333' }: { shape: string, color?: string }) => {
  const open = shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape);
  return (
    <svg width="14" height="14" viewBox="0 0 20 20">
      <g fill={open ? 'none' : color} stroke={color} strokeWidth={open ? '3' : '0'}>
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

export interface EncodingMaps {
  colorKey: string | null;
  shapeKey: string | null;
  lineTypeKey: string | null;
  colorMap: Record<string, string>;
  shapeMap: Record<string, string>;
  lineTypeNameMap: Record<string, string>;
  lineTypePatternMap: Record<string, number[]>;
  colorCounts: Record<string, number>;
  shapeCounts: Record<string, number>;
  lineTypeCounts: Record<string, number>;
}

/** Compute colour/shape/line-type maps for a layer's data (mirrors CanvasPlot.computeMappings). */
export const computeEncodingMaps = (data: SpeechToken[], config: PlotConfig, styleOverrides?: StyleOverrides): EncodingMaps => {
  const colorKey = config.colorBy === 'none' ? null : config.colorBy;
  const shapeKey = config.shapeBy === 'none' ? null : config.shapeBy;
  const lineTypeKey = config.lineTypeBy === 'none' ? null : config.lineTypeBy;

  const uniq = (key: string | null) => key ? Array.from(new Set(data.map(t => getLabel(t, key)))).filter(v => v !== '').sort() : [];
  const colorValues = uniq(colorKey);
  const shapeValues = uniq(shapeKey);
  const lineTypeValues = uniq(lineTypeKey);

  const palette = config.bwMode ? BW_COLORS : COLORS;
  const colorMap: Record<string, string> = {};
  colorValues.forEach((v, i) => { const ov = styleOverrides?.colors[v]; colorMap[v] = (ov && (!config.bwMode || isGreyHex(ov))) ? ov : palette[i % palette.length]; });

  const shapeMap: Record<string, string> = {};
  shapeValues.forEach((v, i) => { shapeMap[v] = styleOverrides?.shapes[v] || SHAPES[i % SHAPES.length]; });

  const lineTypeNameMap: Record<string, string> = {};
  const lineTypePatternMap: Record<string, number[]> = {};
  lineTypeValues.forEach((v, i) => {
    const ov = styleOverrides?.lineTypes?.[v];
    const name = (ov && LINE_TYPE_PATTERNS[ov]) ? ov : DEFAULT_LINE_TYPE_NAMES[i % DEFAULT_LINE_TYPE_NAMES.length];
    lineTypeNameMap[v] = name;
    lineTypePatternMap[v] = LINE_TYPE_PATTERNS[name] || [];
  });

  const count = (key: string | null, out: Record<string, number>) => { if (key) data.forEach(t => { const k = getLabel(t, key); out[k] = (out[k] || 0) + 1; }); };
  const colorCounts: Record<string, number> = {}, shapeCounts: Record<string, number> = {}, lineTypeCounts: Record<string, number> = {};
  count(colorKey, colorCounts); count(shapeKey, shapeCounts); count(lineTypeKey, lineTypeCounts);

  return { colorKey, shapeKey, lineTypeKey, colorMap, shapeMap, lineTypeNameMap, lineTypePatternMap, colorCounts, shapeCounts, lineTypeCounts };
};
