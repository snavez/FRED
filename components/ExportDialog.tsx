
import React, { useState, useEffect, useCallback } from 'react';
import { ExportConfig, PlotHandle, Layer, LayerLegendConfig } from '../types';
import { Download, X, RefreshCw, Type, Link, Link2Off, ChevronDown, ChevronRight, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plotRef: React.RefObject<PlotHandle>;
  layers: Layer[];
  defaultTitle?: string;
  activeTab?: string;
}

// ---------------------------------------------------------------------------
// Base font sizes — readable when exported at 3x and placed in a document
// ---------------------------------------------------------------------------
const BASE_FONT_SIZES = {
  xAxisLabelSize: 96,
  yAxisLabelSize: 96,
  tickLabelSize: 64,
  dataLabelSize: 64,
  legendTitleSize: 96,
  legendItemSize: 64,
  plotTitleSize: 128,
};

// Compute smart ExportConfig defaults from current layers
const computeExportDefaults = (layers: Layer[], defaultTitle?: string): ExportConfig => {
  const visibleLayers = layers.filter(l => l.visible);

  // Legend titles derived from active variable names
  const bg = layers[0]?.config;
  const colorTitle = bg?.colorBy && bg.colorBy !== 'none' ? bg.colorBy.toUpperCase() : 'COLOR';
  const shapeTitle = bg?.shapeBy && bg.shapeBy !== 'none' ? bg.shapeBy.toUpperCase() : 'SHAPE';
  const lineTypeTitle = bg?.lineTypeBy && bg.lineTypeBy !== 'none' ? bg.lineTypeBy.toUpperCase() : 'LINE TYPE';
  const textureTitle = bg?.textureBy && bg.textureBy !== 'none' ? bg.textureBy.toUpperCase() : 'PATTERN';

  // Restore lightweight prefs from localStorage
  const savedScale = parseInt(localStorage.getItem('fred_export_scale') || '3', 10);
  const savedFontScale = parseFloat(localStorage.getItem('fred_export_fontScale') || '1.0');
  const savedLegendPos = (localStorage.getItem('fred_export_legendPosition') || 'right') as ExportConfig['legendPosition'];

  const fs = savedFontScale;

  return {
    scale: [1, 2, 3, 4].includes(savedScale) ? savedScale : 3,
    graphScale: 1.0,
    graphScaleX: 1.0,
    graphScaleY: 1.0,
    graphX: 0,
    graphY: 0,

    xAxisLabelSize: Math.round(BASE_FONT_SIZES.xAxisLabelSize * fs),
    yAxisLabelSize: Math.round(BASE_FONT_SIZES.yAxisLabelSize * fs),
    tickLabelSize: Math.round(BASE_FONT_SIZES.tickLabelSize * fs),
    dataLabelSize: Math.round(BASE_FONT_SIZES.dataLabelSize * fs),

    showPlotTitle: false,
    plotTitle: defaultTitle || 'Vowel Space Plot',
    plotTitleSize: Math.round(BASE_FONT_SIZES.plotTitleSize * fs),
    plotTitleX: 0,
    plotTitleY: 0,

    showLegend: true,
    legendPosition: savedLegendPos,
    legendX: 200,
    legendY: 200,
    legendTitleSize: Math.round(BASE_FONT_SIZES.legendTitleSize * fs),
    legendItemSize: Math.round(BASE_FONT_SIZES.legendItemSize * fs),

    legendLayers: visibleLayers.map(l => l.id),
    layerLegends: layers.map(layer => ({
      layerId: layer.id,
      show: layer.visible,
      colorTitle: layer.config.colorBy !== 'none' ? layer.config.colorBy.toUpperCase() : 'COLOR',
      shapeTitle: layer.config.shapeBy !== 'none' ? layer.config.shapeBy.toUpperCase() : 'SHAPE',
      lineTypeTitle: layer.config.lineTypeBy !== 'none' ? layer.config.lineTypeBy.toUpperCase() : 'LINE TYPE',
      textureTitle: layer.config.textureBy !== 'none' ? layer.config.textureBy.toUpperCase() : 'PATTERN',
    })),

    showColorLegend: true,
    colorLegendTitle: colorTitle,
    showShapeLegend: true,
    shapeLegendTitle: shapeTitle,
    showTextureLegend: true,
    textureLegendTitle: textureTitle,
    showLineTypeLegend: true,
    lineTypeLegendTitle: lineTypeTitle,
  };
};

