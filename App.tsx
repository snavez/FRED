
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import MainDisplay from './components/MainDisplay';
import Header from './components/Header';
import { generateSpeechData } from './services/dataGenerator';
import { parseSpeechCSV, isMonophthong } from './services/csvParser';
import { SpeechToken, PlotConfig, FilterState, ReferenceCentroid, Layer, LayerCounters, StyleOverrides } from './types';

const INITIAL_CONFIG: PlotConfig = {
  invertX: true,
  invertY: true,
  colorBy: 'phoneme',
  shapeBy: 'none',
  lineTypeBy: 'none',
  textureBy: 'none',
  bwMode: false,
  timePoint: 50,

  // Data Source
  useSmoothing: false,

  // New categorical defaults
  groupBy: 'phoneme',

  // Base Plot Mode
  plotType: 'point',
  trajectoryOnset: 0,
  trajectoryOffset: 100,

  timeNormalized: true,
  showMeanTrajectories: true,
  showIndividualLines: true,
  trajectoryLineOpacity: 0.1,
  showTrajectoryLabels: false,
  meanTrajectoryLabelSize: 12,
  meanTrajectoryWidth: 3,
  meanTrajectoryOpacity: 1.0,
  showArrows: true,
  showReferenceVowels: false,
  selectedReferenceVowels: [],
  referencePitchFilter: [],

  // Defaults for Reference Vowels
  refVowelLabelOpacity: 0.7,
  refVowelLabelSize: 14,
  refVowelEllipseLineOpacity: 0.4,
  refVowelEllipseFillOpacity: 0.1,

  // Duration defaults
  showQuartiles: true,
  showMeanMarker: true,
  showOutliers: true,
  showDurationPoints: false,

  // Distribution defaults
  separatePlots: false,
  distGroupOrder: 'count',
  distGroupDir: 'desc',
  distBarOrder: 'count',
  distBarDir: 'desc',
  distBarMode: 'grouped',
  distPrimaryVar: 'color',
  distValueMode: 'count',
  distNormalize: false,

  showPoints: true,
  showEllipses: false,
  showCentroids: false,
  labelAsCentroid: false,

  pointSize: 3,
  pointOpacity: 0.5,

  centroidSize: 8,
  centroidOpacity: 1.0,
  labelSize: 12,
  meanLabelType: 'auto',

  lineWidth: 1,
  ellipseSD: 1.5,
  ellipseLineWidth: 1.5,
  ellipseLineOpacity: 0.8,
  ellipseFillOpacity: 0.1,

  f1Range: [200, 1200],
  f2Range: [500, 3200],
  f3Range: [2000, 4000],
  timeSeriesFrequencyRange: [0, 4000],
  durationRange: [0, 0], // Auto
  countRange: [0, 0] // Auto
};

const INITIAL_FILTERS: FilterState = {
  mainType: 'all',
  vowelCategory: 'all',
  phonemes: [],
  alignments: [],
  produced: [],
  words: [],
  canonicalStress: [],
  lexicalStress: [],
  syllableMark: [],
  voicePitch: [],
};

const INITIAL_STYLE_OVERRIDES: StyleOverrides = {
  colors: {},
  shapes: {},
  textures: {},
  lineTypes: {}
};

const createBackgroundLayer = (): Layer => ({
  id: 'bg',
  name: 'Background',
  visible: true,
  isBackground: true,
  config: { ...INITIAL_CONFIG },
  filters: { ...INITIAL_FILTERS },
  styleOverrides: { ...INITIAL_STYLE_OVERRIDES }
});

