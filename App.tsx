
import React, { useState, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import MainDisplay from './components/MainDisplay';
import Header from './components/Header';
import { detectDelimiter, splitRow, autoDetectMappings, parseWithMappings } from './services/csvParser';
import { getLabel } from './utils/getLabel';
import { SpeechToken, PlotConfig, FilterState, ReferenceCentroid, Layer, LayerCounters, StyleOverrides, ColumnMapping, DatasetMeta, NormalizationMethod } from './types';
import { computeSpeakerStats, computeNormalizedRange, SpeakerStatsMap } from './utils/normalization';
import DataMappingDialog from './components/DataMappingDialog';

const INITIAL_CONFIG: PlotConfig = {
  invertX: true,
  invertY: true,
  colorBy: 'none',
  shapeBy: 'none',
  lineTypeBy: 'none',
  textureBy: 'none',
  bwMode: false,
  timePoint: 50,

  // Data Source
  useSmoothing: false,
  normalization: 'hz' as NormalizationMethod,

  // New categorical defaults
  groupBy: 'none',

  // Base Plot Mode
  plotType: 'point',
  trajectoryOnset: 0,
  trajectoryOffset: 100,

  timeNormalized: true,
  showMeanTrajectories: true,
  showIndividualLines: true,
  trajectoryLineOpacity: 0.1,
  trajectoryLineWidth: 1,
  showTrajectoryLabels: false,
  meanTrajectoryLabelSize: 12,
  meanTrajectoryWidth: 3,
  meanTrajectoryOpacity: 1.0,
  showArrows: true,
  showMeanTrajectoryPoints: true,
  meanTrajectoryPointSize: 4,
  meanTrajectoryArrowSize: 3,
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

  tooltipFields: [],

  f1Range: [200, 1200],
  f2Range: [500, 3200],
  f3Range: [2000, 4000],
  timeSeriesFrequencyRange: [0, 4000],
  durationRange: [0, 0], // Auto
  countRange: [0, 0] // Auto
};

const INITIAL_FILTERS: FilterState = {
  filters: {},
};

/** Compute a FilterState with all values selected from the data */
const computeSelectAllFilters = (tokens: SpeechToken[], meta: DatasetMeta | null): FilterState => {
  const filters: Record<string, string[]> = {};
  if (!meta) return { filters };

  for (const m of meta.columnMappings) {
    if (m.role === 'speaker') {
      filters['speaker'] = Array.from(new Set(tokens.map(t => t.speaker).filter(Boolean)));
    } else if (m.role === 'file_id') {
      filters['file_id'] = Array.from(new Set(tokens.map(t => t.file_id).filter(Boolean)));
    } else if (m.role === 'duration' && m.isDataField !== true) {
      filters['duration'] = Array.from(new Set(tokens.map(t => t.duration.toString()).filter(v => v !== 'NaN')));
    } else if (m.role === 'pitch' && m.fieldName && m.isDataField !== true) {
      const key = m.fieldName;
      if (!filters[key]) filters[key] = Array.from(new Set(tokens.map(t => t.fields[key] ?? '').filter(v => v !== '')));
    } else if (m.role === 'field' && m.fieldName) {
      const key = m.fieldName;
      filters[key] = Array.from(new Set(tokens.map(t => t.fields[key] ?? '').filter(v => v !== '')));
    }
  }

  return { filters };
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
  const [isLoading, setIsLoading] = useState(false);

  // Multi-layer state
  const [layers, setLayers] = useState<Layer[]>([createBackgroundLayer()]);
  const [activeLayerId, setActiveLayerId] = useState('bg');
  const [layerCounters, setLayerCounters] = useState<LayerCounters>({ point: 1, trajectory: 1 });

  // Flexible parsing state
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [storedFileData, setStoredFileData] = useState<{
    rawText: string; headers: string[]; sampleData: string[][]; fileName: string;
  } | null>(null);
  const uploadIdRef = useRef(0); // guards against FileReader race conditions
  const [mappingDialog, setMappingDialog] = useState<{
    isOpen: boolean;
    rawText: string;
    headers: string[];
    sampleData: string[][];
    detectedMappings: ColumnMapping[];
    fileName: string;
    isEditMode: boolean;
    dialogKey: number; // embedded key — always in sync with dialog data
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const thisUpload = ++uploadIdRef.current;
    const reader = new FileReader();
    reader.onload = (event) => {
      // Discard stale reads if user uploaded another file before this one finished
      if (uploadIdRef.current !== thisUpload) return;
      const text = event.target?.result as string;
      const delimiter = detectDelimiter(text);
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return;

      const headers = splitRow(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
      const sampleRows = lines.slice(1, 6).map(l => splitRow(l, delimiter));
      const detected = autoDetectMappings(headers, sampleRows);

      const fileData = { rawText: text, headers, sampleData: sampleRows, fileName: file.name };
      setStoredFileData(fileData);
      setMappingDialog({
        isOpen: true,
        ...fileData,
        detectedMappings: detected,
        isEditMode: false,
        dialogKey: Date.now(), // unique key, atomic with dialog data
      });
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-uploaded
    e.target.value = '';
  };

  const handleReopenMappingDialog = useCallback(() => {
    if (!storedFileData || !datasetMeta) return;
    setMappingDialog({
      isOpen: true,
      ...storedFileData,
      detectedMappings: datasetMeta.columnMappings,
      isEditMode: true,
      dialogKey: Date.now(),
    });
  }, [storedFileData, datasetMeta]);

  const handleMappingConfirm = useCallback((mappings: ColumnMapping[]) => {
    if (!mappingDialog) return;
    setIsLoading(true);
    const { tokens, meta } = parseWithMappings(mappingDialog.rawText, mappings, mappingDialog.fileName);
    setData(tokens);
    setDatasetMeta(meta);
    const allFilters = computeSelectAllFilters(tokens, meta);

    // Compute auto-fit ranges for the initial Hz view
    const initStats = computeSpeakerStats(tokens, INITIAL_CONFIG.useSmoothing);
    const method = INITIAL_CONFIG.normalization;
    const smooth = INITIAL_CONFIG.useSmoothing;
    const f1Range = computeNormalizedRange(tokens, 'f1', method, initStats, smooth);
    const f2Range = computeNormalizedRange(tokens, 'f2', method, initStats, smooth);
    const f3Range = computeNormalizedRange(tokens, 'f3', method, initStats, smooth);
    const tsFreqRange: [number, number] = [Math.min(f1Range[0], f2Range[0]), Math.max(f1Range[1], f2Range[1])];

    setLayers(prev => prev.map(l => ({
      ...l,
      filters: allFilters,
      config: { ...l.config, f1Range, f2Range, f3Range, timeSeriesFrequencyRange: tsFreqRange, trajectoryOnset: 0, trajectoryOffset: 100 },
    })));
    setMappingDialog(null);
    setIsLoading(false);
  }, [mappingDialog]);

  const filterData = useCallback((sourceData: SpeechToken[], currentFilters: FilterState) => {
    if (sourceData.length === 0) return [];

    // Build accessor+set pairs for all active filters
    const filterEntries: { accessor: (t: SpeechToken) => string; set: Set<string> }[] = [];
    for (const [key, values] of Object.entries(currentFilters.filters)) {
      if (values.length === 0) continue; // empty = nothing passes, handled below
      const set = new Set(values);
      let accessor: (t: SpeechToken) => string;
      if (key === 'speaker') accessor = t => t.speaker;
      else if (key === 'file_id') accessor = t => t.file_id;
      else if (key === 'duration') accessor = t => t.duration.toString();
      else accessor = t => t.fields[key] ?? '';
      filterEntries.push({ accessor, set });
    }

    // Check if any filter key has an empty array (= nothing passes)
    for (const [, values] of Object.entries(currentFilters.filters)) {
      if (values.length === 0) return [];
    }

    return sourceData.filter(token => {
      for (const { accessor, set } of filterEntries) {
        if (!set.has(accessor(token))) return false;
      }
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

  // Pre-compute speaker stats for normalization (from full unfiltered data, stable across filters)
  const speakerStats = useMemo<SpeakerStatsMap>(() => {
    if (data.length === 0) return {};
    return computeSpeakerStats(data, layers[0].config.useSmoothing);
  }, [data, layers[0].config.useSmoothing]);

  // Derived: active layer
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);

  // Layer management helpers
  const updateLayer = useCallback((layerId: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, ...updates } : l));
  }, []);

  const updateLayerConfig = useCallback((layerId: string, key: keyof PlotConfig, value: any) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== layerId) return l;
      const newConfig = { ...l.config, [key]: value };
      // When normalization changes on the background layer, auto-adjust all ranges
      if (key === 'normalization' && l.isBackground && data.length > 0) {
        const method = value as NormalizationMethod;
        const smooth = l.config.useSmoothing;
        newConfig.f1Range = computeNormalizedRange(data, 'f1', method, speakerStats, smooth);
        newConfig.f2Range = computeNormalizedRange(data, 'f2', method, speakerStats, smooth);
        newConfig.f3Range = computeNormalizedRange(data, 'f3', method, speakerStats, smooth);
        newConfig.timeSeriesFrequencyRange = [
          Math.min(newConfig.f1Range[0], newConfig.f2Range[0]),
          Math.max(newConfig.f1Range[1], newConfig.f2Range[1]),
        ];
      }
      return { ...l, config: newConfig };
    }));
  }, [data, speakerStats]);

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
        showPoints: type === 'point',
        showEllipses: false,
        showCentroids: false,
        showIndividualLines: type === 'trajectory',
        trajectoryLineOpacity: type === 'trajectory' ? 0.2 : 0.1,
        showArrows: type === 'trajectory',
        showMeanTrajectoryPoints: type === 'trajectory',
        colorBy: 'none',
      },
      filters: computeSelectAllFilters(data, datasetMeta),
      styleOverrides: { ...INITIAL_STYLE_OVERRIDES }
    };

    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(id);
    setLayerCounters(prev => ({
      ...prev,
      [type]: prev[type] + 1
    }));
  }, [layers.length, layerCounters, data, datasetMeta]);

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

  // Calculate Global Reference Centroids (for Ref Vowels) — uses background layer filtered data
  const bgConfig = layers[0].config;
  const bgFilteredData = layerData['bg'] || [];
  const globalReferences = useMemo(() => {
    if (bgFilteredData.length === 0 || bgConfig.colorBy === 'none') return [];

    // Group by the background layer's colorBy field
    const groups: Record<string, SpeechToken[]> = {};
    bgFilteredData.forEach(t => {
      const key = getLabel(t, bgConfig.colorBy);
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
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
        label: key,
        f1: meanF1,
        f2: meanF2,
        sdX: Math.sqrt(l1),
        sdY: Math.sqrt(l2),
        angle
      });
    });
    return refs.sort((a, b) => a.label.localeCompare(b.label));
  }, [bgFilteredData, bgConfig.colorBy, bgConfig.useSmoothing]);

  const handleToggleFieldVisibility = useCallback((key: string, visible: boolean) => {
    setDatasetMeta(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        columnMappings: prev.columnMappings.map(m => {
          // Match by role for speaker/file_id
          if ((m.role === 'speaker' && key === 'speaker') || (m.role === 'file_id' && key === 'file_id')) {
            return { ...m, showInSidebar: visible };
          }
          // Match field role by fieldName
          if (m.role === 'field' && m.fieldName === key) {
            return { ...m, showInSidebar: visible };
          }
          return m;
        })
      };
    });
  }, []);

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
        datasetMeta={datasetMeta}
        onToggleFieldVisibility={handleToggleFieldVisibility}
        onReopenMappingDialog={storedFileData ? handleReopenMappingDialog : undefined}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          tokenCount={activeLayerData.length}
          isLoading={isLoading}
        />

        <main className="flex-1 p-4 overflow-hidden">
          {isLoading ? (
            <div className="h-full w-full flex flex-col items-center justify-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600"></div>
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
              datasetMeta={datasetMeta}
              speakerStats={speakerStats}
              data={data}
            />
          )}
        </main>
      </div>

      {/* Data Mapping Dialog */}
      {mappingDialog && (
        <DataMappingDialog
          key={mappingDialog.dialogKey}
          isOpen={mappingDialog.isOpen}
          onClose={() => setMappingDialog(null)}
          onConfirm={handleMappingConfirm}
          headers={mappingDialog.headers}
          sampleData={mappingDialog.sampleData}
          detectedMappings={mappingDialog.detectedMappings}
          fileName={mappingDialog.fileName}
          isEditMode={mappingDialog.isEditMode}
        />
      )}
    </div>
  );
};

export default App;
