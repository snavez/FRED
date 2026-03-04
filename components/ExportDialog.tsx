
import React, { useState, useEffect } from 'react';
import { ExportConfig, PlotHandle, PlotConfig } from '../types';
import { Download, X, RefreshCw, Type, Link, Link2Off } from 'lucide-react';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plotRef: React.RefObject<PlotHandle>;
  currentConfig: PlotConfig; // Passed to detect active variables
  defaultTitle?: string;
}

const DEFAULT_CONFIG: ExportConfig = {
  scale: 3,
  graphScale: 1.0,
  graphScaleX: 1.0,
  graphScaleY: 1.0,
  graphX: 0,
  graphY: 0,
  xAxisLabelSize: 32,
  yAxisLabelSize: 32,
  tickLabelSize: 24,
  dataLabelSize: 24,
  showLegend: true,
  legendTitleSize: 36,
  legendItemSize: 24,
  showColorLegend: true,
  colorLegendTitle: '',
  showShapeLegend: true,
  shapeLegendTitle: '',
  showTextureLegend: true,
  textureLegendTitle: '',
  showLineTypeLegend: true,
  lineTypeLegendTitle: '',
  
  showPlotTitle: false,
  plotTitle: 'Vowel Space Plot',
  plotTitleSize: 48,
  plotTitleX: 0,
  plotTitleY: 0,
  legendPosition: 'right',
  legendX: 200,
  legendY: 200
};