const App: React.FC = () => {
  const [data, setData] = useState<SpeechToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Multi-layer state
  const [layers, setLayers] = useState<Layer[]>([createBackgroundLayer()]);
  const [activeLayerId, setActiveLayerId] = useState('bg');
  const [layerCounters, setLayerCounters] = useState<LayerCounters>({ point: 1, trajectory: 1 });

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const tokens = generateSpeechData(5000);
      setData(tokens);
      setIsLoading(false);
    };
    loadData();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseSpeechCSV(text);
      setData(parsed);
      setIsLoading(false);
      // Reset all layer filters
      setLayers(prev => prev.map(l => ({ ...l, filters: { ...INITIAL_FILTERS } })));
    };
    reader.readAsText(file);
  };

  const filterData = useCallback((sourceData: SpeechToken[], currentFilters: FilterState) => {
    return sourceData.filter(token => {
      if (currentFilters.mainType !== 'all') {
        if (!token.canonical_type || token.canonical_type.toLowerCase() !== currentFilters.mainType) return false;
      }
      if (currentFilters.mainType === 'vowel' && currentFilters.vowelCategory !== 'all') {
        const isMono = isMonophthong(token.canonical);
        if (currentFilters.vowelCategory === 'monophthong' && !isMono) return false;
        if (currentFilters.vowelCategory === 'diphthong' && isMono) return false;
      }
      if (currentFilters.phonemes.length > 0 && !currentFilters.phonemes.includes(token.canonical)) return false;
      if (currentFilters.alignments.length > 0 && !currentFilters.alignments.includes(token.alignment)) return false;
      if (currentFilters.produced.length > 0 && !currentFilters.produced.includes(token.produced)) return false;
      if (currentFilters.words.length > 0 && !currentFilters.words.includes(token.word)) return false;
      if (currentFilters.canonicalStress.length > 0 && !currentFilters.canonicalStress.includes(token.canonical_stress)) return false;
      if (currentFilters.lexicalStress.length > 0 && !currentFilters.lexicalStress.includes(token.lexical_stress)) return false;
      if (currentFilters.syllableMark.length > 0 && !currentFilters.syllableMark.includes(token.syllable_mark)) return false;
      if (currentFilters.voicePitch.length > 0 && !currentFilters.voicePitch.includes(token.voice_pitch)) return false;
      return true;
    });
  }, []);

  // Compute filtered data per layer
  const layerData = useMemo(() => {
    const result: Record<string, SpeechToken[]> = {};
    layers.forEach(layer => {
      result[layer.id] = filterData(data, layer.filters);
    });
    return result;
  }, [data, layers, filterData]);

  // Derived: active layer
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);

  // Layer management helpers
  const updateLayer = useCallback((layerId: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, ...updates } : l));
  }, []);

  const updateLayerConfig = useCallback((layerId: string, key: keyof PlotConfig, value: any) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, config: { ...l.config, [key]: value } } : l
    ));
  }, []);

  const updateLayerFilters = useCallback((layerId: string, newFilters: FilterState) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, filters: newFilters } : l
    ));
  }, []);

  const addLayer = useCallback((type: 'point' | 'trajectory') => {
    if (layers.length >= 10) return;

    const counter = type === 'point' ? layerCounters.point : layerCounters.trajectory;
    const prefix = type === 'point' ? 'POINT' : 'TRAJ';
    const id = `${type}_${Date.now()}`;
    const name = `${prefix} ${String(counter).padStart(3, '0')}`;

    const newLayer: Layer = {
      id,
      name,
      visible: true,
      isBackground: false,
      config: {
        ...INITIAL_CONFIG,
        plotType: type,
        // Fix: point layers show points by default
        showPoints: type === 'point',
        showEllipses: false,
        showCentroids: false,
        // Trajectory defaults
        showIndividualLines: type === 'trajectory',
        trajectoryLineOpacity: type === 'trajectory' ? 0.2 : 0.1,
        showArrows: type === 'trajectory',
        colorBy: 'phoneme',
      },
      filters: { ...INITIAL_FILTERS },
      styleOverrides: { ...INITIAL_STYLE_OVERRIDES }
    };

    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(id);
    setLayerCounters(prev => ({
      ...prev,
      [type]: prev[type] + 1
    }));
  }, [layers.length, layerCounters]);

  const removeLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === layerId);
      if (!layer || layer.isBackground) return prev;
      const filtered = prev.filter(l => l.id !== layerId);
      // If we removed the active layer, switch to background
      if (activeLayerId === layerId) {
        setActiveLayerId('bg');
      }
      return filtered;
    });
  }, [activeLayerId]);

  const reorderLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId);
      if (idx === -1) return prev;
      // Background (idx 0) can't be moved
      if (prev[idx].isBackground) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      // Can't move above background (idx 0) or below last
      if (targetIdx < 1 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
      return copy;
    });
  }, []);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
  }, []);

  const renameLayer = useCallback((layerId: string, newName: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name: newName } : l));
  }, []);

  // Update style overrides for a specific layer (or active layer if no layerId given)
  const updateStyleOverride = useCallback((fieldKey: 'colors' | 'shapes' | 'textures' | 'lineTypes', category: string, value: any, layerId?: string) => {
    setLayers(prev => prev.map(l => {
      const targetId = layerId || activeLayerId;
      if (l.id !== targetId) return l;
      return {
        ...l,
        styleOverrides: {
          ...l.styleOverrides,
          [fieldKey]: { ...l.styleOverrides[fieldKey], [category]: value }
        }
      };
    }));
  }, [activeLayerId]);

  // Proxy setConfig/setFilters for the active layer (used by Sidebar)
  const setActiveConfig = useCallback((updater: React.SetStateAction<PlotConfig>) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== activeLayerId) return l;
      const newConfig = typeof updater === 'function' ? updater(l.config) : updater;
      return { ...l, config: newConfig };
    }));
  }, [activeLayerId]);

  const setActiveFilters = useCallback((updater: React.SetStateAction<FilterState>) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== activeLayerId) return l;
      const newFilters = typeof updater === 'function' ? updater(l.filters) : updater;
      return { ...l, filters: newFilters };
    }));
  }, [activeLayerId]);

  // Calculate Global Reference Centroids (for Ref Vowels) — uses background layer config
  const bgConfig = layers[0].config;
  const globalReferences = useMemo(() => {
    const pitchFilter = bgConfig.referencePitchFilter || [];

    const monophthongs = data.filter(t =>
      t.type === 'vowel' &&
      isMonophthong(t.canonical) &&
      t.alignment === 'exact' &&
      (pitchFilter.length === 0 || pitchFilter.includes(t.voice_pitch))
    );

    const groups: Record<string, SpeechToken[]> = {};
    monophthongs.forEach(t => {
      if (!groups[t.canonical]) groups[t.canonical] = [];
      groups[t.canonical].push(t);
    });

    const refs: ReferenceCentroid[] = [];
    Object.entries(groups).forEach(([key, tokens]) => {
      if (tokens.length < 5) return;
      const pts = tokens.map(t => t.trajectory.find(p => p.time === 50)).filter(Boolean).map(p => ({
        f1: bgConfig.useSmoothing ? (p!.f1_smooth ?? p!.f1) : p!.f1,
        f2: bgConfig.useSmoothing ? (p!.f2_smooth ?? p!.f2) : p!.f2
      }));

      if (pts.length < 5) return;

      let sumF1 = 0, sumF2 = 0;
      pts.forEach(p => { sumF1 += p.f1; sumF2 += p.f2 });
      const meanF1 = sumF1 / pts.length;
      const meanF2 = sumF2 / pts.length;

      let sxx = 0, syy = 0, sxy = 0;
      pts.forEach(p => {
        sxx += (p.f2 - meanF2) ** 2;
        syy += (p.f1 - meanF1) ** 2;
        sxy += (p.f2 - meanF2) * (p.f1 - meanF1);
      });
      sxx /= pts.length; syy /= pts.length; sxy /= pts.length;

      const common = Math.sqrt((sxx - syy) ** 2 + 4 * (sxy ** 2));
      const l1 = (sxx + syy + common) / 2;
      const l2 = (sxx + syy - common) / 2;
      const angle = Math.atan2(l1 - sxx, sxy);

      refs.push({
        canonical: key,
        f1: meanF1,
        f2: meanF2,
        sdX: Math.sqrt(l1),
        sdY: Math.sqrt(l2),
        angle
      });
    });
    return refs.sort((a,b) => a.canonical.localeCompare(b.canonical));
  }, [data, bgConfig.useSmoothing, bgConfig.referencePitchFilter]);

  const activeLayerData = layerData[activeLayerId] || [];

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden text-slate-900">
      <Sidebar
        config={activeLayer.config}
        setConfig={setActiveConfig}
        filters={activeLayer.filters}
        setFilters={setActiveFilters}
        data={data}
        tokenCount={activeLayerData.length}
        totalCount={data.length}
        handleFileUpload={handleFileUpload}
        activeLayerName={activeLayer.isBackground ? undefined : activeLayer.name}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          tokenCount={activeLayerData.length}
          isLoading={isLoading}
          data={activeLayerData}
        />

        <main className="flex-1 p-4 overflow-hidden">
          {isLoading ? (
            <div className="h-full w-full flex flex-col items-center justify-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              <p className="text-slate-500 font-medium">Processing Acoustic Tokens...</p>
            </div>
          ) : (
            <MainDisplay
              layers={layers}
              layerData={layerData}
              activeLayerId={activeLayerId}
              setActiveLayerId={setActiveLayerId}
              updateLayerConfig={updateLayerConfig}
              addLayer={addLayer}
              removeLayer={removeLayer}
              reorderLayer={reorderLayer}
              toggleLayerVisibility={toggleLayerVisibility}
              renameLayer={renameLayer}
              setActiveConfig={setActiveConfig}
              globalReferences={globalReferences}
              updateStyleOverride={updateStyleOverride}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
