
import React, { useState, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import MainDisplay from './components/MainDisplay';
import Header from './components/Header';
import { detectDelimiter, splitRow, autoDetectMappings, parseWithMappings, detectHeaderRow, HeaderDetectionResult, TrajectoryFormatOverride } from './services/csvParser';
import { getLabel } from './utils/getLabel';
import { filterFieldKey, listFilterFields } from './utils/filterFields';
import { SpeechToken, PlotConfig, FilterState, ReferenceCentroid, Layer, LayerCounters, StyleOverrides, ColumnMapping, DatasetMeta, DatasetProvenance, NormalizationMethod, UNDEFINED_LABEL } from './types';
import { isSidecarFor, parseProvenanceSidecar } from './services/provenance';
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
  snapMeansToGrid: true,
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
  boxShowPoints: false,
  durationYField: 'duration',
  durationFormantTimePoint: 50,
  durationPlotBy: 'none',
  durationClusterBy: 'none',
  boxWhiskerMode: 'iqr',
  boxCenterLine: 'median',
  showCenterValueLabels: false,
  durationBoxOrder: 'alpha',
  durationBoxDir: 'asc',
  durationTooltipFields: ['file_id', 'duration'],
  boxWidth: 0,
  durationGroupGap: 1.5,
  durationBoxGap: 0.4,

  // Distribution defaults
  distPlotBy: 'none',
  separatePlots: false,
  distGroupOrder: 'count',
  distGroupDir: 'desc',
  distBarOrder: 'count',
  distBarDir: 'desc',
  distBarMode: 'grouped',
  distPrimaryVar: 'color',
  distValueMode: 'count',
  distNormalize: false,
  distBarWidth: 0,
  distGroupGap: 0,
  distBarGap: 0,
  distMode: 'counts',
  distHistXVar: 'duration',
  distHistTimePoint: 50,
  distHistBinCount: 30,
  distHistColorBy: 'none',
  distHistYMode: 'count',
  distHistOverlap: 'stacked',
  distHistOpacity: 0.6,

  // Spectral defaults
  spectralMode: 'scatter',
  spectralXFeature: 'COG@50',
  spectralYFeature: 'SD@50',
  spectralFeature: 'COG@50',
  spectralTimelineMoment: 'COG',
  spectralTrajRange: [0, 0],
  spectralViolin: false,
  spectralShowIndividual: true,
  spectralShowBand: true,
  spectralBandOpacity: 0.18,
  spectralDensityFill: 0.18,
  spectralContourAbsolute: false,
  spectralDurationField: '',
  spectralCoeffFacets: false,
  spectralFlipSign: false,
  spectralXRange: [0, 0],
  spectralYRange: [0, 0],

  varXField: '',
  varYField: '',
  varXTime: 50,
  varYTime: 50,
  varXRange: [0, 0],
  varYRange: [0, 0],
  varShowRegression: true,
  varRegressionPerGroup: false,
  varShowStats: true,
  varRegressionWidth: 2,

  tableMode: 'browse',
  tableFormantTime: 50,
  tableExpandTimePoints: false,
  tableAnalysisDV: 'duration',
  tableAnalysisGroupBy: 'none',
  tableAnalysisFormantTime: 50,
  tableAlpha: 0.05,
  statsTestChoice: 'auto',
  statsUnit: 'speakers',
  statsSpeakerAssumption: 'unknown',
  tableSummaryGroupBy: 'none',
  tableSummaryMeasures: ['duration'],
  tableSummaryLayout: 'separate',
  tableAnalysisType: 'continuous',
  tableAnalysisGroupBy2: 'none',
  tableAnalysisMeasures: ['duration'],
  tableAnalysisCatVar1: 'none',
  tableAnalysisCatVar2: 'none',

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

/**
 * A FilterState with every value selected, for each label field the dataset carries.
 * Hidden fields are included too — a field hidden from the sidebar must not silently
 * filter every token out.
 */
const computeSelectAllFilters = (tokens: SpeechToken[], meta: DatasetMeta | null): FilterState => {
  const filters: Record<string, string[]> = {};
  for (const { key } of listFilterFields(meta, 'all')) {
    const values = new Set(tokens.map(t => getLabel(t, key)));
    const hasEmpty = values.delete('');
    filters[key] = [...values, ...(hasEmpty ? [UNDEFINED_LABEL] : [])];
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
  // Provenance from the JSON sidecar picked alongside the CSV, attached to the dataset
  // when the mapping is confirmed. Null whenever no readable sidecar came with the file.
  const [sidecarProvenance, setSidecarProvenance] = useState<DatasetProvenance | null>(null);
  const [mappingDialog, setMappingDialog] = useState<{
    isOpen: boolean;
    rawText: string;
    headers: string[];
    sampleData: string[][];
    detectedMappings: ColumnMapping[];
    fileName: string;
    isEditMode: boolean;
    dialogKey: number; // embedded key — always in sync with dialog data
    rawFirstRow: string[];
    firstRowIsHeader: boolean;
    headerDetection: HeaderDetectionResult;
  } | null>(null);

  /**
   * Load a data file, and the JSON provenance sidecar beside it when the user selected
   * one too. A browser cannot go looking for the sidecar itself — it only ever sees the
   * files it is handed — so the picker takes several, and the sidecar is recognised by
   * its name matching the data file's.
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen: File[] = e.target.files ? Array.from(e.target.files) : [];
    const file = chosen.find(f => !/\.json$/i.test(f.name)) ?? chosen[0];
    if (!file) return;
    const thisUpload = ++uploadIdRef.current;

    setSidecarProvenance(null);
    const sidecar = chosen.find(f => isSidecarFor(file.name, f.name));
    if (sidecar) {
      const sidecarReader = new FileReader();
      sidecarReader.onload = (event) => {
        if (uploadIdRef.current !== thisUpload) return;
        setSidecarProvenance(parseProvenanceSidecar(String(event.target?.result ?? ''), sidecar.name));
      };
      sidecarReader.readAsText(sidecar);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Discard stale reads if user uploaded another file before this one finished
      if (uploadIdRef.current !== thisUpload) return;
      const text = event.target?.result as string;
      const delimiter = detectDelimiter(text);
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return;

      const rawFirstRow = splitRow(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
      const restRows = lines.slice(1, 6).map(l => splitRow(l, delimiter));
      const detection = detectHeaderRow(rawFirstRow, restRows);

      let headers: string[];
      let sampleRows: string[][];
      if (detection.hasHeaders) {
        headers = rawFirstRow;
        sampleRows = restRows;
      } else {
        headers = rawFirstRow.map((_, i) => `Col_${i + 1}`);
        sampleRows = [rawFirstRow, ...lines.slice(1, 5).map(l => splitRow(l, delimiter))];
      }
      const detected = autoDetectMappings(headers, sampleRows);

      const fileData = { rawText: text, headers, sampleData: sampleRows, fileName: file.name };
      setStoredFileData(fileData);
      setMappingDialog({
        isOpen: true,
        ...fileData,
        detectedMappings: detected,
        isEditMode: false,
        dialogKey: Date.now(),
        rawFirstRow,
        firstRowIsHeader: detection.hasHeaders,
        headerDetection: detection,
      });
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-uploaded
    e.target.value = '';
  };

  const handleReopenMappingDialog = useCallback(() => {
    if (!storedFileData || !datasetMeta) return;
    const rawFirstRow = splitRow(storedFileData.rawText.split(/\r?\n/)[0] || '', detectDelimiter(storedFileData.rawText)).map(h => h.trim().replace(/^"|"$/g, ''));
    setMappingDialog({
      isOpen: true,
      ...storedFileData,
      detectedMappings: datasetMeta.columnMappings,
      isEditMode: true,
      dialogKey: Date.now(),
      rawFirstRow,
      firstRowIsHeader: true, // if we already imported, headers were confirmed
      headerDetection: { hasHeaders: true, confidence: 1 },
    });
  }, [storedFileData, datasetMeta]);

  const handleToggleFirstRowIsHeader = useCallback((isHeader: boolean) => {
    if (!mappingDialog) return;
    const delimiter = detectDelimiter(mappingDialog.rawText);
    const lines = mappingDialog.rawText.split(/\r?\n/).filter(l => l.trim());
    const rawFirstRow = mappingDialog.rawFirstRow;

    let newHeaders: string[];
    let newSampleRows: string[][];
    if (isHeader) {
      newHeaders = rawFirstRow;
      newSampleRows = lines.slice(1, 6).map(l => splitRow(l, delimiter));
    } else {
      newHeaders = rawFirstRow.map((_, i) => `Col_${i + 1}`);
      newSampleRows = [rawFirstRow, ...lines.slice(1, 5).map(l => splitRow(l, delimiter))];
    }
    const detected = autoDetectMappings(newHeaders, newSampleRows);
    setMappingDialog(prev => prev ? {
      ...prev,
      headers: newHeaders,
      sampleData: newSampleRows,
      detectedMappings: detected,
      firstRowIsHeader: isHeader,
      dialogKey: Date.now(),
    } : null);
  }, [mappingDialog]);

  const handleMappingConfirm = useCallback((mappings: ColumnMapping[], trajectoryOverride?: TrajectoryFormatOverride) => {
    if (!mappingDialog) return;
    setIsLoading(true);
    const { tokens, meta: parsedMeta } = parseWithMappings(mappingDialog.rawText, mappings, mappingDialog.fileName, !mappingDialog.firstRowIsHeader, trajectoryOverride);
    const meta: DatasetMeta = sidecarProvenance ? { ...parsedMeta, provenance: sidecarProvenance } : parsedMeta;
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

    // Pick default duration field for percentage-format absolute time-series (first duration-role column)
    const defaultDurationField = meta.columnMappings.find(m => m.role === 'duration')?.fieldName
      ?? meta.columnMappings.find(m => m.role === 'duration')?.csvHeader;

    // For time-slice data, default to Absolute mode (user wants native time axis)
    const defaultTimeNormalized = meta.trajectoryFormat === 'time-slice' ? false : INITIAL_CONFIG.timeNormalized;

    // Reset to a single background layer with fresh config + filters (clears old layers/plots)
    setLayers([{
      ...createBackgroundLayer(),
      filters: allFilters,
      config: {
        ...INITIAL_CONFIG,
        f1Range, f2Range, f3Range,
        timeSeriesFrequencyRange: tsFreqRange,
        trajectoryDurationField: defaultDurationField,
        timeNormalized: defaultTimeNormalized,
      },
    }]);
    setActiveLayerId('bg');
    setLayerCounters({ point: 1, trajectory: 1 });
    setMappingDialog(null);
    setIsLoading(false);
  }, [mappingDialog, sidecarProvenance]);

  const filterData = useCallback((sourceData: SpeechToken[], currentFilters: FilterState) => {
    if (sourceData.length === 0) return [];

    // Build accessor+set pairs for all active filters
    const filterEntries: { accessor: (t: SpeechToken) => string; set: Set<string> }[] = [];
    for (const [key, values] of Object.entries(currentFilters.filters)) {
      if (values.length === 0) continue; // empty = nothing passes, handled below
      const set = new Set(values);
      filterEntries.push({ accessor: t => getLabel(t, key), set });
    }

    // Check if any filter key has an empty array (= nothing passes)
    for (const [, values] of Object.entries(currentFilters.filters)) {
      if (values.length === 0) return [];
    }

    return sourceData.filter(token => {
      for (const { accessor, set } of filterEntries) {
        const val = accessor(token);
        // Empty/missing values are checked against the UNDEFINED_LABEL sentinel
        const effectiveVal = val === '' ? UNDEFINED_LABEL : val;
        if (!set.has(effectiveVal)) return false;
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
    setDatasetMeta(prev => prev && ({
      ...prev,
      columnMappings: prev.columnMappings.map(m =>
        filterFieldKey(m) === key ? { ...m, showInSidebar: visible } : m),
    }));
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
          rawText={mappingDialog.rawText}
          detectedMappings={mappingDialog.detectedMappings}
          fileName={mappingDialog.fileName}
          isEditMode={mappingDialog.isEditMode}
          firstRowIsHeader={mappingDialog.firstRowIsHeader}
          headerDetection={mappingDialog.headerDetection}
          onToggleFirstRowIsHeader={handleToggleFirstRowIsHeader}
        />
      )}
    </div>
  );
};

export default App;
