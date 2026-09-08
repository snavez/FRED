import React from 'react';
import { Layer } from '../types';

/**
 * The key beside a plot: what each colour, shape and line type stands for, and how many
 * tokens carry it.
 *
 * Rendered as elements rather than painted onto the canvas, because a legend is also the
 * place you *change* a style — clicking an entry opens the style editor for that category.
 * A plot that paints its own legend has a picture of one, and the click goes nowhere.
 */

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


export const PlotLegend = ({ layers, allMappings, onLegendClick }: {
  layers: Layer[];
  /** Encoding maps per layer id, as `computeEncodingMaps` returns them. */
  allMappings: Record<string, any>;
  /** Opens the style editor for the clicked category. Omit for a read-only key. */
  onLegendClick?: (
    category: string,
    styles: { color: string; shape: string; texture: number; lineType: string },
    event: React.MouseEvent,
    layerId?: string,
  ) => void;
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
