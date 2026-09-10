
import React, { useEffect, useRef, useState } from 'react';
import { generateTexture } from '../utils/textureGenerator';

interface StyleEditorProps {
  category: string; // The specific value being edited (e.g., "i", "Stressed")
  activeChannels: {
    color: boolean;
    shape: boolean;
    texture: boolean;
    lineType: boolean;
  };
  currentStyles: {
    color: string;
    shape: string;
    texture: number;
    lineType: string;
  };
  onUpdate: (type: 'color' | 'shape' | 'texture' | 'lineType', value: any) => void;
  onClose: () => void;
  position: { x: number, y: number };
  bwMode?: boolean;
  /** Colours mixed by hand this session, offered alongside the fixed palette. */
  customColors?: string[];
  /** Remember a mixed colour, so it can be reused on any plot without mixing it again. */
  onAddCustomColor?: (hex: string) => void;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626',
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777',
  '#000000', '#525252', '#969696', '#ffffff'
];

const GREYSCALE_COLORS = [
  '#000000', '#1a1a1a', '#333333', '#4d4d4d',
  '#666666', '#808080', '#999999', '#b3b3b3',
  '#cccccc', '#d9d9d9', '#e6e6e6', '#ffffff',
];

const SHAPES = [
  'circle', 'square', 'triangle', 'diamond', 'hexagon', 
  'circle-open', 'square-open', 'triangle-open', 'diamond-open', 
  'plus', 'cross', 'asterisk'
];

const LINE_TYPES = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dash', value: 'dash' },
  { label: 'Dot', value: 'dot' },
  { label: 'Long Dash', value: 'longdash' },
  { label: 'Dot-Dash', value: 'dotdash' }
];

const DASH_STYLES: Record<string, string> = {
  'solid': '',
  'dash': '5, 5',
  'dot': '2, 6',
  'longdash': '15, 5',
  'dotdash': '2, 4, 10, 4'
};

const ShapeIcon = ({ shape, color = '#333' }: { shape: string, color?: string }) => (
  <svg width="16" height="16" viewBox="0 0 20 20">
    <g fill={shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape) ? 'none' : color} 
       stroke={color} 
       strokeWidth={shape.endsWith('-open') || ['plus', 'cross', 'asterisk'].includes(shape) ? "2" : "0"}>
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