// ---------------------------------------------------------------------------
// Compute legend absolute canvas coordinates for a given position mode (at drawScale=1)
// Mirrors the logic in CanvasPlot.tsx generateImage()
// ---------------------------------------------------------------------------
function computeLegendPosition(cfg: ExportConfig): { x: number; y: number } {
  const graphScaleX = cfg.graphScaleX || cfg.graphScale || 1.0;
  const graphScaleY = cfg.graphScaleY || cfg.graphScale || 1.0;
  const graphX = cfg.graphX || 0;
  const graphY = cfg.graphY || 0;
  const basePlotWidth = 2400 * graphScaleX;
  const basePlotHeight = 2000 * graphScaleY;
  const marginLeft = 200 + graphX;
  const marginTop = (cfg.showPlotTitle ? 200 : 100) + graphY;

  switch (cfg.legendPosition) {
    case 'right':
      return { x: marginLeft + basePlotWidth + 40, y: marginTop };
    case 'bottom':
      return { x: marginLeft, y: marginTop + basePlotHeight + 150 };
    case 'inside-top-right':
      return { x: marginLeft + basePlotWidth - 300, y: marginTop + 40 };
    case 'inside-top-left':
      return { x: marginLeft + 40, y: marginTop + 40 };
    case 'custom':
      return { x: Number(cfg.legendX) || 0, y: Number(cfg.legendY) || 0 };
    default:
      return { x: marginLeft + basePlotWidth + 40, y: marginTop };
  }
}

