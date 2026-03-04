
import React from 'react';
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
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626', 
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777',
  '#000000', '#525252', '#969696', '#ffffff'
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

const StyleEditor: React.FC<StyleEditorProps> = ({ category, activeChannels, currentStyles, onUpdate, onClose, position }) => {
  // Prevent going off screen
  const safeX = Math.min(window.innerWidth - 260, Math.max(10, position.x));
  const safeY = Math.min(window.innerHeight - 400, Math.max(10, position.y));

  return (
    <div 
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-64 p-4 animate-in fade-in zoom-in-95 duration-100"
      style={{ top: safeY, left: safeX }}
    >
      <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
        <h3 className="font-bold text-slate-800 text-sm">Edit Style: <span className="text-indigo-600 font-mono">{category}</span></h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Color Picker */}
        {activeChannels.color && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Color</label>
            <div className="grid grid-cols-6 gap-2">
              {COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => onUpdate('color', c)}
                  className={`w-6 h-6 rounded-md border shadow-sm transition-transform hover:scale-110 ${currentStyles.color === c ? 'ring-2 ring-offset-1 ring-indigo-500' : 'border-slate-200'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
                  className={`w-7 h-7 flex items-center justify-center rounded-md border hover:bg-slate-50 ${currentStyles.shape === s ? 'ring-2 ring-offset-1 ring-indigo-500 bg-indigo-50 border-indigo-200' : 'border-slate-200'}`}
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
                  className={`w-full flex items-center justify-between px-3 py-2 rounded border text-xs ${currentStyles.lineType === lt.value ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'}`}
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
        <button onClick={onClick} className={`rounded overflow-hidden border ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border-transparent'}`}>
            <canvas ref={canvasRef} width={32} height={32} />
        </button>
    );
};

export default StyleEditor;