/** #rrggbb for a colour input, whatever spelling the caller had. */
const normaliseHex = (value: string): string | null => {
  const v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v.toLowerCase()}`;
  return null;
};

const toRgb = (hex: string): [number, number, number] => {
  const h = normaliseHex(hex) || '#000000';
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const fromRgb = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0')).join('');

/**
 * Mix a colour outside the fixed palette.
 *
 * The wheel is the browser's own colour input, which every platform renders as a proper
 * picker; the hex and RGB boxes are there for when a colour has to match a value from
 * somewhere else exactly, which a wheel cannot do by eye.
 *
 * Every control previews as it moves, so the plot follows the mix, but only settles on a
 * colour once: the wheel when its picker is dismissed, the boxes when they are left or
 * confirmed. Without that split a single drag would remember every hue it passed through.
 */
const ColorMixer: React.FC<{
  value: string;
  /** Show this colour on the plot, without deciding it is the one. */
  onPreview: (hex: string) => void;
  /** Settle on this colour, and keep it. */
  onSettle: (hex: string) => void;
}> = ({ value, onPreview, onSettle }) => {
  const [text, setText] = useState(value);
  const [r, g, b] = toRgb(text);
  const wheelRef = useRef<HTMLInputElement>(null);

  const preview = (hex: string) => { setText(hex); onPreview(hex); };
  const settle = (hex: string) => { setText(hex); onPreview(hex); onSettle(hex); };

  // The wheel's own `change` fires once, when the picker closes; React's onChange is the
  // `input` event, which fires all the way through a drag.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const closed = (e: Event) => {
      const hex = (e.target as HTMLInputElement).value;
      setText(hex);
      onSettleRef.current(hex);
    };
    el.addEventListener('change', closed);
    return () => el.removeEventListener('change', closed);
  }, []);

  return (
    <div className="mt-2 p-2 border border-slate-200 rounded-lg bg-slate-50 space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={wheelRef}
          type="color"
          value={normaliseHex(text) || '#000000'}
          onChange={e => preview(e.target.value)}
          className="w-10 h-8 p-0 border border-slate-200 rounded cursor-pointer bg-white"
          title="Pick a colour"
        />
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => { const hex = normaliseHex(text); if (hex) settle(hex); else setText(value); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { const hex = normaliseHex(text); if (hex) settle(hex); }
            if (e.key === 'Escape') setText(value);
          }}
          className="flex-1 min-w-0 px-1.5 py-1 text-[11px] font-mono border border-slate-200 rounded focus:outline-none focus:border-sky-500"
          placeholder="#rrggbb"
          title="Hex value, applied on Enter or when you leave the box"
        />
      </div>
      <div className="flex items-center gap-1.5">
        {(['R', 'G', 'B'] as const).map((channel, i) => (
          <label key={channel} className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-[9px] font-bold text-slate-400">{channel}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={[r, g, b][i]}
              onChange={e => {
                const next: [number, number, number] = [r, g, b];
                next[i] = parseInt(e.target.value, 10);
                preview(fromRgb(next[0], next[1], next[2]));
              }}
              onBlur={() => { const hex = normaliseHex(text); if (hex) settle(hex); }}
              onKeyDown={e => { if (e.key === 'Enter') { const hex = normaliseHex(text); if (hex) settle(hex); } }}
              className="w-full min-w-0 px-1 py-0.5 text-[10px] border border-slate-200 rounded focus:outline-none focus:border-sky-500"
            />
          </label>
        ))}
      </div>
    </div>
  );
};

const StyleEditor: React.FC<StyleEditorProps> = ({ category, activeChannels, currentStyles, onUpdate, onClose, position, bwMode, customColors = [], onAddCustomColor }) => {
  // Mixed colours join the fixed palette rather than replacing it, so a swatch chosen once
  // is a click away on every plot for the rest of the session.
  const colorPalette = [...(bwMode ? GREYSCALE_COLORS : COLORS), ...customColors.filter(c => !COLORS.includes(c))];
  const [mixing, setMixing] = useState(false);
  // Prevent going off screen
  const safeX = Math.min(window.innerWidth - 260, Math.max(10, position.x));
  const safeY = Math.min(window.innerHeight - 400, Math.max(10, position.y));

  return (
    <div 
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-64 p-4 animate-in fade-in zoom-in-95 duration-100"
      style={{ top: safeY, left: safeX }}
    >
      <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
        <h3 className="font-bold text-slate-800 text-sm">Edit Style: <span className="text-sky-700 font-mono">{category}</span></h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Color Picker */}
        {activeChannels.color && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Color</label>
            <div className={`grid gap-2 ${bwMode ? 'grid-cols-4' : 'grid-cols-6'}`}>
              {colorPalette.map(c => (
                <button
                  key={c}
                  onClick={() => onUpdate('color', c)}
                  className={`w-6 h-6 rounded-md border shadow-sm transition-transform hover:scale-110 ${currentStyles.color === c ? 'ring-2 ring-offset-1 ring-sky-500' : 'border-slate-200'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                onClick={() => setMixing(v => !v)}
                title="Mix a colour of your own"
                className={`w-6 h-6 rounded-md border shadow-sm transition-transform hover:scale-110 ${mixing ? 'ring-2 ring-offset-1 ring-sky-500' : 'border-slate-200'}`}
                style={{ background: 'conic-gradient(#ef4444,#f59e0b,#84cc16,#10b981,#06b6d4,#3b82f6,#8b5cf6,#ec4899,#ef4444)' }}
              />
            </div>
            {mixing && (
              <ColorMixer
                value={currentStyles.color}
                onPreview={hex => onUpdate('color', hex)}
                onSettle={hex => { onUpdate('color', hex); onAddCustomColor?.(hex); }}
              />
            )}
          </div>
        )}

        {/* Shape Picker */}
        {activeChannels.shape && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Shape</label>
            <div className="grid grid-cols-6 gap-2">
              {SHAPES.map(s => (
                <button 
                  key={s}
                  onClick={() => onUpdate('shape', s)}
                  className={`w-7 h-7 flex items-center justify-center rounded-md border hover:bg-slate-50 ${currentStyles.shape === s ? 'ring-2 ring-offset-1 ring-sky-500 bg-sky-50 border-sky-200' : 'border-slate-200'}`}
                >
                  <ShapeIcon shape={s} color={activeChannels.color ? currentStyles.color : '#333'} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Texture Picker */}
        {activeChannels.texture && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Pattern</label>
            <div className="grid grid-cols-5 gap-2">
              {[0,1,2,3,4,5,6,7,8].map(idx => (
                <CanvasPatternPreview 
                  key={idx} 
                  index={idx} 
                  color={activeChannels.color ? currentStyles.color : '#333'}
                  isSelected={currentStyles.texture === idx}
                  onClick={() => onUpdate('texture', idx)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Line Type Picker */}
        {activeChannels.lineType && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Line Type</label>
            <div className="space-y-1">
              {LINE_TYPES.map(lt => (
                <button
                  key={lt.value}
                  onClick={() => onUpdate('lineType', lt.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded border text-xs ${currentStyles.lineType === lt.value ? 'bg-sky-50 border-sky-200 text-sky-800 font-bold' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'}`}
                >
                  <span>{lt.label}</span>
                  {/* Visual rep */}
                  <svg width="48" height="2" className="text-slate-400">
                    <line x1="0" y1="1" x2="48" y2="1" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeDasharray={DASH_STYLES[lt.value]} 
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const CanvasPatternPreview = ({ index, color, isSelected, onClick }: any) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    React.useEffect(() => {
        if(canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if(ctx) {
                const pat = generateTexture(ctx, index, color, '#fff');
                ctx.fillStyle = pat;
                ctx.fillRect(0,0,32,32);
                ctx.strokeStyle = '#cbd5e1';
                ctx.strokeRect(0,0,32,32);
            }
        }
    }, [index, color]);
    return (
        <button onClick={onClick} className={`rounded overflow-hidden border ${isSelected ? 'ring-2 ring-sky-500 ring-offset-1' : 'border-transparent'}`}>
            <canvas ref={canvasRef} width={32} height={32} />
        </button>
    );
};

export default StyleEditor;