const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose, plotRef, currentConfig, defaultTitle }) => {
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [linkAxes, setLinkAxes] = useState(true);
  const [linkGraphScale, setLinkGraphScale] = useState(true);
  const [fontScale, setFontScale] = useState(1.0);
  const [isAutoCanvas, setIsAutoCanvas] = useState(true);

  // Initialize titles based on current plot config when opening
  useEffect(() => {
    if (isOpen) {
        setConfig(prev => ({
            ...prev,
            graphScaleX: prev.graphScaleX || prev.graphScale || 1.0,
            graphScaleY: prev.graphScaleY || prev.graphScale || 1.0,
            colorLegendTitle: currentConfig.colorBy !== 'none' ? currentConfig.colorBy.toUpperCase() : 'COLOR',
            shapeLegendTitle: currentConfig.shapeBy !== 'none' ? currentConfig.shapeBy.toUpperCase() : 'SHAPE',
            textureLegendTitle: currentConfig.textureBy !== 'none' ? currentConfig.textureBy.toUpperCase() : 'PATTERN',
            lineTypeLegendTitle: currentConfig.lineTypeBy !== 'none' ? currentConfig.lineTypeBy.toUpperCase() : 'LINE TYPE',
            // Reset canvas to auto on open, or keep previous if we persist config?
            // For now, let's respect the passed config or default. 
            // If we want to persist user preference for fixed canvas, we'd need to lift state up.
            // But here, let's just default to Auto unless config has values.
            canvasWidth: undefined,
            canvasHeight: undefined
        }));
        setIsAutoCanvas(true);
    }
  }, [isOpen, currentConfig]);

  useEffect(() => {
      if (isAutoCanvas) {
          setConfig(prev => ({ ...prev, canvasWidth: undefined, canvasHeight: undefined }));
      } else {
          setConfig(prev => ({ 
              ...prev, 
              canvasWidth: prev.canvasWidth || 2400, 
              canvasHeight: prev.canvasHeight || 1600 
          }));
      }
  }, [isAutoCanvas]);

  const handleFontScaleChange = (newScale: number) => {
      setFontScale(newScale);
      setConfig(prev => ({
          ...prev,
          xAxisLabelSize: Math.round(DEFAULT_CONFIG.xAxisLabelSize * newScale),
          yAxisLabelSize: Math.round(DEFAULT_CONFIG.yAxisLabelSize * newScale),
          tickLabelSize: Math.round(DEFAULT_CONFIG.tickLabelSize * newScale),
          dataLabelSize: Math.round(DEFAULT_CONFIG.dataLabelSize * newScale),
          legendTitleSize: Math.round(DEFAULT_CONFIG.legendTitleSize * newScale),
          legendItemSize: Math.round(DEFAULT_CONFIG.legendItemSize * newScale),
          plotTitleSize: Math.round(DEFAULT_CONFIG.plotTitleSize * newScale),
      }));
  };

  // Generate preview whenever config changes or dialog opens
  useEffect(() => {
    if (isOpen && plotRef.current) {
        setIsGenerating(true);
        const timer = setTimeout(() => {
            if (plotRef.current) {
                // Force scale to 1 for preview to avoid OOM/blanking on high resolutions
                // The layout logic in CanvasPlot now handles proportional scaling, 
                // so 1x preview looks layout-wise identical to 4x export.
                const previewConfig = { ...config, scale: 1 };
                const url = plotRef.current.generateImage(previewConfig);
                setPreviewUrl(url);
                setIsGenerating(false);
            }
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [config, isOpen, plotRef]);

  if (!isOpen) return null;

  const handleDownload = () => {
      if (previewUrl) {
          const link = document.createElement('a');
          link.download = `vowelvision_export_${Date.now()}.png`;
          link.href = previewUrl;
          link.click();
          onClose();
      }
  };

  const updateConfig = (key: keyof ExportConfig, val: any) => {
      setConfig(prev => {
          const updates: Partial<ExportConfig> = { [key]: val };
          // Link axes logic
          if (linkAxes) {
              if (key === 'xAxisLabelSize') updates.yAxisLabelSize = val;
              if (key === 'yAxisLabelSize') updates.xAxisLabelSize = val;
          }
          // Link Graph Scale logic
          if (linkGraphScale && (key === 'graphScale' || key === 'graphScaleX' || key === 'graphScaleY')) {
             // If linked, update all
             if (key === 'graphScale') {
                 updates.graphScaleX = val;
                 updates.graphScaleY = val;
             }
             // If X or Y changed while linked (shouldn't happen with UI logic, but for safety)
             if (key === 'graphScaleX') {
                 updates.graphScale = val;
                 updates.graphScaleY = val;
             }
             if (key === 'graphScaleY') {
                 updates.graphScale = val;
                 updates.graphScaleX = val;
             }
          }
          return { ...prev, ...updates };
      });
  };

  // Helper to determine which inputs to show
  const showColorInput = currentConfig.colorBy !== 'none';
  const showShapeInput = currentConfig.shapeBy !== 'none' && currentConfig.shapeBy !== currentConfig.colorBy;
  const showTextureInput = currentConfig.textureBy !== 'none' && currentConfig.textureBy !== currentConfig.colorBy;
  const showLineInput = currentConfig.lineTypeBy !== 'none';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex overflow-hidden border border-slate-200">
        
        {/* Left: Configuration Controls */}
        <div className="w-80 flex-shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
                <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <Type size={18} className="text-indigo-600"/> 
                    Export Settings
                </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* Section: Graph Geometry */}
                <div className="space-y-3 pb-4 border-b border-slate-200">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Graph Geometry</h3>
                        <button onClick={() => setLinkGraphScale(!linkGraphScale)} className="text-slate-400 hover:text-indigo-600" title={linkGraphScale ? "Unlink Scale" : "Link Scale"}>
                            {linkGraphScale ? <Link size={14} /> : <Link2Off size={14} />}
                        </button>
                    </div>
                    
                    {linkGraphScale ? (
                        <div>
                            <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                Graph Scale <span>{config.graphScale?.toFixed(2) || '1.00'}x</span>
                            </label>
                            <div className="flex gap-2 items-center">
                                <input 
                                    type="range" 
                                    min="0.1" 
                                    max="3.0" 
                                    step="0.05" 
                                    value={config.graphScale || 1.0} 
                                    onChange={e => updateConfig('graphScale', parseFloat(e.target.value))} 
                                    className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                />
                                <input 
                                    type="number" 
                                    min="0.1" 
                                    max="3.0" 
                                    step="0.1" 
                                    value={config.graphScale || 1.0} 
                                    onChange={e => updateConfig('graphScale', parseFloat(e.target.value))} 
                                    className="w-16 text-xs p-1 border border-slate-300 rounded text-center"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                    X Scale <span>{config.graphScaleX?.toFixed(2) || '1.00'}x</span>
                                </label>
                                <div className="flex gap-2 items-center">
                                    <input 
                                        type="range" 
                                        min="0.1" 
                                        max="3.0" 
                                        step="0.05" 
                                        value={config.graphScaleX || 1.0} 
                                        onChange={e => updateConfig('graphScaleX', parseFloat(e.target.value))} 
                                        className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <input 
                                        type="number" 
                                        min="0.1" 
                                        max="3.0" 
                                        step="0.1" 
                                        value={config.graphScaleX || 1.0} 
                                        onChange={e => updateConfig('graphScaleX', parseFloat(e.target.value))} 
                                        className="w-16 text-xs p-1 border border-slate-300 rounded text-center"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                    Y Scale <span>{config.graphScaleY?.toFixed(2) || '1.00'}x</span>
                                </label>
                                <div className="flex gap-2 items-center">
                                    <input 
                                        type="range" 
                                        min="0.1" 
                                        max="3.0" 
                                        step="0.05" 
                                        value={config.graphScaleY || 1.0} 
                                        onChange={e => updateConfig('graphScaleY', parseFloat(e.target.value))} 
                                        className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <input 
                                        type="number" 
                                        min="0.1" 
                                        max="3.0" 
                                        step="0.1" 
                                        value={config.graphScaleY || 1.0} 
                                        onChange={e => updateConfig('graphScaleY', parseFloat(e.target.value))} 
                                        className="w-16 text-xs p-1 border border-slate-300 rounded text-center"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-100 p-2 rounded">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 block mb-1">Graph X Offset</label>
                            <input type="number" value={config.graphX || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('graphX', isNaN(v) ? 0 : v); }} className="w-full text-xs p-1 border border-slate-300 rounded"/>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 block mb-1">Graph Y Offset</label>
                            <input type="number" value={config.graphY || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('graphY', isNaN(v) ? 0 : v); }} className="w-full text-xs p-1 border border-slate-300 rounded"/>
                        </div>
                    </div>
                </div>

                {/* Section: Canvas Dimensions */}
                <div className="space-y-3 pb-4 border-b border-slate-200">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Canvas Dimensions</h3>
                        <button onClick={() => setIsAutoCanvas(!isAutoCanvas)} className={`text-xs px-2 py-0.5 rounded font-bold transition-colors ${isAutoCanvas ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                            {isAutoCanvas ? 'AUTO' : 'FIXED'}
                        </button>
                    </div>
                    
                    {!isAutoCanvas && (
                        <div className="grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Width (px)</label>
                                <input 
                                    type="number" 
                                    value={config.canvasWidth || 2400} 
                                    onChange={e => updateConfig('canvasWidth', parseInt(e.target.value))} 
                                    className="w-full text-xs p-1 border border-slate-300 rounded"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Height (px)</label>
                                <input 
                                    type="number" 
                                    value={config.canvasHeight || 1600} 
                                    onChange={e => updateConfig('canvasHeight', parseInt(e.target.value))} 
                                    className="w-full text-xs p-1 border border-slate-300 rounded"
                                />
                            </div>
                        </div>
                    )}
                    {isAutoCanvas && (
                        <p className="text-[10px] text-slate-400 italic">Canvas size adjusts automatically to fit graph and legend.</p>
                    )}
                </div>

                {/* Section: Global Font Scale */}
                <div className="space-y-3 pb-4 border-b border-slate-200">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Global Font Scale</h3>
                        <span className="text-xs font-bold text-indigo-600">{fontScale.toFixed(1)}x</span>
                    </div>
                    <input 
                        type="range" 
                        min="0.5" 
                        max="3.0" 
                        step="0.1" 
                        value={fontScale} 
                        onChange={e => handleFontScaleChange(parseFloat(e.target.value))} 
                        className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                    />
                </div>

                {/* Section: Chart Title */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Chart Title</h3>
                        <input type="checkbox" checked={config.showPlotTitle} onChange={e => updateConfig('showPlotTitle', e.target.checked)} className="rounded text-indigo-600 scale-75"/>
                    </div>
                    
                    {config.showPlotTitle && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <input 
                                type="text" 
                                value={config.plotTitle} 
                                onChange={e => updateConfig('plotTitle', e.target.value)} 
                                className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none" 
                                placeholder="Enter chart title..."
                            />
                            <div>
                                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                    Size <span>{config.plotTitleSize}px</span>
                                </label>
                                <div className="flex gap-2 items-center">
                                    <input type="range" min="24" max="500" value={config.plotTitleSize} onChange={e => updateConfig('plotTitleSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                                    <input type="number" min="1" max="999" value={config.plotTitleSize} onChange={e => updateConfig('plotTitleSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-100 p-2 rounded">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 block mb-1">X Offset</label>
                                    <input type="number" value={config.plotTitleX || 0} onChange={e => updateConfig('plotTitleX', parseInt(e.target.value))} className="w-full text-xs p-1 border border-slate-300 rounded"/>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Y Offset</label>
                                    <input type="number" value={config.plotTitleY || 0} onChange={e => updateConfig('plotTitleY', parseInt(e.target.value))} className="w-full text-xs p-1 border border-slate-300 rounded"/>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="h-px bg-slate-200"></div>

                {/* Section: Axis Typography */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Axis Labels</h3>
                        <button onClick={() => setLinkAxes(!linkAxes)} className="text-slate-400 hover:text-indigo-600" title={linkAxes ? "Unlink Axes" : "Link Axes"}>
                            {linkAxes ? <Link size={14} /> : <Link2Off size={14} />}
                        </button>
                    </div>
                    
                    <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                            X Axis Size <span>{config.xAxisLabelSize}px</span>
                        </label>
                        <div className="flex gap-2 items-center">
                            <input type="range" min="12" max="500" value={config.xAxisLabelSize} onChange={e => updateConfig('xAxisLabelSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                            <input type="number" min="1" max="999" value={config.xAxisLabelSize} onChange={e => updateConfig('xAxisLabelSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            <input type="number" placeholder="X Offset" value={config.xAxisLabelX || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('xAxisLabelX', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                            <input type="number" placeholder="Y Offset" value={config.xAxisLabelY || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('xAxisLabelY', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                            Y Axis Size <span>{config.yAxisLabelSize}px</span>
                        </label>
                        <div className="flex gap-2 items-center">
                            <input type="range" min="12" max="500" value={config.yAxisLabelSize} onChange={e => updateConfig('yAxisLabelSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                            <input type="number" min="1" max="999" value={config.yAxisLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisLabelSize', isNaN(v) ? 12 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            <input type="number" placeholder="X Offset" value={config.yAxisLabelX || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisLabelX', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                            <input type="number" placeholder="Y Offset" value={config.yAxisLabelY || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisLabelY', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 mt-2">
                        <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                            Tick Numbers <span>{config.tickLabelSize}px</span>
                        </label>
                        <div className="flex gap-2 items-center">
                            <input type="range" min="10" max="500" value={config.tickLabelSize} onChange={e => updateConfig('tickLabelSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                            <input type="number" min="1" max="999" value={config.tickLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('tickLabelSize', isNaN(v) ? 10 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            <div>
                                <label className="text-[9px] text-slate-400 block">X-Axis Ticks</label>
                                <div className="flex gap-1">
                                    <input type="number" placeholder="X" value={config.xAxisTickX || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('xAxisTickX', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                                    <input type="number" placeholder="Y" value={config.xAxisTickY || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('xAxisTickY', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                                </div>
                            </div>
                            <div>
                                <label className="text-[9px] text-slate-400 block">Y-Axis Ticks</label>
                                <div className="flex gap-1">
                                    <input type="number" placeholder="X" value={config.yAxisTickX || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisTickX', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                                    <input type="number" placeholder="Y" value={config.yAxisTickY || 0} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisTickY', isNaN(v) ? 0 : v); }} className="w-full text-[10px] p-1 border border-slate-300 rounded"/>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                            Data Labels <span>{config.dataLabelSize}px</span>
                        </label>
                        <div className="flex gap-2 items-center">
                            <input type="range" min="8" max="500" value={config.dataLabelSize} onChange={e => updateConfig('dataLabelSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                            <input type="number" min="1" max="999" value={config.dataLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('dataLabelSize', isNaN(v) ? 8 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                        </div>
                    </div>
                </div>

                <div className="h-px bg-slate-200"></div>

                {/* Section: Legend */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Legend</h3>
                        <button onClick={() => updateConfig('showLegend', !config.showLegend)} className={`text-xs px-2 py-0.5 rounded font-bold transition-colors ${config.showLegend ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                            {config.showLegend ? 'VISIBLE' : 'HIDDEN'}
                        </button>
                    </div>

                    {config.showLegend && (
                        <>
                            <div className="mb-3">
                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Position</label>
                                <select 
                                    value={config.legendPosition} 
                                    onChange={e => updateConfig('legendPosition', e.target.value)}
                                    className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="right">Right (Outside)</option>
                                    <option value="bottom">Bottom (Outside)</option>
                                    <option value="inside-top-right">Inside (Top Right)</option>
                                    <option value="inside-top-left">Inside (Top Left)</option>
                                    <option value="custom">Custom Coordinates</option>
                                </select>
                            </div>

                            {config.legendPosition === 'custom' && (
                                <div className="grid grid-cols-2 gap-2 mb-3 bg-slate-100 p-2 rounded">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 block mb-1">X Coordinate</label>
                                        <input 
                                            type="number" 
                                            value={config.legendX} 
                                            onChange={e => {
                                                const val = parseInt(e.target.value);
                                                updateConfig('legendX', isNaN(val) ? 0 : val);
                                            }} 
                                            className="w-full text-xs p-1 border border-slate-300 rounded"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 block mb-1">Y Coordinate</label>
                                        <input 
                                            type="number" 
                                            value={config.legendY} 
                                            onChange={e => {
                                                const val = parseInt(e.target.value);
                                                updateConfig('legendY', isNaN(val) ? 0 : val);
                                            }} 
                                            className="w-full text-xs p-1 border border-slate-300 rounded"
                                        />
                                    </div>
                                </div>
                            )}

                            {showColorInput && (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-semibold text-slate-600">Color Heading</label>
                                        <input type="checkbox" checked={config.showColorLegend} onChange={e => updateConfig('showColorLegend', e.target.checked)} className="rounded text-indigo-600 scale-75"/>
                                    </div>
                                    <input type="text" value={config.colorLegendTitle} onChange={e => updateConfig('colorLegendTitle', e.target.value)} disabled={!config.showColorLegend} className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none disabled:bg-slate-100" />
                                </div>
                            )}

                            {showShapeInput && (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-semibold text-slate-600">Shape Heading</label>
                                        <input type="checkbox" checked={config.showShapeLegend} onChange={e => updateConfig('showShapeLegend', e.target.checked)} className="rounded text-indigo-600 scale-75"/>
                                    </div>
                                    <input type="text" value={config.shapeLegendTitle} onChange={e => updateConfig('shapeLegendTitle', e.target.value)} disabled={!config.showShapeLegend} className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none disabled:bg-slate-100" />
                                </div>
                            )}

                            {showTextureInput && (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-semibold text-slate-600">Pattern Heading</label>
                                        <input type="checkbox" checked={config.showTextureLegend} onChange={e => updateConfig('showTextureLegend', e.target.checked)} className="rounded text-indigo-600 scale-75"/>
                                    </div>
                                    <input type="text" value={config.textureLegendTitle} onChange={e => updateConfig('textureLegendTitle', e.target.value)} disabled={!config.showTextureLegend} className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none disabled:bg-slate-100" />
                                </div>
                            )}

                            {showLineInput && (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-semibold text-slate-600">Line Heading</label>
                                        <input type="checkbox" checked={config.showLineTypeLegend} onChange={e => updateConfig('showLineTypeLegend', e.target.checked)} className="rounded text-indigo-600 scale-75"/>
                                    </div>
                                    <input type="text" value={config.lineTypeLegendTitle} onChange={e => updateConfig('lineTypeLegendTitle', e.target.value)} disabled={!config.showLineTypeLegend} className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none disabled:bg-slate-100" />
                                </div>
                            )}

                            <div className="pt-2 border-t border-slate-100 mt-2">
                                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                    Heading Size <span>{config.legendTitleSize}px</span>
                                </label>
                                <div className="flex gap-2 items-center">
                                    <input type="range" min="16" max="500" value={config.legendTitleSize} onChange={e => updateConfig('legendTitleSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                                    <input type="number" min="1" max="999" value={config.legendTitleSize} onChange={e => updateConfig('legendTitleSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                                    Item Size <span>{config.legendItemSize}px</span>
                                </label>
                                <div className="flex gap-2 items-center">
                                    <input type="range" min="12" max="500" value={config.legendItemSize} onChange={e => updateConfig('legendItemSize', parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                                    <input type="number" min="1" max="999" value={config.legendItemSize} onChange={e => updateConfig('legendItemSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center"/>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="h-px bg-slate-200"></div>

                {/* Scale */}
                <div>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Resolution</h3>
                    <div className="flex gap-2">
                        {[1, 2, 3, 4].map(s => (
                            <button 
                                key={s} 
                                onClick={() => updateConfig('scale', s)}
                                className={`flex-1 py-1 text-xs font-bold rounded border ${config.scale === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
                            >
                                {s}x
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 text-center">Higher scale = larger, sharper image.</p>
                </div>

            </div>

            <div className="p-4 border-t border-slate-200 bg-white">
                <button onClick={onClose} className="w-full py-2 mb-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200">
                    Cancel
                </button>
                <button onClick={handleDownload} className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-lg shadow-indigo-200 flex items-center justify-center gap-2">
                    <Download size={16} /> Download Image
                </button>
            </div>
        </div>

        {/* Right: Live Preview */}
        <div className="flex-1 bg-slate-100 flex flex-col relative overflow-hidden">
            <div className="absolute top-4 right-4 z-10 flex gap-2">
                <div className="bg-black/50 text-white px-3 py-1 rounded-full text-xs backdrop-blur font-mono">
                    Preview Mode
                </div>
                <button onClick={onClose} className="bg-white/80 hover:bg-white text-slate-600 p-1.5 rounded-full shadow-sm backdrop-blur">
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
                {isGenerating ? (
                    <div className="flex flex-col items-center gap-3 text-slate-400 animate-pulse">
                        <RefreshCw size={48} className="animate-spin" />
                        <span className="font-semibold">Rendering Preview...</span>
                    </div>
                ) : (
                    previewUrl ? (
                        <div className="relative shadow-2xl border-4 border-white rounded-lg bg-white">
                            <img src={previewUrl} alt="Export Preview" className="max-w-full max-h-[80vh] object-contain" />
                        </div>
                    ) : (
                        <span className="text-slate-400">Preview not available</span>
                    )
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;