// ---------------------------------------------------------------------------
// NudgePad — directional arrows + reset for X/Y offset positioning
// ---------------------------------------------------------------------------
const NudgePad: React.FC<{
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  step?: number;
  label?: string;
}> = ({ x, y, onChange, step = 10, label }) => {
  const nudge = (dx: number, dy: number, e: React.MouseEvent) => {
    let mult = 1;
    if (e.shiftKey) mult = 0.2;
    if (e.ctrlKey || e.metaKey) mult = 5;
    onChange(
      Math.round((x + dx * step * mult) * 10) / 10,
      Math.round((y + dy * step * mult) * 10) / 10
    );
  };

  const hasOffset = x !== 0 || y !== 0;

  return (
    <div className="bg-slate-100 rounded p-1.5">
      {label && <div className="text-[9px] font-bold text-slate-400 uppercase mb-1 text-center">{label}</div>}
      <div className="flex items-center justify-center gap-0.5">
        <button onClick={e => nudge(-1, 0, e)} className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700" title="Nudge left (Shift=fine, Ctrl=coarse)">
          <ArrowLeft size={10} />
        </button>
        <div className="flex flex-col gap-0.5">
          <button onClick={e => nudge(0, -1, e)} className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700" title="Nudge up">
            <ArrowUp size={10} />
          </button>
          <button
            onClick={() => onChange(0, 0)}
            className={`w-6 h-6 flex items-center justify-center rounded border text-[8px] font-bold ${hasOffset ? 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100' : 'bg-slate-50 border-slate-200 text-slate-300'}`}
            title="Reset to 0,0"
          >
            <RotateCcw size={8} />
          </button>
          <button onClick={e => nudge(0, 1, e)} className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700" title="Nudge down">
            <ArrowDown size={10} />
          </button>
        </div>
        <button onClick={e => nudge(1, 0, e)} className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700" title="Nudge right">
          <ArrowRight size={10} />
        </button>
      </div>
      {hasOffset && (
        <div className="text-[8px] text-slate-400 text-center mt-0.5 font-mono">
          {x}, {y}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CollapsibleSection — expand/collapse with indicator dot for non-default
// ---------------------------------------------------------------------------
const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  hasChanges?: boolean;
  rightElement?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, hasChanges = false, rightElement, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-2.5 px-1 text-left group"
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider group-hover:text-slate-700">{title}</h3>
          {hasChanges && <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
        </div>
        {rightElement && <div onClick={e => e.stopPropagation()}>{rightElement}</div>}
      </button>
      {open && (
        <div className="pb-3 px-1 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
          {children}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main ExportDialog Component
// ---------------------------------------------------------------------------
const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose, plotRef, layers, defaultTitle, activeTab }) => {
  const [config, setConfig] = useState<ExportConfig>(() => computeExportDefaults(layers, defaultTitle));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [linkAxes, setLinkAxes] = useState(true);
  const [linkGraphScale, setLinkGraphScale] = useState(true);
  const [fontScale, setFontScale] = useState(() => parseFloat(localStorage.getItem('fred_export_fontScale') || '1.0'));

  // Recompute defaults when dialog opens
  useEffect(() => {
    if (isOpen) {
      const defaults = computeExportDefaults(layers, defaultTitle);
      setConfig(defaults);
      setFontScale(parseFloat(localStorage.getItem('fred_export_fontScale') || '1.0'));
    }
  }, [isOpen, layers, defaultTitle]);

  // Persist lightweight prefs
  useEffect(() => {
    if (isOpen) {
      localStorage.setItem('fred_export_scale', String(config.scale));
      localStorage.setItem('fred_export_legendPosition', config.legendPosition || 'right');
    }
  }, [config.scale, config.legendPosition, isOpen]);

  const handleFontScaleChange = useCallback((newScale: number) => {
    setFontScale(newScale);
    localStorage.setItem('fred_export_fontScale', String(newScale));
    setConfig(prev => ({
      ...prev,
      xAxisLabelSize: Math.round(BASE_FONT_SIZES.xAxisLabelSize * newScale),
      yAxisLabelSize: Math.round(BASE_FONT_SIZES.yAxisLabelSize * newScale),
      tickLabelSize: Math.round(BASE_FONT_SIZES.tickLabelSize * newScale),
      dataLabelSize: Math.round(BASE_FONT_SIZES.dataLabelSize * newScale),
      legendTitleSize: Math.round(BASE_FONT_SIZES.legendTitleSize * newScale),
      legendItemSize: Math.round(BASE_FONT_SIZES.legendItemSize * newScale),
      plotTitleSize: Math.round(BASE_FONT_SIZES.plotTitleSize * newScale),
    }));
  }, []);

  const handleResetAll = useCallback(() => {
    const defaults = computeExportDefaults(layers, defaultTitle);
    setConfig(defaults);
    setFontScale(1.0);
    setLinkAxes(true);
    setLinkGraphScale(true);
    localStorage.setItem('fred_export_fontScale', '1.0');
  }, [layers, defaultTitle]);

  // Live preview — debounced to avoid flashing on rapid nudges
  const hasPreview = previewUrl !== null;
  useEffect(() => {
    if (isOpen && plotRef.current) {
      // Only show spinner on first render; incremental updates stay quiet
      if (!hasPreview) setIsGenerating(true);
      const timer = setTimeout(() => {
        if (plotRef.current) {
          const previewConfig = { ...config, scale: 1 };
          const url = plotRef.current.generateImage(previewConfig);
          setPreviewUrl(url);
          setIsGenerating(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [config, isOpen, plotRef]);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (!plotRef.current) return;
    // Generate at full resolution for download
    const fullUrl = plotRef.current.generateImage(config);
    if (fullUrl) {
      const link = document.createElement('a');
      link.download = `fred_export_${Date.now()}.png`;
      link.href = fullUrl;
      link.click();
      onClose();
    }
  };

  const updateConfig = (key: keyof ExportConfig, val: any) => {
    setConfig(prev => {
      const updates: Partial<ExportConfig> = { [key]: val };
      if (linkAxes) {
        if (key === 'xAxisLabelSize') updates.yAxisLabelSize = val;
        if (key === 'yAxisLabelSize') updates.xAxisLabelSize = val;
      }
      if (linkGraphScale && (key === 'graphScale' || key === 'graphScaleX' || key === 'graphScaleY')) {
        if (key === 'graphScale') { updates.graphScaleX = val; updates.graphScaleY = val; }
        if (key === 'graphScaleX') { updates.graphScale = val; updates.graphScaleY = val; }
        if (key === 'graphScaleY') { updates.graphScale = val; updates.graphScaleX = val; }
      }
      return { ...prev, ...updates };
    });
  };

  const toggleLegendLayer = (layerId: string) => {
    setConfig(prev => {
      const current = prev.legendLayers || [];
      const updated = current.includes(layerId)
        ? current.filter(id => id !== layerId)
        : [...current, layerId];
      return { ...prev, legendLayers: updated };
    });
  };

  const updateLayerLegend = (layerId: string, field: keyof LayerLegendConfig, value: any) => {
    setConfig(prev => {
      const layerLegends = (prev.layerLegends || []).map(ll =>
        ll.layerId === layerId ? { ...ll, [field]: value } : ll
      );
      return { ...prev, layerLegends };
    });
  };

  const legendLayerIds = config.legendLayers || [];

  // Check if various sections have non-default values (for indicator dots)
  const hasGeometryChanges = (config.graphScale || 1) !== 1 || (config.graphX || 0) !== 0 || (config.graphY || 0) !== 0;
  const hasTitleChanges = !!config.showPlotTitle;
  const hasAxisChanges = config.xAxisLabelSize !== Math.round(BASE_FONT_SIZES.xAxisLabelSize * fontScale)
    || (config.xAxisLabelX || 0) !== 0 || (config.xAxisLabelY || 0) !== 0
    || (config.yAxisLabelX || 0) !== 0 || (config.yAxisLabelY || 0) !== 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex overflow-hidden border border-slate-200">

        {/* Left: Configuration Controls */}
        <div className="w-80 flex-shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <Type size={18} className="text-sky-700" />
              Export Settings
            </h2>
            <button
              onClick={handleResetAll}
              className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 flex items-center gap-1"
              title="Reset all settings to defaults"
            >
              <RotateCcw size={10} /> Reset
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1">

            {/* ============ QUICK SETTINGS (always visible) ============ */}
            <div className="space-y-3 pb-3 border-b border-slate-200">
              {/* Resolution */}
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Resolution</h3>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(s => (
                    <button
                      key={s}
                      onClick={() => updateConfig('scale', s)}
                      className={`flex-1 py-1 text-xs font-bold rounded border transition-colors ${config.scale === s ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 text-center">Higher = sharper image for print</p>
              </div>

              {/* Global Font Scale */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Font Scale</h3>
                  <span className="text-xs font-bold text-sky-700">{fontScale.toFixed(1)}x</span>
                </div>
                <input
                  type="range" min="0.5" max="3.0" step="0.1"
                  value={fontScale}
                  onChange={e => handleFontScaleChange(parseFloat(e.target.value))}
                  className="w-full accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-0.5 text-center">Scales all text proportionally</p>
              </div>
            </div>

            {/* ============ COLLAPSIBLE SECTIONS ============ */}

            {/* --- Chart Title --- */}
            <CollapsibleSection
              title="Chart Title"
              hasChanges={hasTitleChanges}
              rightElement={
                <input
                  type="checkbox"
                  checked={!!config.showPlotTitle}
                  onChange={e => updateConfig('showPlotTitle', e.target.checked)}
                  className="rounded text-sky-700 scale-75"
                />
              }
            >
              {config.showPlotTitle && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={config.plotTitle || ''}
                    onChange={e => updateConfig('plotTitle', e.target.value)}
                    className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="Enter chart title..."
                  />
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                      Size <span>{config.plotTitleSize}px</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="24" max="500" value={config.plotTitleSize || 128} onChange={e => updateConfig('plotTitleSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      <input type="number" min="1" max="999" value={config.plotTitleSize || 128} onChange={e => updateConfig('plotTitleSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                    </div>
                  </div>
                  <NudgePad
                    x={config.plotTitleX || 0}
                    y={config.plotTitleY || 0}
                    onChange={(nx, ny) => setConfig(prev => ({ ...prev, plotTitleX: nx, plotTitleY: ny }))}
                    label="Position Offset"
                  />
                </div>
              )}
              {!config.showPlotTitle && (
                <p className="text-[10px] text-slate-400 italic">Enable the checkbox above to add a title.</p>
              )}
            </CollapsibleSection>

            {/* --- Graph Geometry --- */}
            <CollapsibleSection
              title="Graph Geometry"
              hasChanges={hasGeometryChanges}
              rightElement={
                <button onClick={() => setLinkGraphScale(!linkGraphScale)} className="text-slate-400 hover:text-sky-700" title={linkGraphScale ? "Unlink X/Y Scale" : "Link X/Y Scale"}>
                  {linkGraphScale ? <Link size={14} /> : <Link2Off size={14} />}
                </button>
              }
            >
              {linkGraphScale ? (
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                    Graph Scale <span>{config.graphScale?.toFixed(2) || '1.00'}x</span>
                  </label>
                  <div className="flex gap-2 items-center">
                    <input type="range" min="0.1" max="3.0" step="0.05" value={config.graphScale || 1.0} onChange={e => updateConfig('graphScale', parseFloat(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                    <input type="number" min="0.1" max="3.0" step="0.1" value={config.graphScale || 1.0} onChange={e => updateConfig('graphScale', parseFloat(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                      X Scale <span>{config.graphScaleX?.toFixed(2) || '1.00'}x</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="0.1" max="3.0" step="0.05" value={config.graphScaleX || 1.0} onChange={e => updateConfig('graphScaleX', parseFloat(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      <input type="number" min="0.1" max="3.0" step="0.1" value={config.graphScaleX || 1.0} onChange={e => updateConfig('graphScaleX', parseFloat(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                      Y Scale <span>{config.graphScaleY?.toFixed(2) || '1.00'}x</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="0.1" max="3.0" step="0.05" value={config.graphScaleY || 1.0} onChange={e => updateConfig('graphScaleY', parseFloat(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      <input type="number" min="0.1" max="3.0" step="0.1" value={config.graphScaleY || 1.0} onChange={e => updateConfig('graphScaleY', parseFloat(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                    </div>
                  </div>
                </div>
              )}
              <NudgePad
                x={config.graphX || 0}
                y={config.graphY || 0}
                onChange={(nx, ny) => setConfig(prev => ({ ...prev, graphX: nx, graphY: ny }))}
                label="Graph Offset"
              />
            </CollapsibleSection>

            {/* --- Axis Labels --- */}
            <CollapsibleSection
              title="Axis Labels"
              hasChanges={hasAxisChanges}
              rightElement={
                <button onClick={() => setLinkAxes(!linkAxes)} className="text-slate-400 hover:text-sky-700" title={linkAxes ? "Unlink Axes" : "Link Axes"}>
                  {linkAxes ? <Link size={14} /> : <Link2Off size={14} />}
                </button>
              }
            >
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                  X Axis Label <span>{config.xAxisLabelSize}px</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="12" max="500" value={config.xAxisLabelSize} onChange={e => updateConfig('xAxisLabelSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  <input type="number" min="1" max="999" value={config.xAxisLabelSize} onChange={e => updateConfig('xAxisLabelSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                </div>
                <NudgePad
                  x={config.xAxisLabelX || 0}
                  y={config.xAxisLabelY || 0}
                  onChange={(nx, ny) => setConfig(prev => ({ ...prev, xAxisLabelX: nx, xAxisLabelY: ny }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                  Y Axis Label <span>{config.yAxisLabelSize}px</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="12" max="500" value={config.yAxisLabelSize} onChange={e => updateConfig('yAxisLabelSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  <input type="number" min="1" max="999" value={config.yAxisLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('yAxisLabelSize', isNaN(v) ? 12 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                </div>
                <NudgePad
                  x={config.yAxisLabelX || 0}
                  y={config.yAxisLabelY || 0}
                  onChange={(nx, ny) => setConfig(prev => ({ ...prev, yAxisLabelX: nx, yAxisLabelY: ny }))}
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                  Tick Numbers <span>{config.tickLabelSize}px</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="10" max="500" value={config.tickLabelSize} onChange={e => updateConfig('tickLabelSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  <input type="number" min="1" max="999" value={config.tickLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('tickLabelSize', isNaN(v) ? 10 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <NudgePad
                    x={config.xAxisTickX || 0}
                    y={config.xAxisTickY || 0}
                    onChange={(nx, ny) => setConfig(prev => ({ ...prev, xAxisTickX: nx, xAxisTickY: ny }))}
                    label="X-Axis Ticks"
                    step={5}
                  />
                  <NudgePad
                    x={config.yAxisTickX || 0}
                    y={config.yAxisTickY || 0}
                    onChange={(nx, ny) => setConfig(prev => ({ ...prev, yAxisTickX: nx, yAxisTickY: ny }))}
                    label="Y-Axis Ticks"
                    step={5}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                  Data Labels <span>{config.dataLabelSize}px</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="8" max="500" value={config.dataLabelSize} onChange={e => updateConfig('dataLabelSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  <input type="number" min="1" max="999" value={config.dataLabelSize} onChange={e => { const v = parseInt(e.target.value); updateConfig('dataLabelSize', isNaN(v) ? 8 : v); }} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                </div>
              </div>
            </CollapsibleSection>

            {/* --- Legend --- */}
            <CollapsibleSection
              title="Legend"
              defaultOpen={true}
              rightElement={
                <button
                  onClick={() => updateConfig('showLegend', !config.showLegend)}
                  className={`text-xs px-2 py-0.5 rounded font-bold transition-colors ${config.showLegend ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}
                >
                  {config.showLegend ? 'ON' : 'OFF'}
                </button>
              }
            >
              {config.showLegend && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Position</label>
                    <select
                      value={config.legendPosition}
                      onChange={e => {
                        const newPos = e.target.value;
                        if (newPos === 'custom') {
                          // Compute current legend position so it visually stays in place
                          const currentPos = computeLegendPosition(config);
                          setConfig(prev => ({
                            ...prev,
                            legendPosition: 'custom',
                            legendX: Math.round(currentPos.x),
                            legendY: Math.round(currentPos.y),
                          }));
                        } else {
                          updateConfig('legendPosition', newPos);
                        }
                      }}
                      className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-sky-500 outline-none bg-white"
                    >
                      <option value="right">Right (Outside)</option>
                      <option value="bottom">Bottom (Outside)</option>
                      <option value="inside-top-right">Inside (Top Right)</option>
                      <option value="inside-top-left">Inside (Top Left)</option>
                      <option value="custom">Custom Position</option>
                    </select>
                  </div>

                  {config.legendPosition === 'custom' && (
                    <NudgePad
                      x={config.legendX || 0}
                      y={config.legendY || 0}
                      onChange={(nx, ny) => setConfig(prev => ({ ...prev, legendX: nx, legendY: ny }))}
                      label="Legend Position"
                      step={20}
                    />
                  )}

                  {/* Per-layer legend controls */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Layers</h4>
                    {layers.map(layer => {
                      const llCfg = (config.layerLegends || []).find(ll => ll.layerId === layer.id);
                      const isInLegend = legendLayerIds.includes(layer.id);

                      return (
                        <div key={layer.id} className="space-y-1 pb-2 border-b border-slate-100 last:border-b-0">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isInLegend}
                              onChange={() => toggleLegendLayer(layer.id)}
                              className="rounded text-sky-700 scale-75"
                            />
                            <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[8px] font-black ${
                              layer.config.plotType === 'trajectory' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                            }`}>
                              {layer.config.plotType === 'trajectory' ? 'T' : 'P'}
                            </span>
                            <span className="text-xs font-semibold text-slate-600">{layer.name}</span>
                          </div>
                          {isInLegend && llCfg && (
                            <div className="pl-5 space-y-1">
                              {layer.config.colorBy !== 'none' && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-400 w-12">Color</span>
                                  <input
                                    type="text"
                                    value={llCfg.colorTitle}
                                    onChange={e => updateLayerLegend(layer.id, 'colorTitle', e.target.value)}
                                    className="flex-1 text-[10px] p-0.5 border border-slate-200 rounded"
                                    placeholder={layer.config.colorBy.toUpperCase()}
                                  />
                                </div>
                              )}
                              {layer.config.shapeBy !== 'none' && layer.config.shapeBy !== layer.config.colorBy && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-400 w-12">Shape</span>
                                  <input
                                    type="text"
                                    value={llCfg.shapeTitle}
                                    onChange={e => updateLayerLegend(layer.id, 'shapeTitle', e.target.value)}
                                    className="flex-1 text-[10px] p-0.5 border border-slate-200 rounded"
                                    placeholder={layer.config.shapeBy.toUpperCase()}
                                  />
                                </div>
                              )}
                              {layer.config.lineTypeBy !== 'none' && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-400 w-12">Line</span>
                                  <input
                                    type="text"
                                    value={llCfg.lineTypeTitle}
                                    onChange={e => updateLayerLegend(layer.id, 'lineTypeTitle', e.target.value)}
                                    className="flex-1 text-[10px] p-0.5 border border-slate-200 rounded"
                                    placeholder={layer.config.lineTypeBy.toUpperCase()}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                      Heading Size <span>{config.legendTitleSize}px</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="16" max="500" value={config.legendTitleSize} onChange={e => updateConfig('legendTitleSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      <input type="number" min="1" max="999" value={config.legendTitleSize} onChange={e => updateConfig('legendTitleSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                      Item Size <span>{config.legendItemSize}px</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="12" max="500" value={config.legendItemSize} onChange={e => updateConfig('legendItemSize', parseInt(e.target.value))} className="flex-1 accent-slate-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      <input type="number" min="1" max="999" value={config.legendItemSize} onChange={e => updateConfig('legendItemSize', parseInt(e.target.value))} className="w-16 text-xs p-1 border border-slate-300 rounded text-center" />
                    </div>
                  </div>
                </>
              )}
              {!config.showLegend && (
                <p className="text-[10px] text-slate-400 italic">Legend is hidden. Toggle ON above to configure.</p>
              )}
            </CollapsibleSection>

          </div>

          {/* Action buttons */}
          <div className="p-4 border-t border-slate-200 bg-white">
            <button onClick={onClose} className="w-full py-2 mb-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200">
              Cancel
            </button>
            <button onClick={handleDownload} className="w-full py-2.5 text-sm font-bold text-white bg-slate-600 hover:bg-slate-700 rounded-lg shadow-lg shadow-slate-200 flex items-center justify-center gap-2">
              <Download size={16} /> Download Image
            </button>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="flex-1 bg-slate-100 flex flex-col relative overflow-hidden">
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <div className="bg-black/50 text-white px-3 py-1 rounded-full text-xs backdrop-blur font-mono">
              Preview ({config.scale}x)
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
            ) : previewUrl ? (
              <div className="relative shadow-2xl border-4 border-white rounded-lg bg-white">
                <img src={previewUrl} alt="Export Preview" className="max-w-full max-h-[80vh] object-contain" />
              </div>
            ) : (
              <span className="text-slate-400">Preview not available</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;
