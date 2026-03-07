
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { SpeechToken, PlotConfig, ReferenceCentroid, PlotHandle, VariableType, StyleOverrides, Layer } from '../types';
import CanvasPlot from './CanvasPlot';
import TrajectoryTimeSeries from './TrajectoryTimeSeries';
import TrajectoryF1F2 from './TrajectoryF1F2';
import DurationPlot from './DurationPlot';
import PhonemeDistributionPlot from './PhonemeDistributionPlot';
import Scatter3DPlot from './Scatter3DPlot';
import StyleEditor from './StyleEditor';
import ExportDialog from './ExportDialog';
import { Grid, LineChart, Table, Settings2, MoveUpRight, Printer, Check, Download, BarChart2, PieChart, Box, Waves, ArrowDown, ArrowUp, ArrowUpDown, Eye, EyeOff, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';

interface MainDisplayProps {
  layers: Layer[];
  layerData: Record<string, SpeechToken[]>;
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  updateLayerConfig: (layerId: string, key: keyof PlotConfig, value: any) => void;
  addLayer: (type: 'point' | 'trajectory') => void;
  removeLayer: (layerId: string) => void;
  reorderLayer: (layerId: string, direction: 'up' | 'down') => void;
  toggleLayerVisibility: (layerId: string) => void;
  renameLayer: (layerId: string, newName: string) => void;
  setActiveConfig: React.Dispatch<React.SetStateAction<PlotConfig>>;
  globalReferences?: ReferenceCentroid[];
  updateStyleOverride: (fieldKey: 'colors' | 'shapes' | 'textures' | 'lineTypes', category: string, value: any, layerId?: string) => void;
}

const VARIABLE_OPTIONS: { label: string, value: VariableType }[] = [
  { label: 'None', value: 'none' },
  { label: 'Phoneme', value: 'phoneme' },
  { label: 'Word', value: 'word' },
  { label: 'Allophone', value: 'produced' },
  { label: 'Alignment', value: 'alignment' },
  { label: 'Expected Stress', value: 'canonical_stress' },
  { label: 'Transcr. Stress', value: 'lexical_stress' },
  { label: 'Syllable Mark', value: 'syllable_mark' },
  { label: 'Voice Pitch', value: 'voice_pitch' },
];

const MainDisplay: React.FC<MainDisplayProps> = ({
  layers, layerData, activeLayerId, setActiveLayerId,
  updateLayerConfig, addLayer, removeLayer, reorderLayer,
  toggleLayerVisibility, renameLayer, setActiveConfig,
  globalReferences = [], updateStyleOverride
}) => {
  const [activeTab, setActiveTab] = useState<'vowel' | '3d' | 'traj_f1f2' | 'traj_series' | 'duration' | 'dist' | 'table'>('vowel');
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingLayerName, setEditingLayerName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Style overrides derived from active layer (no local state needed)
  const styleOverrides = useMemo(() => {
    const layer = layers.find(l => l.id === activeLayerId);
    return layer?.styleOverrides || { colors: {}, shapes: {}, textures: {}, lineTypes: {} };
  }, [layers, activeLayerId]);

  // Editor State
  const [editingItem, setEditingItem] = useState<{
    category: string;
    position: { x: number, y: number };
    currentStyles: { color: string, shape: string, texture: number, lineType: string };
    layerId?: string;
  } | null>(null);

  const plotRef = useRef<PlotHandle>(null);

  // Derived: active layer & its config
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);
  const currentConfig = activeLayer.config;
  // Background config for things that always use background (ranges, etc.)
  const bgConfig = layers[0].config;
  // Active layer data — used by non-F1/F2 plots so sidebar filters affect all views
  const activeData = layerData[activeLayerId] || [];

  const handleConfig = (key: keyof PlotConfig, val: any) => {
      updateLayerConfig(activeLayerId, key, val);
  };

  const toggleReferenceVowel = (vowel: string) => {
    setActiveConfig(prev => {
      const current = prev.selectedReferenceVowels;
      if (current.includes(vowel)) {
        return { ...prev, selectedReferenceVowels: current.filter(v => v !== vowel) };
      }
      return { ...prev, selectedReferenceVowels: [...current, vowel] };
    });
  };

  const selectAllRefVowels = () => {
     setActiveConfig(prev => ({ ...prev, selectedReferenceVowels: globalReferences.map(r => r.canonical) }));
  };

  const clearRefVowels = () => {
    setActiveConfig(prev => ({ ...prev, selectedReferenceVowels: [] }));
  };

  const availablePitches = useMemo(() => Array.from(new Set(activeData.map(t => t.voice_pitch))).filter(Boolean).sort(), [activeData]);

  const togglePitchFilter = (p: string) => {
      setActiveConfig(prev => {
          const current = prev.referencePitchFilter || [];
          if (current.includes(p)) return { ...prev, referencePitchFilter: current.filter(v => v !== p) };
          return { ...prev, referencePitchFilter: [...current, p] };
      });
  };

  const handleExportClick = () => {
    setShowExportDialog(true);
  };

  const handleLegendClick = useCallback((category: string, currentStyles: { color: string, shape: string, texture: number, lineType: string }, event: React.MouseEvent, layerId?: string) => {
    setEditingItem({
      category,
      currentStyles,
      position: { x: event.clientX + 10, y: event.clientY + 10 },
      layerId
    });
  }, []);

  const handleStyleUpdate = (type: 'color' | 'shape' | 'texture' | 'lineType', value: any) => {
    if (!editingItem) return;
    const fieldKey = type === 'color' ? 'colors' : type === 'shape' ? 'shapes' : type === 'texture' ? 'textures' : 'lineTypes';
    // Update the specific layer (or active layer if no layerId)
    updateStyleOverride(fieldKey, editingItem.category, value, editingItem.layerId);
    setEditingItem(prev => prev ? ({
        ...prev,
        currentStyles: { ...prev.currentStyles, [type]: value }
    }) : null);
  };

  const getActiveChannels = () => {
    const active = { color: false, shape: false, texture: false, lineType: false };
    if (currentConfig.colorBy !== 'none') active.color = true;
    if ((activeTab === 'vowel' || activeTab === '3d') && currentConfig.shapeBy !== 'none') active.shape = true;
    if ((activeTab === 'vowel' || activeTab === 'traj_f1f2' || activeTab === 'traj_series') && currentConfig.lineTypeBy !== 'none') active.lineType = true;
    if ((activeTab === 'dist' || activeTab === 'duration') && currentConfig.textureBy !== 'none') active.texture = true;
    return active;
  };

  const renderVariableSelect = (label: string, value: VariableType, onChange: (v: VariableType) => void) => (
    <div className="flex items-center gap-2">
      <label className="font-semibold text-slate-600">{label}:</label>
      <select
        className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 max-w-[120px]"
        value={value}
        onChange={e => onChange(e.target.value as VariableType)}
      >
        {VARIABLE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  const startRename = (layerId: string, currentName: string) => {
    setEditingLayerName(layerId);
    setEditingNameValue(currentName);
  };

  const commitRename = () => {
    if (editingLayerName && editingNameValue.trim()) {
      renameLayer(editingLayerName, editingNameValue.trim());
    }
    setEditingLayerName(null);
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Top Bar: Tabs + Toolbar */}
      <div className="flex flex-col space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex bg-white p-1 rounded-lg border border-slate-200 w-fit shadow-sm overflow-x-auto">
            <button onClick={() => setActiveTab('vowel')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'vowel' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Grid size={16} /><span>F1/F2</span></button>
            <button onClick={() => setActiveTab('3d')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === '3d' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Box size={16} /><span>3D F1/F2/F3</span></button>
            <button onClick={() => setActiveTab('traj_series')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'traj_series' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><LineChart size={16} /><span>Time Series</span></button>
            <button onClick={() => setActiveTab('duration')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'duration' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><BarChart2 size={16} /><span>Duration</span></button>
            <button onClick={() => setActiveTab('dist')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'dist' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><PieChart size={16} /><span>Phoneme Dist.</span></button>
            <button onClick={() => setActiveTab('table')} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'table' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Table size={16} /><span>Table</span></button>
          </div>

          {/* Layer Panel for F1/F2 Tab */}
          {activeTab === 'vowel' && (
             <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-sm relative">
                {/* Add Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    disabled={layers.length >= 10}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-all ${layers.length >= 10 ? 'text-slate-300 cursor-not-allowed' : 'text-indigo-600 hover:bg-indigo-50'}`}
                  >
                    <Plus size={12} />
                    <span>Add</span>
                  </button>
                  {showAddMenu && layers.length < 10 && (
                    <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                      <button
                        onClick={() => { addLayer('point'); setShowAddMenu(false); }}
                        className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                      >
                        <span className="w-4 h-4 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-black">P</span>
                        Point Layer
                      </button>
                      <button
                        onClick={() => { addLayer('trajectory'); setShowAddMenu(false); }}
                        className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                      >
                        <span className="w-4 h-4 rounded bg-emerald-100 text-emerald-600 flex items-center justify-center text-[9px] font-black">T</span>
                        Trajectory Layer
                      </button>
                    </div>
                  )}
                </div>

                <div className="w-px h-5 bg-slate-200"></div>

                {/* Layer Chips */}
                {layers.map((layer, idx) => (
                  <div
                    key={layer.id}
                    className={`flex items-center gap-0.5 px-2 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                      activeLayerId === layer.id
                        ? 'bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200'
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                    onClick={() => setActiveLayerId(layer.id)}
                  >
                    {/* Type badge */}
                    <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[8px] font-black shrink-0 ${
                      layer.config.plotType === 'trajectory'
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-blue-100 text-blue-600'
                    }`}>
                      {layer.config.plotType === 'trajectory' ? 'T' : 'P'}
                    </span>

                    {/* Name (editable on double-click) */}
                    {editingLayerName === layer.id ? (
                      <input
                        type="text"
                        className="w-16 text-[10px] p-0.5 border rounded bg-white text-slate-700 outline-none"
                        value={editingNameValue}
                        onChange={e => setEditingNameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingLayerName(null); }}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="truncate max-w-[60px]"
                        onDoubleClick={(e) => { e.stopPropagation(); startRename(layer.id, layer.name); }}
                        title={layer.name}
                      >
                        {layer.name}
                      </span>
                    )}

                    {/* Visibility toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                      className="p-0.5 hover:bg-slate-200 rounded"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {layer.visible ? <Eye size={10} /> : <EyeOff size={10} className="text-slate-300" />}
                    </button>

                    {/* Reorder & Delete (non-background only) */}
                    {!layer.isBackground && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'up'); }}
                          className="p-0.5 hover:bg-slate-200 rounded"
                          title="Move up"
                          disabled={idx <= 1}
                        >
                          <ChevronUp size={10} className={idx <= 1 ? 'text-slate-200' : ''} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'down'); }}
                          className="p-0.5 hover:bg-slate-200 rounded"
                          title="Move down"
                          disabled={idx >= layers.length - 1}
                        >
                          <ChevronDown size={10} className={idx >= layers.length - 1 ? 'text-slate-200' : ''} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                          className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-500"
                          title="Delete layer"
                        >
                          <X size={10} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
             </div>
          )}

          {activeTab !== 'table' && (
             <div className="flex items-center gap-2">
               <button onClick={handleExportClick} className="flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"><Download size={14} /><span>Export</span></button>
               <button onClick={() => handleConfig('bwMode', !currentConfig.bwMode)} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${currentConfig.bwMode ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}><Printer size={14} /><span>B&W</span></button>
             </div>
          )}
        </div>

        {/* Dynamic Config Toolbar */}
        {activeTab !== 'table' && (
          <div className="bg-slate-100 rounded-lg p-3 border border-slate-200 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <Settings2 size={14} />
              <span>Config</span>
            </div>

            <div className="h-6 w-px bg-slate-300"></div>

            {/* Config: Smoothing Toggle */}
            {(activeTab === 'vowel' || activeTab === '3d' || activeTab === 'traj_f1f2' || activeTab === 'traj_series') && (
                <div className="flex items-center gap-1.5 mr-2">
                    <span className="font-semibold text-slate-600">Data:</span>
                    <button
                        onClick={() => handleConfig('useSmoothing', !currentConfig.useSmoothing)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border transition-all ${currentConfig.useSmoothing ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}`}
                        title="Toggle between Raw and Smoothed Data"
                    >
                        <Waves size={12} />
                        <span>{currentConfig.useSmoothing ? 'Smooth' : 'Raw'}</span>
                    </button>
                </div>
            )}

            {/* Range Controls (Context Sensitive) */}
            <div className="flex items-center gap-2 border-r border-slate-300 pr-4 mr-2">
                 {(activeTab === 'vowel' || activeTab === '3d' || activeTab === 'traj_f1f2') && (
                    <div className="flex flex-col gap-1">
                       <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500 w-6">F1 Min</span>
                          <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [parseInt(e.target.value), bgConfig.f1Range[1]])} />
                       </div>
                       <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500 w-6">F1 Max</span>
                          <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [bgConfig.f1Range[0], parseInt(e.target.value)])} />
                       </div>
                    </div>
                 )}
                 {(activeTab === 'vowel' || activeTab === '3d' || activeTab === 'traj_f1f2') && (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold text-slate-500 w-6">F2 Min</span>
                            <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [parseInt(e.target.value), bgConfig.f2Range[1]])} />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold text-slate-500 w-6">F2 Max</span>
                            <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [bgConfig.f2Range[0], parseInt(e.target.value)])} />
                        </div>
                    </div>
                 )}
                 {activeTab === 'traj_series' && (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold text-slate-500 w-8">Freq Min</span>
                            <input type="number" step="100" className="w-16 p-0.5 border rounded text-[10px]" value={bgConfig.timeSeriesFrequencyRange ? bgConfig.timeSeriesFrequencyRange[0] : 0} onChange={e => updateLayerConfig(layers[0].id, 'timeSeriesFrequencyRange', [parseInt(e.target.value), bgConfig.timeSeriesFrequencyRange[1]])} />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold text-slate-500 w-8">Freq Max</span>
                            <input type="number" step="100" className="w-16 p-0.5 border rounded text-[10px]" value={bgConfig.timeSeriesFrequencyRange ? bgConfig.timeSeriesFrequencyRange[1] : 4000} onChange={e => updateLayerConfig(layers[0].id, 'timeSeriesFrequencyRange', [bgConfig.timeSeriesFrequencyRange[0], parseInt(e.target.value)])} />
                        </div>
                    </div>
                 )}
                 {activeTab === '3d' && (
                     <div className="flex flex-col gap-1">
                         <div className="flex items-center gap-1">
                             <span className="text-[9px] font-bold text-slate-500 w-6">F3 Min</span>
                             <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f3Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f3Range', [parseInt(e.target.value), bgConfig.f3Range[1]])} />
                         </div>
                         <div className="flex items-center gap-1">
                             <span className="text-[9px] font-bold text-slate-500 w-6">F3 Max</span>
                             <input type="number" step="100" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f3Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f3Range', [bgConfig.f3Range[0], parseInt(e.target.value)])} />
                         </div>
                     </div>
                 )}
                 {activeTab === 'duration' && (
                     <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Max Duration (s)</span>
                        <input type="number" step="0.1" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.durationRange[1]} onChange={e => updateLayerConfig(layers[0].id, 'durationRange', [0, parseFloat(e.target.value)])} />
                     </div>
                 )}
                 {activeTab === 'dist' && (
                     <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Max Count</span>
                        <input type="number" step="10" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.countRange[1]} onChange={e => updateLayerConfig(layers[0].id, 'countRange', [0, parseInt(e.target.value)])} />
                     </div>
                 )}
            </div>

            {/* General Visualization Controls */}
            {activeTab === 'duration' && (
                 renderVariableSelect('Group By', currentConfig.groupBy, v => handleConfig('groupBy', v))
            )}

            {renderVariableSelect('Color By', currentConfig.colorBy, v => handleConfig('colorBy', v))}

            {(activeTab === 'duration' || activeTab === 'dist') && (
                 renderVariableSelect('Texture By', currentConfig.textureBy, v => handleConfig('textureBy', v))
            )}

            <div className="h-6 w-px bg-slate-300"></div>

            {/* Distribution Specific Ordering Controls */}
            {activeTab === 'dist' && (
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                         <div className="flex flex-col gap-0.5">
                             <span className="text-[9px] font-bold text-slate-500 uppercase">Group Order</span>
                             <div className="flex items-center gap-1">
                                 <select
                                    className="p-1 border border-slate-300 rounded text-[10px]"
                                    value={currentConfig.distGroupOrder}
                                    onChange={e => handleConfig('distGroupOrder', e.target.value)}
                                 >
                                     <option value="count">Count</option>
                                     <option value="alpha">Alpha</option>
                                 </select>
                                 <button
                                    onClick={() => handleConfig('distGroupDir', currentConfig.distGroupDir === 'asc' ? 'desc' : 'asc')}
                                    className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600"
                                    title={currentConfig.distGroupDir === 'asc' ? 'Ascending' : 'Descending'}
                                 >
                                     {currentConfig.distGroupDir === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                                 </button>
                             </div>
                         </div>
                    </div>
                    <div className="flex items-center gap-1">
                         <div className="flex flex-col gap-0.5">
                             <span className="text-[9px] font-bold text-slate-500 uppercase">Bar Order</span>
                             <div className="flex items-center gap-1">
                                 <select
                                    className="p-1 border border-slate-300 rounded text-[10px]"
                                    value={currentConfig.distBarOrder}
                                    onChange={e => handleConfig('distBarOrder', e.target.value)}
                                 >
                                     <option value="count">Count</option>
                                     <option value="alpha">Alpha</option>
                                 </select>
                                 <button
                                    onClick={() => handleConfig('distBarDir', currentConfig.distBarDir === 'asc' ? 'desc' : 'asc')}
                                    className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600"
                                    title={currentConfig.distBarDir === 'asc' ? 'Ascending' : 'Descending'}
                                 >
                                     {currentConfig.distBarDir === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                                 </button>
                             </div>
                         </div>
                    </div>

                    <div className="h-6 w-px bg-slate-300"></div>

                    <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Bar Mode</span>
                        <select
                            className="p-1 border border-slate-300 rounded text-[10px]"
                            value={currentConfig.distBarMode || 'grouped'}
                            onChange={e => handleConfig('distBarMode', e.target.value)}
                        >
                            <option value="grouped">Grouped</option>
                            <option value="stacked">Stacked</option>
                        </select>
                    </div>

                    {currentConfig.textureBy !== 'none' && currentConfig.textureBy !== currentConfig.colorBy && (
                        <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Cluster By</span>
                            <select
                                className="p-1 border border-slate-300 rounded text-[10px] max-w-[80px]"
                                value={currentConfig.distPrimaryVar || 'color'}
                                onChange={e => handleConfig('distPrimaryVar', e.target.value)}
                            >
                                <option value="color">Color ({currentConfig.colorBy})</option>
                                <option value="texture">Pattern ({currentConfig.textureBy})</option>
                            </select>
                        </div>
                    )}

                    <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Values</span>
                        <div className="flex items-center gap-1">
                            <select
                                className="p-1 border border-slate-300 rounded text-[10px]"
                                value={currentConfig.distValueMode || 'count'}
                                onChange={e => handleConfig('distValueMode', e.target.value)}
                            >
                                <option value="count">Count</option>
                                <option value="percentage">Percent</option>
                            </select>
                            {currentConfig.distValueMode === 'percentage' && currentConfig.distBarMode === 'stacked' && (
                                <button
                                    onClick={() => handleConfig('distNormalize', !currentConfig.distNormalize)}
                                    className={`p-1 border rounded text-[10px] ${currentConfig.distNormalize ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-300 text-slate-600'}`}
                                    title="Normalize each stack to 100%"
                                >
                                    100%
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="h-6 w-px bg-slate-300"></div>
                </div>
            )}

            {/* Plot-Specific Toggles */}
            {(activeTab === 'vowel' || activeTab === '3d') && (
              <>
                 {currentConfig.plotType === 'trajectory' ? (
                   renderVariableSelect('Line Type', currentConfig.lineTypeBy, (val) => handleConfig('lineTypeBy', val))
                 ) : (
                   renderVariableSelect('Shape', currentConfig.shapeBy, (val) => handleConfig('shapeBy', val))
                 )}

                 {/* Plot Type Toggle (Point vs Trajectory) */}
                 <div className="flex items-center bg-slate-200 rounded p-0.5 ml-2">
                    <button
                        onClick={() => handleConfig('plotType', 'point')}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded ${currentConfig.plotType !== 'trajectory' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Point
                    </button>
                    <button
                        onClick={() => handleConfig('plotType', 'trajectory')}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded ${currentConfig.plotType === 'trajectory' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Traj
                    </button>
                 </div>

                 {currentConfig.plotType !== 'trajectory' ? (
                    <div className="flex items-center gap-2 ml-2">
                      <label className="font-semibold text-slate-600">Time:</label>
                      <select
                        className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 w-16"
                        value={currentConfig.timePoint}
                        onChange={e => handleConfig('timePoint', parseInt(e.target.value))}
                      >
                        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(t => (
                          <option key={t} value={t}>{t}%</option>
                        ))}
                      </select>
                    </div>
                 ) : (
                    <div className="flex items-center gap-2 ml-2">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Range</span>
                            <div className="flex items-center gap-1">
                                <select
                                    className="p-0.5 border rounded text-[10px] w-12"
                                    value={currentConfig.trajectoryOnset ?? 0}
                                    onChange={e => handleConfig('trajectoryOnset', parseInt(e.target.value))}
                                >
                                    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(t => <option key={t} value={t}>{t}%</option>)}
                                </select>
                                <span className="text-slate-400">-</span>
                                <select
                                    className="p-0.5 border rounded text-[10px] w-12"
                                    value={currentConfig.trajectoryOffset ?? 100}
                                    onChange={e => handleConfig('trajectoryOffset', parseInt(e.target.value))}
                                >
                                    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(t => <option key={t} value={t}>{t}%</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-0.5 ml-2 border-l border-slate-200 pl-2">
                             <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" className="rounded text-indigo-600" checked={currentConfig.showIndividualLines} onChange={e => handleConfig('showIndividualLines', e.target.checked)} />
                                <span className="text-[9px] font-bold text-slate-600">Lines</span>
                             </label>
                             {currentConfig.showIndividualLines && (
                                <input type="range" min="0" max="1" step="0.1" value={currentConfig.trajectoryLineOpacity ?? 0.5} onChange={e => handleConfig('trajectoryLineOpacity', parseFloat(e.target.value))} className="w-12 h-1 accent-indigo-600" title="Line Opacity" />
                             )}
                        </div>
                    </div>
                 )}

                <div className="h-6 w-px bg-slate-300 mx-2"></div>

                <div className="flex items-center gap-3 flex-wrap">
                   {/* Points Config */}
                   {currentConfig.plotType !== 'trajectory' && (
                       <div className="flex items-center gap-1.5">
                         <label className="flex items-center gap-1 cursor-pointer" title="Show Individual Points">
                           <input type="checkbox" className="rounded text-indigo-600" checked={currentConfig.showPoints} onChange={e => handleConfig('showPoints', e.target.checked)} />
                           <span className="font-bold">Pts</span>
                         </label>
                         {currentConfig.showPoints && (
                           <>
                             <input type="range" min="1" max="10" title="Point Size" value={currentConfig.pointSize} onChange={e => handleConfig('pointSize', parseInt(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                             <input type="range" min="0" max="1" step="0.1" title="Point Opacity" value={currentConfig.pointOpacity} onChange={e => handleConfig('pointOpacity', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                           </>
                         )}
                       </div>
                   )}

                   {currentConfig.plotType !== 'trajectory' && <div className="w-px h-6 bg-slate-200"></div>}

                   {/* Ellipse Config */}
                   {(activeTab === 'vowel' || activeTab === '3d') && currentConfig.plotType !== 'trajectory' && (
                     <div className="flex items-center gap-1.5 border-r border-slate-200 pr-2">
                       <label className="flex items-center gap-1 cursor-pointer" title="Show Standard Deviation Ellipses">
                         <input type="checkbox" className="rounded text-indigo-600" checked={currentConfig.showEllipses} onChange={e => handleConfig('showEllipses', e.target.checked)} />
                         <span className="font-bold">Ellip</span>
                       </label>
                       {currentConfig.showEllipses && (
                         <div className="flex items-center gap-1.5">
                           <select className="p-0.5 border rounded text-[10px]" value={currentConfig.ellipseSD} onChange={e => handleConfig('ellipseSD', parseFloat(e.target.value))} title="Standard Deviations">
                             {[1, 1.5, 2, 2.5, 3].map(sd => <option key={sd} value={sd}>{sd}σ</option>)}
                           </select>
                           <div className="flex flex-col gap-0.5">
                               <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                  <span>Width</span>
                                  <input type="range" min="0.5" max="8" step="0.5" title="Line Width" value={currentConfig.ellipseLineWidth} onChange={e => handleConfig('ellipseLineWidth', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                               </div>
                               <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                  <span>Line</span>
                                  <input type="range" min="0" max="1" step="0.1" title="Line Opacity" value={currentConfig.ellipseLineOpacity} onChange={e => handleConfig('ellipseLineOpacity', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                               </div>
                               <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                  <span>Fill</span>
                                  <input type="range" min="0" max="1" step="0.1" title="Fill Opacity" value={currentConfig.ellipseFillOpacity} onChange={e => handleConfig('ellipseFillOpacity', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                               </div>
                           </div>
                         </div>
                       )}
                     </div>
                   )}

                   {/* Means / Centroids */}
                   <div className="flex items-center gap-1.5">
                     <label className="flex items-center gap-1 cursor-pointer" title="Show Means">
                       <input
                            type="checkbox"
                            className="rounded text-indigo-600"
                            checked={currentConfig.plotType === 'trajectory' ? currentConfig.showMeanTrajectories : currentConfig.showCentroids}
                            onChange={e => handleConfig(currentConfig.plotType === 'trajectory' ? 'showMeanTrajectories' : 'showCentroids', e.target.checked)}
                       />
                       <span className="font-bold">Means</span>
                     </label>
                     {(currentConfig.plotType === 'trajectory' ? currentConfig.showMeanTrajectories : currentConfig.showCentroids) && (
                        <>
                           {currentConfig.plotType === 'trajectory' ? (
                                <div className="flex flex-col gap-0.5">
                                     <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                        <span>Width</span>
                                        <input type="range" min="1" max="10" step="0.5" title="Mean Width" value={currentConfig.meanTrajectoryWidth ?? 3} onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                     </div>
                                     <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                        <span>Op</span>
                                        <input type="range" min="0" max="1" step="0.1" title="Mean Opacity" value={currentConfig.meanTrajectoryOpacity ?? 1} onChange={e => handleConfig('meanTrajectoryOpacity', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                     </div>
                                     <div className="flex items-center gap-1">
                                        <label className="flex items-center gap-1 cursor-pointer text-[9px] text-slate-500">
                                            <input type="checkbox" className="rounded text-indigo-600" checked={currentConfig.showTrajectoryLabels} onChange={e => handleConfig('showTrajectoryLabels', e.target.checked)} />
                                            <span>Lbl</span>
                                        </label>
                                        {currentConfig.showTrajectoryLabels && (
                                            <input type="range" min="8" max="72" step="1" title="Label Size" value={currentConfig.meanTrajectoryLabelSize || 12} onChange={e => handleConfig('meanTrajectoryLabelSize', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                        )}
                                     </div>
                                </div>
                           ) : (
                                <>
                                   {activeTab === 'vowel' && (
                                       <div className="flex flex-col gap-0.5">
                                            <input type="range" min="4" max="20" title="Centroid Size" value={currentConfig.centroidSize} onChange={e => handleConfig('centroidSize', parseInt(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                            <input type="range" min="0" max="1" step="0.1" title="Centroid Opacity" value={currentConfig.centroidOpacity} onChange={e => handleConfig('centroidOpacity', parseFloat(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                       </div>
                                   )}

                                   <label className="flex items-center gap-1 cursor-pointer text-[10px] text-slate-500 ml-1">
                                    <input type="checkbox" className="rounded text-indigo-600" checked={currentConfig.labelAsCentroid} onChange={e => handleConfig('labelAsCentroid', e.target.checked)} />
                                    <span>Txt</span>
                                   </label>
                                   {currentConfig.labelAsCentroid && (
                                     <input type="range" min="8" max="72" title="Text Size" value={currentConfig.labelSize} onChange={e => handleConfig('labelSize', parseInt(e.target.value))} className="w-10 h-1 accent-indigo-600" />
                                   )}
                                </>
                           )}

                           {/* Mean Label Interaction Type */}
                           {(currentConfig.colorBy !== 'none' || (currentConfig.plotType !== 'trajectory' && currentConfig.shapeBy !== 'none') || (currentConfig.plotType === 'trajectory' && currentConfig.lineTypeBy !== 'none')) && (
                               <select
                                 className="text-[9px] p-0.5 border rounded"
                                 title="Label Source"
                                 value={currentConfig.meanLabelType}
                                 onChange={e => handleConfig('meanLabelType', e.target.value)}
                               >
                                   <option value="auto">Auto</option>
                                   <option value="color">Color Key</option>
                                   <option value="shape">{currentConfig.plotType === 'trajectory' ? 'Line Key' : 'Shape Key'}</option>
                                   <option value="both">Both</option>
                               </select>
                           )}
                        </>
                     )}
                   </div>
                </div>
              </>
            )}
            {/* ... Rest of Toggles ... */}
            {(activeTab === 'traj_f1f2' || activeTab === 'traj_series') && (
               <>
                  {renderVariableSelect('Line Type', currentConfig.lineTypeBy, v => handleConfig('lineTypeBy', v))}

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Line Opacity</span>
                     <input type="range" min="0.01" max="1" step="0.05" value={currentConfig.trajectoryLineOpacity} onChange={e => handleConfig('trajectoryLineOpacity', parseFloat(e.target.value))} className="w-16 h-1 accent-indigo-600" />
                   </div>

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Mean Width</span>
                     <input type="range" min="1" max="10" step="0.5" value={currentConfig.meanTrajectoryWidth} onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-indigo-600" />
                   </div>

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Mean Opacity</span>
                     <input type="range" min="0.1" max="1" step="0.05" value={currentConfig.meanTrajectoryOpacity} onChange={e => handleConfig('meanTrajectoryOpacity', parseFloat(e.target.value))} className="w-16 h-1 accent-indigo-600" />
                   </div>

                   {activeTab === 'traj_f1f2' && (
                       <div className="relative ml-2">
                        <button
                            onClick={() => {
                            handleConfig('showReferenceVowels', !currentConfig.showReferenceVowels);
                            if (!currentConfig.showReferenceVowels) setShowRefDropdown(true);
                            }}
                            className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border shadow-sm transition-colors ${currentConfig.showReferenceVowels ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                        >
                            <Check size={12} className={currentConfig.showReferenceVowels ? 'opacity-100' : 'opacity-0'} />
                            <span>Refs</span>
                        </button>

                        {currentConfig.showReferenceVowels && (
                            <button onClick={() => setShowRefDropdown(!showRefDropdown)} className="ml-1 text-[10px] text-indigo-600 underline font-bold">Config</button>
                        )}
                        {showRefDropdown && currentConfig.showReferenceVowels && (
                            <div className="absolute top-full mt-2 left-0 bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-64 z-50">
                            <div className="flex justify-between border-b border-slate-100 pb-2 mb-2">
                                <span className="font-bold text-slate-500">Reference Settings</span>
                                <button onClick={() => setShowRefDropdown(false)} className="text-slate-400 hover:text-slate-600">×</button>
                            </div>

                            <div className="mb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Voice Pitch Filter</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {availablePitches.map(p => (
                                        <button
                                            key={p}
                                            onClick={() => togglePitchFilter(p)}
                                            className={`px-2 py-0.5 rounded text-[10px] border ${(currentConfig.referencePitchFilter || []).includes(p) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                    {availablePitches.length === 0 && <span className="text-[10px] text-slate-400 italic">No pitch data</span>}
                                </div>
                            </div>

                            <div className="mb-3 space-y-2 pb-3 border-b border-slate-100 mt-3">
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Label Size</span>
                                    <input type="range" min="8" max="24" value={currentConfig.refVowelLabelSize} onChange={e => handleConfig('refVowelLabelSize', parseInt(e.target.value))} className="w-24 h-1 accent-indigo-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Label Opacity</span>
                                    <input type="range" min="0" max="1" step="0.1" value={currentConfig.refVowelLabelOpacity} onChange={e => handleConfig('refVowelLabelOpacity', parseFloat(e.target.value))} className="w-24 h-1 accent-indigo-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Ellipse Opacity</span>
                                    <input type="range" min="0" max="1" step="0.1" value={currentConfig.refVowelEllipseLineOpacity} onChange={e => handleConfig('refVowelEllipseLineOpacity', parseFloat(e.target.value))} className="w-24 h-1 accent-indigo-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Fill Opacity</span>
                                    <input type="range" min="0" max="1" step="0.1" value={currentConfig.refVowelEllipseFillOpacity} onChange={e => handleConfig('refVowelEllipseFillOpacity', parseFloat(e.target.value))} className="w-24 h-1 accent-indigo-600" />
                                </div>
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {globalReferences.map(ref => (
                                <label key={ref.canonical} className="flex items-center space-x-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded">
                                    <input type="checkbox" checked={currentConfig.selectedReferenceVowels.includes(ref.canonical)} onChange={() => toggleReferenceVowel(ref.canonical)} className="rounded text-indigo-600" />
                                    <span className="font-mono font-bold text-slate-700">{ref.canonical}</span>
                                </label>
                                ))}
                            </div>
                            <div className="pt-2 mt-2 border-t border-slate-100 flex justify-between text-[10px]">
                                <button onClick={selectAllRefVowels} className="text-indigo-600 hover:underline">All</button>
                                <button onClick={clearRefVowels} className="text-slate-400 hover:underline">None</button>
                            </div>
                            </div>
                        )}
                        </div>
                   )}
               </>
            )}

          </div>
        )}
      </div>

      {/* Plot Area */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden relative">
        {activeTab === 'vowel' && (
          <CanvasPlot
            ref={plotRef}
            layers={layers}
            layerData={layerData}
            onLegendClick={handleLegendClick}
          />
        )}
        {activeTab === '3d' && (
          <Scatter3DPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
          />
        )}
        {activeTab === 'traj_f1f2' && (
          <TrajectoryF1F2
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            globalReferences={globalReferences}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
          />
        )}
        {activeTab === 'traj_series' && (
          <TrajectoryTimeSeries
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
          />
        )}
        {activeTab === 'duration' && (
          <DurationPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
          />
        )}
        {activeTab === 'dist' && (
          <PhonemeDistributionPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
          />
        )}
        {activeTab === 'table' && (
           <div className="h-full overflow-auto">
             <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-slate-50/90 backdrop-blur border-b border-slate-200 z-10">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter">Word</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter">Phoneme</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter">Produced</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">Duration (s)</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">F1 (Avg)</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">F2 (Avg)</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">F3 (Avg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeData.slice(0, 1000).map(token => {
                    const f1_mean = token.trajectory.length > 0 ? token.trajectory.reduce((acc, p) => acc + (currentConfig.useSmoothing ? (p.f1_smooth ?? p.f1) : p.f1), 0) / token.trajectory.length : 0;
                    const f2_mean = token.trajectory.length > 0 ? token.trajectory.reduce((acc, p) => acc + (currentConfig.useSmoothing ? (p.f2_smooth ?? p.f2) : p.f2), 0) / token.trajectory.length : 0;
                    const f3_mean = token.trajectory.length > 0 ? token.trajectory.reduce((acc, p) => acc + (currentConfig.useSmoothing ? (p.f3_smooth ?? p.f3) : p.f3), 0) / token.trajectory.length : 0;
                    return (
                      <tr key={token.id} className="hover:bg-indigo-50/40 transition-colors">
                        <td className="px-4 py-2 text-slate-900 font-semibold">{token.word}</td>
                        <td className="px-4 py-2 font-mono text-indigo-600 font-bold">{token.canonical}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{token.produced}</td>
                        <td className="px-4 py-2 text-slate-600 text-right font-mono">{token.duration.toFixed(3)}</td>
                        <td className="px-4 py-2 text-slate-600 text-right font-mono">{Math.round(f1_mean)}</td>
                        <td className="px-4 py-2 text-slate-600 text-right font-mono">{Math.round(f2_mean)}</td>
                        <td className="px-4 py-2 text-slate-600 text-right font-mono">{Math.round(f3_mean)}</td>
                      </tr>
                    );
                  })}
                </tbody>
             </table>
             {activeData.length > 1000 && (
                <div className="p-4 text-center text-slate-400 italic text-xs">
                  Showing first 1,000 of {activeData.length.toLocaleString()} tokens.
                </div>
             )}
           </div>
        )}
      </div>

      {editingItem && (
        <StyleEditor
          category={editingItem.category}
          position={editingItem.position}
          activeChannels={getActiveChannels()}
          currentStyles={editingItem.currentStyles}
          onUpdate={handleStyleUpdate}
          onClose={() => setEditingItem(null)}
        />
      )}

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        plotRef={plotRef}
        layers={layers}
        defaultTitle={bgConfig.colorBy !== 'none' ? bgConfig.colorBy : bgConfig.groupBy}
      />

      {/* Close add menu on click outside */}
      {showAddMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)}></div>
      )}
    </div>
  );
};

export default MainDisplay;
