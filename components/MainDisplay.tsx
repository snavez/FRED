
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { SpeechToken, PlotConfig, ReferenceCentroid, PlotHandle, VariableType, StyleOverrides, Layer, DatasetMeta, NormalizationMethod } from '../types';
import { SpeakerStatsMap, getRangeStep, getAxisLabel, computeNormalizedRange } from '../utils/normalization';
import {
  discoverSpectralColumns, isSpectralRole, listSpectralFeatures, formatSpectralFeature,
  spectralFeatureLabel, parseSpectralFeature, spectralMeasuresOfKind, spectralIndicesOfKind,
  spectralKindsAvailable, spectralRegionsOfKind, hasSpectralRegions, spectralRegionLabel,
  formatSpectralMeasureRef, resolveSpectralAxes, resolveSpectralMeasure, resolveSpectralContour,
  listSpectralContours, spectralContourSteps, getSpectralMeasureDef,
  spectralFeatureOnKind,
  spectralKindLabel, spectralIndexLabel, SpectralKind, SpectralFeature, SpectralMeta,
} from '../utils/spectralMoments';
import { getLabel } from '../utils/getLabel';
import { listFilterFields, filterFieldLabel } from '../utils/filterFields';
import { encodingGroupKey } from '../utils/plotEncoding';
import { collectFormantPoints, findEllipseOutliers, EllipseOutlier } from '../utils/outliers';
import OutlierExportDialog from './OutlierExportDialog';
import CanvasPlot from './CanvasPlot';
import TrajectoryTimeSeries from './TrajectoryTimeSeries';
import TrajectoryF1F2 from './TrajectoryF1F2';
import DurationPlot from './DurationPlot';
import SpectralMomentsPlot from './SpectralMomentsPlot';
import PhonemeDistributionPlot from './PhonemeDistributionPlot';
import Scatter3DPlot from './Scatter3DPlot';
import TablePanel, { AnalysisView } from './TablePanel';
import StyleEditor from './StyleEditor';
import ExportDialog from './ExportDialog';
import { Grid, LineChart, Table, Settings2, MoveUpRight, Printer, Check, Download, BarChart2, PieChart, Box, Waves, Sigma, ArrowDown, ArrowUp, ArrowUpDown, Eye, EyeOff, Plus, X, ChevronUp, ChevronDown, Layers, MessageSquare, HelpCircle } from 'lucide-react';

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
  datasetMeta?: DatasetMeta | null;
  speakerStats: SpeakerStatsMap;
  data: SpeechToken[];
}

// Non-linear opacity slider helpers: x^2 curve gives more travel at the transparent end
const opacityToSlider = (opacity: number) => Math.sqrt(opacity);
const sliderToOpacity = (slider: number) => slider * slider;

/**
 * Tab bar grouping. "General" holds the plots that work on any numeric field —
 * formants, durations and spectral measures alike — so they serve both vowel and
 * consonant work rather than being leftovers.
 */
const TAB_GROUPS: { label: string; tabs: { id: string; label: string; icon: React.ElementType }[] }[] = [
  { label: 'Vowels', tabs: [
    { id: 'vowel', label: 'F1/F2', icon: Grid },
    { id: '3d', label: '3D F1/F2/F3', icon: Box },
    { id: 'traj_series', label: 'Time Series', icon: LineChart },
  ] },
  { label: 'Consonants', tabs: [
    { id: 'spectral', label: 'Spectral', icon: Waves },
  ] },
  { label: 'General', tabs: [
    { id: 'duration', label: 'Data Summaries', icon: BarChart2 },
    { id: 'dist', label: 'Distributions', icon: PieChart },
    { id: 'stats', label: 'Statistics', icon: Sigma },
    { id: 'table', label: 'Table', icon: Table },
  ] },
];

/** Pretty label for a field key */
const prettyLabel = filterFieldLabel;

/** Help tooltip wrapper — shows amber dot + hover popover when helpMode is active.
 *  Uses fixed positioning so the popover escapes overflow:hidden containers. */
const HelpTooltip: React.FC<{ text: string; helpMode: boolean; children: React.ReactNode }> = ({ text, helpMode, children }) => {
  const [show, setShow] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!helpMode) return <>{children}</>;

  // Compute fixed position from wrapper bounding rect
  const getStyle = (): React.CSSProperties => {
    if (!wrapRef.current) return { display: 'none' };
    const r = wrapRef.current.getBoundingClientRect();
    return {
      position: 'fixed',
      left: r.left + r.width / 2,
      top: r.top - 8, // 8px gap above the wrapper
      transform: 'translate(-50%, -100%)',
      zIndex: 9999,
    };
  };

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setShow(true); }}
      onMouseLeave={() => { timeoutRef.current = setTimeout(() => setShow(false), 150); }}
    >
      {children}
      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full border border-white z-10 pointer-events-none" />
      {show && (
        <div
          style={getStyle()}
          className="bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-snug rounded-lg shadow-lg px-3 py-2 min-w-[180px] max-w-[260px] whitespace-normal pointer-events-none"
        >
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-amber-50 border-r border-b border-amber-200 rotate-45 -mt-1" />
          {text}
        </div>
      )}
    </div>
  );
};

const MainDisplay: React.FC<MainDisplayProps> = ({
  layers, layerData, activeLayerId, setActiveLayerId,
  updateLayerConfig, addLayer, removeLayer, reorderLayer,
  toggleLayerVisibility, renameLayer, setActiveConfig,
  globalReferences = [], updateStyleOverride, datasetMeta, speakerStats, data
}) => {
  const [activeTab, setActiveTab] = useState<'vowel' | '3d' | 'traj_f1f2' | 'traj_series' | 'spectral' | 'duration' | 'dist' | 'table'>('vowel');
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingLayerName, setEditingLayerName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [showPointInfoSettings, setShowPointInfoSettings] = useState(false);
  const [showDurationPointInfoSettings, setShowDurationPointInfoSettings] = useState(false);
  const [showSummaryMeasureSettings, setShowSummaryMeasureSettings] = useState(false);
  const [showAnalysisMeasureSettings, setShowAnalysisMeasureSettings] = useState(false);
  const [helpMode, setHelpMode] = useState(false);

  // Dynamic variable options: built from datasetMeta column mappings
  // Exactly the fields the sidebar lists as filters, so anything you can filter by you
  // can also colour, shape or group by.
  const variableOptions = useMemo(() => [
    { label: 'None', value: 'none' as VariableType },
    ...listFilterFields(datasetMeta).map(f => ({ label: f.label, value: f.key as VariableType })),
  ], [datasetMeta]);

  // Numeric variable options (for Duration Y-axis selector)
  const numericVariableOptions = useMemo(() => {
    // Token duration is always plottable and is the default Y, so it leads the list —
    // without it the menu would show one measure while the plot drew another.
    const options: { label: string; value: string }[] = [{ label: 'Duration', value: 'duration' }];
    if (!datasetMeta) return options;
    const seen = new Set<string>(['duration']);
    for (const m of datasetMeta.columnMappings) {
      const key = m.fieldName || m.csvHeader;
      if (!key || seen.has(key)) continue;
      // Include duration-role columns — each as a separate named option
      if (m.role === 'duration') {
        seen.add(key);
        options.push({ label: prettyLabel(key, datasetMeta) || key, value: key });
      }
      // Include pitch-role columns
      if (m.role === 'pitch') {
        seen.add(key);
        options.push({ label: prettyLabel(key, datasetMeta), value: key });
      }
      // Include data fields (isDataField: true) and spectral-measure columns —
      // these are numeric plot values
      if ((m.role === 'field' && m.isDataField) || isSpectralRole(m.role)) {
        seen.add(key);
        options.push({ label: prettyLabel(key, datasetMeta), value: key });
      }
    }
    // Add formant options from actual dataset columns
    for (const m of datasetMeta.columnMappings) {
      if (m.role !== 'formant' || !m.formant) continue;
      const key = m.formant + (m.isSmooth ? '_smooth' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const label = m.isSmooth
        ? `${m.formant.toUpperCase()} (smooth)`
        : m.formant.toUpperCase();
      options.push({ label, value: key });
    }
    return options.length > 0 ? options : [{ label: 'Duration', value: 'duration' }];
  }, [datasetMeta]);

  /** Duration-field candidates for the absolute-mode selector: duration-role columns first,
   *  then numeric data fields whose names look duration-like ("dur", "length", "time"). */
  const durationFieldOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    if (!datasetMeta) return options;
    const seen = new Set<string>();
    for (const m of datasetMeta.columnMappings) {
      if (m.role !== 'duration') continue;
      const key = m.fieldName || m.csvHeader;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      options.push({ label: key, value: key });
    }
    for (const m of datasetMeta.columnMappings) {
      if (m.role !== 'field' || !m.isDataField) continue;
      const key = m.fieldName || m.csvHeader;
      if (!key || seen.has(key)) continue;
      const lower = key.toLowerCase();
      if (lower.includes('dur') || lower.includes('length')) {
        seen.add(key);
        options.push({ label: key, value: key });
      }
    }
    return options;
  }, [datasetMeta]);

  // Set of formant value keys present in the dataset (for conditional time-point selectors)
  const formantValueKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!datasetMeta) return keys;
    for (const m of datasetMeta.columnMappings) {
      if (m.role === 'formant' && m.formant) {
        keys.add(m.formant + (m.isSmooth ? '_smooth' : ''));
      }
    }
    return keys;
  }, [datasetMeta]);

  // Dynamic time-points (from dataset or default 0-100 by 10)
  const availableTimePoints = useMemo(() => {
    if (datasetMeta?.timePoints.length) return datasetMeta.timePoints;
    return [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  }, [datasetMeta]);

  // Helper: get display label for a timepoint (uses named labels if available, else "N%")
  const tpLabel = useCallback((t: number) => {
    return datasetMeta?.timePointLabels?.[t] ?? `${t}%`;
  }, [datasetMeta]);

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

  const [showOutlierExport, setShowOutlierExport] = useState(false);

  const plotRef = useRef<PlotHandle>(null);

  // Derived: active layer & its config
  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId) || layers[0], [layers, activeLayerId]);
  const currentConfig = activeLayer.config;
  // Background config for things that always use background (ranges, etc.)
  const bgConfig = layers[0].config;
  // Active layer data — used by non-F1/F2 plots so sidebar filters affect all views
  const activeData = layerData[activeLayerId] || [];

  // Spectral measures present in the active dataset (COG/SD/skew/kurt/band ratio + timepoints).
  const spectralMeta = useMemo(() => discoverSpectralColumns(activeData, datasetMeta), [activeData, datasetMeta]);

  /** Every scalar the spectral measure picker can offer (box / density). */
  const spectralFeatureOptions = useMemo(() =>
    listSpectralFeatures(spectralMeta).map(f => ({
      value: formatSpectralFeature(f), label: spectralFeatureLabel(f),
    })), [spectralMeta]);

  /**
   * Families whose contour can be averaged over time: every measure that has a grid of
   * ≥2 positions in some region — the dense track when the dataset carries one, else the
   * %-timepoints. Each option is a `region:measure` ref so closure and release stay apart.
   */
  const spectralContourOptions = useMemo(() =>
    listSpectralContours(spectralMeta).map(c => {
      const def = getSpectralMeasureDef(c.measure);
      const steps = spectralContourSteps(spectralMeta, c);
      const source = c.kind === 'track'
        ? `track · ${steps.length} samples`
        : steps.map(i => `${i}%`).join(' / ');
      return {
        value: formatSpectralMeasureRef(c.measure, c.region),
        label: `${def.short}${c.region ? ` · ${c.region}` : ''} · ${source}`,
      };
    }), [spectralMeta]);

  /**
   * The range the spectral plot actually drew. The range inputs show these numbers while
   * a config range is still auto ([0,0]), so the arrows step from what is on screen
   * instead of from a placeholder 0 that would throw the data off the plot.
   */
  const [spectralAutoRange, setSpectralAutoRange] = useState<{ x: [number, number], y: [number, number] } | null>(null);

  /** Round to a sensible step for display in a range box. */
  const roundForInput = (v: number) => {
    const mag = Math.abs(v);
    return mag >= 100 ? Math.round(v) : mag >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  };

  /**
   * Value to show in a range box: the manual range once set, else the drawn range.
   * `axis` picks which auto range to fall back to.
   */
  const spectralRangeValue = (cfgRange: [number, number], axis: 'x' | 'y', end: 0 | 1): number => {
    const isAuto = cfgRange[0] === 0 && cfgRange[1] === 0;
    if (!isAuto) return cfgRange[end];
    const auto = spectralAutoRange?.[axis];
    return auto && (auto[0] !== 0 || auto[1] !== 0) ? roundForInput(auto[end]) : 0;
  };

  /**
   * Editing one end of an auto range seeds the other from what is on screen, so the plot
   * stays sensible instead of collapsing against a 0 the user never chose.
   */
  const spectralRangeEdit = (
    cfgRange: [number, number], axis: 'x' | 'y', end: 0 | 1, raw: string,
  ): [number, number] => {
    const next: [number, number] = [
      spectralRangeValue(cfgRange, axis, 0),
      spectralRangeValue(cfgRange, axis, 1),
    ];
    next[end] = parseFloat(raw) || 0;
    return next;
  };

  /**
   * Speaker structure of the current stats selection: whether speakers exist, whether
   * they contribute several tokens (repeated measures), and whether Factor A varies
   * within speakers. Drives the Unit and Test controls on the Statistics tab.
   */
  const statsSpeakerInfo = useMemo(() => {
    const withSpeaker = activeData.filter(t => t.speaker);
    const speakers = new Set(withSpeaker.map(t => t.speaker));
    const hasSpeakers = speakers.size > 0;
    const repeated = hasSpeakers && withSpeaker.length > speakers.size;
    let within = false;
    const f = currentConfig.tableAnalysisGroupBy;
    if (hasSpeakers && f && f !== 'none') {
      const seen = new Map<string, Set<string>>();
      for (const t of withSpeaker) {
        const l = getLabel(t, f);
        if (!l) continue;
        if (!seen.has(t.speaker)) seen.set(t.speaker, new Set());
        seen.get(t.speaker)!.add(l);
      }
      within = [...seen.values()].some(s => s.size > 1);
    }
    return { hasSpeakers, repeated, within };
  }, [activeData, currentConfig.tableAnalysisGroupBy]);

  /** Compact label for an axis-range heading, e.g. "COG @50%" or "COG k1 (slope)". */
  const spectralAxisChip = (ref: string): string => {
    const f = parseSpectralFeature(ref);
    return f ? spectralFeatureLabel(f) : ref;
  };

  /**
   * Scatter axis state, derived from the stored feature refs. The X ref's kind is the
   * "Data" family; both axes are always held on the same kind so you can never compare
   * a track sample against a %-timepoint by accident.
   */
  const spectralAxes = useMemo(() => {
    // Resolved, not merely parsed: a ref that names no column in this dataset (a fresh
    // config, or a switch to differently-regioned data) shows the fallback the plot draws.
    const { x, y } = resolveSpectralAxes(bgConfig.spectralXFeature, bgConfig.spectralYFeature, spectralMeta);
    const kind: SpectralKind = x?.kind ?? 'point';
    // The X axis names the region the shared position grid belongs to.
    const region = x?.region ?? '';
    return {
      x, y, kind, region,
      kindsAvailable: spectralKindsAvailable(spectralMeta, region),
      regions: spectralRegionsOfKind(spectralMeta, kind),
      showRegions: hasSpectralRegions(spectralMeta),
      measures: spectralMeasuresOfKind(spectralMeta, kind, region),
      measuresFor: (r: string) => spectralMeasuresOfKind(spectralMeta, kind, r),
      indices: spectralIndicesOfKind(spectralMeta, kind, region),
    };
  }, [bgConfig.spectralXFeature, bgConfig.spectralYFeature, spectralMeta]);

  /** Rewrite one axis ref, keeping it valid for its region (measure and position). */
  const setSpectralAxis = (which: 'x' | 'y', next: Partial<SpectralFeature>) => {
    const cur = which === 'x' ? spectralAxes.x : spectralAxes.y;
    const base: SpectralFeature = cur ?? { measure: 'COG', kind: 'point', index: 50, region: '' };
    const merged = { ...base, ...next };
    // A region change can strand the measure or position; snap both back into the region.
    const measures = spectralMeasuresOfKind(spectralMeta, merged.kind, merged.region ?? '');
    const indices = spectralIndicesOfKind(spectralMeta, merged.kind, merged.region ?? '');
    if (measures.length && !measures.some(m => m.key === merged.measure)) merged.measure = measures[0].key;
    if (indices.length && !indices.includes(merged.index)) merged.index = indices[0];
    updateLayerConfig(layers[0].id, which === 'x' ? 'spectralXFeature' : 'spectralYFeature',
      formatSpectralFeature(merged));
  };

  /** Move both axes onto another column kind, keeping each axis's measure and region. */
  const setSpectralKind = (kind: SpectralKind) => {
    const xf = spectralFeatureOnKind(spectralAxes.x, kind, spectralMeta, 0);
    let yf = spectralFeatureOnKind(spectralAxes.y, kind, spectralMeta, 1);
    // Both axes on one column is no plot: step the second along the grid instead. This is
    // what gives a single-measure dataset its k0 × k1 shape space.
    if (xf && yf && formatSpectralFeature(xf) === formatSpectralFeature(yf)) {
      const alt = spectralIndicesOfKind(spectralMeta, kind, yf.region ?? '').find(i => i !== yf!.index);
      if (alt !== undefined) yf = { ...yf, index: alt };
    }
    if (!xf || !yf) return;
    updateLayerConfig(layers[0].id, 'spectralXFeature', formatSpectralFeature(xf));
    updateLayerConfig(layers[0].id, 'spectralYFeature', formatSpectralFeature(yf));
  };

  /** Shared position (timepoint / track sample) — moves both axes together. */
  const setSpectralPosition = (index: number) => {
    setSpectralAxis('x', { index });
    setSpectralAxis('y', { index });
  };

  /** The measure the box/density plot will actually draw, as a ref the picker can show. */
  const spectralFeatureValue = useMemo(() => {
    const f = resolveSpectralMeasure(currentConfig.spectralFeature, bgConfig.spectralXFeature, spectralMeta);
    return f ? formatSpectralFeature(f) : '';
  }, [currentConfig.spectralFeature, bgConfig.spectralXFeature, spectralMeta]);

  /** The contour family the timeline will actually draw. */
  const spectralTimelineValue = useMemo(() => {
    const c = resolveSpectralContour(currentConfig.spectralTimelineMoment, bgConfig.spectralXFeature, spectralMeta);
    return c ? formatSpectralMeasureRef(c.measure, c.region) : '';
  }, [currentConfig.spectralTimelineMoment, bgConfig.spectralXFeature, spectralMeta]);

  /** Grid a trajectory sweeps: the positions the X axis's family offers. */
  const spectralSweepGrid = useMemo(() =>
    spectralAxes.kind === 'coeff' ? [] : spectralAxes.indices,
    [spectralAxes]);

  /**
   * The tokens outside the ellipse the F1/F2 plot is currently drawing — every visible
   * layer, grouped and sampled exactly as that layer draws it, so what the export lists
   * is what the eye picks out on screen. Only computed while the dialog is open.
   */
  const outlierScan = useMemo(() => {
    const empty = { outliers: [] as EllipseOutlier[], checked: 0, skipped: [] as { key: string; count: number }[] };
    if (!showOutlierExport) return empty;
    const visible = layers.filter(l => l.visible);
    const normalization = layers[0].config.normalization || 'hz';
    return visible.reduce((acc, layer) => {
      const cfg = layer.config;
      const maps = {
        colorKey: cfg.colorBy === 'none' ? null : cfg.colorBy,
        shapeKey: cfg.shapeBy === 'none' ? null : cfg.shapeBy,
        lineTypeKey: cfg.lineTypeBy === 'none' ? null : cfg.lineTypeBy,
      };
      const groups = collectFormantPoints(
        layerData[layer.id] || [], cfg,
        t => encodingGroupKey(t, maps, cfg.plotType),
        normalization, speakerStats,
      );
      const scan = findEllipseOutliers(
        groups, cfg.ellipseSD, { x: 'F2', y: 'F1' }, visible.length > 1 ? layer.name : '',
      );
      return {
        outliers: [...acc.outliers, ...scan.outliers],
        checked: acc.checked + scan.checked,
        skipped: [...acc.skipped, ...scan.skipped],
      };
    }, empty);
  }, [showOutlierExport, layers, layerData, speakerStats]);

  /** Most extreme first — the review queue starts with the worst offenders. */
  const sortedOutliers = useMemo(
    () => [...outlierScan.outliers].sort((a, b) => b.distance - a.distance),
    [outlierScan]);

  const handleConfig = (key: keyof PlotConfig, val: any) => {
      updateLayerConfig(activeLayerId, key, val);
  };

  const handleFitToData = useCallback(() => {
    const bgData = layerData['bg'] || [];
    if (bgData.length === 0) return;
    const method = bgConfig.normalization || 'hz' as NormalizationMethod;
    const smooth = bgConfig.useSmoothing;
    const bgId = layers[0].id;
    const f1Range = computeNormalizedRange(bgData, 'f1', method, speakerStats || {}, smooth);
    const f2Range = computeNormalizedRange(bgData, 'f2', method, speakerStats || {}, smooth);
    const f3Range = computeNormalizedRange(bgData, 'f3', method, speakerStats || {}, smooth);
    const tsFreqRange: [number, number] = [Math.min(f1Range[0], f2Range[0]), Math.max(f1Range[1], f2Range[1])];
    updateLayerConfig(bgId, 'f1Range', f1Range);
    updateLayerConfig(bgId, 'f2Range', f2Range);
    updateLayerConfig(bgId, 'f3Range', f3Range);
    updateLayerConfig(bgId, 'timeSeriesFrequencyRange', tsFreqRange);
  }, [layerData, bgConfig.normalization, bgConfig.useSmoothing, layers, speakerStats, updateLayerConfig]);

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
     setActiveConfig(prev => ({ ...prev, selectedReferenceVowels: globalReferences.map(r => r.label) }));
  };

  const clearRefVowels = () => {
    setActiveConfig(prev => ({ ...prev, selectedReferenceVowels: [] }));
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
    const isTrajectory = currentConfig.plotType === 'trajectory';
    if (currentConfig.colorBy !== 'none') active.color = true;
    // Histogram mode uses distHistColorBy instead of colorBy
    if (activeTab === 'dist' && currentConfig.distMode === 'histogram' && currentConfig.distHistColorBy && currentConfig.distHistColorBy !== 'none') active.color = true;
    // Shapes: point mode only (F1/F2 + 3D), not trajectory
    if ((activeTab === 'vowel' || activeTab === '3d') && !isTrajectory && currentConfig.shapeBy !== 'none') active.shape = true;
    // Line type: trajectory mode on F1/F2, or dedicated trajectory tabs
    if (((activeTab === 'vowel' && isTrajectory) || activeTab === 'traj_f1f2' || activeTab === 'traj_series') && currentConfig.lineTypeBy !== 'none') active.lineType = true;
    if ((activeTab === 'dist' || activeTab === 'duration') && currentConfig.textureBy !== 'none') active.texture = true;
    // Spectral Moments: colour is the only grouping channel (all four modes).
    if (activeTab === 'spectral' && currentConfig.colorBy !== 'none') active.color = true;
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
        {variableOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  /** Shared visual-encoding controls (Colour, Shape/Line Type, Lines/Means/Labels/Points/
   *  Ellipses) used by both the F1/F2 plot and the Spectral Moments scatter, so the two share
   *  an identical layout. Operates on the active layer via currentConfig/handleConfig. */
  const renderEncodingControls = () => (
    <>
      {/* Colour */}
      {renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))}

      {/* Shape / Line Type */}
      {currentConfig.plotType === 'trajectory'
        ? renderVariableSelect('Line Type', currentConfig.lineTypeBy, val => handleConfig('lineTypeBy', val))
        : renderVariableSelect('Shape', currentConfig.shapeBy, val => handleConfig('shapeBy', val))
      }

      <div className="w-px h-6 bg-slate-300"></div>

      {/* ── Trajectory mode: Lines / Means / Labels ── */}
      {currentConfig.plotType === 'trajectory' && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">Lines</span>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-[9px] text-slate-500">
                <span>Width</span>
                <input type="range" min="0.5" max="5" step="0.5" title="Individual Line Width" value={currentConfig.trajectoryLineWidth ?? 1} onChange={e => handleConfig('trajectoryLineWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
              </div>
              <div className="flex items-center gap-1 text-[9px] text-slate-500">
                <span>Opacity</span>
                <input type="range" min="0" max="1" step="0.02" title="Individual Line Opacity (0 = hidden)" value={opacityToSlider(currentConfig.trajectoryLineOpacity ?? 0.5)} onChange={e => handleConfig('trajectoryLineOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
              </div>
            </div>
          </div>

          <div className="w-px h-6 bg-slate-200"></div>

          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 cursor-pointer" title="Show Mean Trajectories">
              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showMeanTrajectories} onChange={e => handleConfig('showMeanTrajectories', e.target.checked)} />
              <span className="font-bold">Means</span>
            </label>
            {currentConfig.showMeanTrajectories && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Width</span>
                  <input type="range" min="1" max="10" step="0.5" title="Mean Line Width" value={currentConfig.meanTrajectoryWidth ?? 3} onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                </div>
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Opacity</span>
                  <input type="range" min="0" max="1" step="0.02" title="Mean Line Opacity" value={opacityToSlider(currentConfig.meanTrajectoryOpacity ?? 1)} onChange={e => handleConfig('meanTrajectoryOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                </div>
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Pts</span>
                  <input type="range" min="0" max="10" step="0.5" title="Mean Point Size (0 = hidden)" value={currentConfig.meanTrajectoryPointSize ?? 4} onChange={e => handleConfig('meanTrajectoryPointSize', parseFloat(e.target.value))} className="w-12 h-1 accent-slate-600" />
                </div>
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Arrow</span>
                  <input type="range" min="0" max="8" step="0.5" title="Arrow Size (0 = hidden)" value={currentConfig.meanTrajectoryArrowSize ?? 3} onChange={e => handleConfig('meanTrajectoryArrowSize', parseFloat(e.target.value))} className="w-12 h-1 accent-slate-600" />
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-slate-200"></div>

          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 cursor-pointer" title="Show Trajectory Labels">
              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showTrajectoryLabels} onChange={e => handleConfig('showTrajectoryLabels', e.target.checked)} />
              <span className="font-bold">Labels</span>
            </label>
            {currentConfig.showTrajectoryLabels && (
              <>
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Size</span>
                  <input type="range" min="8" max="72" step="1" title="Label Size" value={currentConfig.meanTrajectoryLabelSize || 12} onChange={e => handleConfig('meanTrajectoryLabelSize', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                </div>
                {(currentConfig.colorBy !== 'none' || currentConfig.lineTypeBy !== 'none') && (
                  <select className="text-[9px] p-0.5 border rounded" title="Label Source" value={currentConfig.meanLabelType} onChange={e => handleConfig('meanLabelType', e.target.value)}>
                    <option value="auto">Auto</option>
                    <option value="color">Color Key</option>
                    <option value="shape">Line Key</option>
                    <option value="both">Both</option>
                  </select>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Point mode: Pts / Ellip / Means / Labels ── */}
      {currentConfig.plotType !== 'trajectory' && (
        <>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 cursor-pointer" title="Show Individual Points">
              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showPoints} onChange={e => handleConfig('showPoints', e.target.checked)} />
              <span className="font-bold">Pts</span>
            </label>
            {currentConfig.showPoints && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Size</span>
                  <input type="range" min="1" max="10" title="Point Size" value={currentConfig.pointSize} onChange={e => handleConfig('pointSize', parseInt(e.target.value))} className="w-16 h-1 accent-slate-600" />
                </div>
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span>Opacity</span>
                  <input type="range" min="0" max="1" step="0.02" title="Point Opacity" value={opacityToSlider(currentConfig.pointOpacity)} onChange={e => handleConfig('pointOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-slate-200"></div>

          <div className="flex items-center gap-1.5 border-r border-slate-200 pr-2">
            <label className="flex items-center gap-1 cursor-pointer" title="Show Standard Deviation Ellipses">
              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showEllipses} onChange={e => handleConfig('showEllipses', e.target.checked)} />
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
                    <input type="range" min="0.5" max="8" step="0.5" title="Line Width" value={currentConfig.ellipseLineWidth} onChange={e => handleConfig('ellipseLineWidth', parseFloat(e.target.value))} className="w-10 h-1 accent-slate-600" />
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-slate-500">
                    <span>Line</span>
                    <input type="range" min="0" max="1" step="0.02" title="Line Opacity" value={opacityToSlider(currentConfig.ellipseLineOpacity)} onChange={e => handleConfig('ellipseLineOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-10 h-1 accent-slate-600" />
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-slate-500">
                    <span>Fill</span>
                    <input type="range" min="0" max="1" step="0.02" title="Fill Opacity" value={opacityToSlider(currentConfig.ellipseFillOpacity)} onChange={e => handleConfig('ellipseFillOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-10 h-1 accent-slate-600" />
                  </div>
                </div>
              </div>
            )}
            <HelpTooltip helpMode={helpMode} text="List every token outside the ellipse around its group, as a CSV to work through — a mistracked formant usually lands well outside its vowel's cloud. Each row says which axis it is extreme on, and carries the fields you need to find the token again.">
            <button
              onClick={() => setShowOutlierExport(true)}
              className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-200 text-[10px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              title={`Export the tokens outside the ${currentConfig.ellipseSD}σ ellipse`}
            >
              <Download size={11} />
              Outliers
            </button>
            </HelpTooltip>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 cursor-pointer" title="Show Means">
              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showCentroids} onChange={e => handleConfig('showCentroids', e.target.checked)} />
              <span className="font-bold">Means</span>
            </label>
            {currentConfig.showCentroids && (
              <>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1 text-[9px] text-slate-500">
                    <span>Size</span>
                    <input type="range" min="4" max="20" title="Centroid Size" value={currentConfig.centroidSize} onChange={e => handleConfig('centroidSize', parseInt(e.target.value))} className="w-16 h-1 accent-slate-600" />
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-slate-500">
                    <span>Opacity</span>
                    <input type="range" min="0" max="1" step="0.02" title="Centroid Opacity" value={opacityToSlider(currentConfig.centroidOpacity)} onChange={e => handleConfig('centroidOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                  </div>
                </div>
                {(currentConfig.colorBy !== 'none' || currentConfig.shapeBy !== 'none') && (
                  <select className="text-[9px] p-0.5 border rounded" title="Label Source" value={currentConfig.meanLabelType} onChange={e => handleConfig('meanLabelType', e.target.value)}>
                    <option value="auto">Auto</option>
                    <option value="color">Color Key</option>
                    <option value="shape">Shape Key</option>
                    <option value="both">Both</option>
                  </select>
                )}
              </>
            )}
          </div>

          <label className="flex items-center gap-1 cursor-pointer ml-1">
            <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.labelAsCentroid} onChange={e => handleConfig('labelAsCentroid', e.target.checked)} />
            <span className="font-bold">Labels</span>
          </label>
          {currentConfig.labelAsCentroid && (
            <div className="flex items-center gap-1 text-[9px] text-slate-500">
              <span>Size</span>
              <input type="range" min="8" max="72" title="Text Size" value={currentConfig.labelSize} onChange={e => handleConfig('labelSize', parseInt(e.target.value))} className="w-10 h-1 accent-slate-600" />
            </div>
          )}
        </>
      )}

      {/* Snap means to grid — only for time-slice data (redundant for percentage). */}
      {currentConfig.plotType === 'trajectory' && currentConfig.showMeanTrajectories && datasetMeta?.trajectoryFormat === 'time-slice' && (
        <>
          <div className="w-px h-6 bg-slate-200"></div>
          <label className="flex items-center gap-1 cursor-pointer" title="Snap mean points to RANGE intervals (fewer, evenly-spaced points)">
            <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.snapMeansToGrid} onChange={e => handleConfig('snapMeansToGrid', e.target.checked)} />
            <span className="font-bold">Snap</span>
          </label>
        </>
      )}
    </>
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
          {/* Tabs grouped by what the plots are for. Every plot stays one click away —
              the labels are an organisational cue, not a second level of navigation. */}
          <div className="flex items-end bg-white p-1 rounded-lg border border-slate-200 w-fit shadow-sm overflow-x-auto">
            {TAB_GROUPS.map((group, gi) => (
              <React.Fragment key={group.label}>
                {gi > 0 && <div className="self-stretch w-px bg-slate-200 mx-1.5 my-1"></div>}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-3 pb-1">{group.label}</span>
                  <div className="flex">
                    {group.tabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-slate-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                      >
                        <tab.icon size={16} /><span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>

          {activeTab !== 'table' && activeTab !== 'stats' && (
             <div className="flex items-center gap-2">
               {/* Layer Panel Button — visible on all tabs */}
               {(
                 <div className="relative">
                   <button
                     onClick={() => setLayerPanelOpen(!layerPanelOpen)}
                     className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${layerPanelOpen ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                   >
                     <Layers size={14} />
                     <span>Layers ({layers.length})</span>
                     <ChevronDown size={12} className={`transition-transform ${layerPanelOpen ? 'rotate-180' : ''}`} />
                   </button>

                   {/* Expanded Layer Panel Dropdown */}
                   {layerPanelOpen && (
                     <div className="absolute top-full mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[240px] p-2">
                       <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                         <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Layers</span>
                         <button onClick={() => setLayerPanelOpen(false)} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
                           <X size={12} />
                         </button>
                       </div>

                       {/* Layer Rows */}
                       <div className="space-y-1 max-h-[300px] overflow-y-auto">
                         {layers.map((layer, idx) => (
                           <div
                             key={layer.id}
                             className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-bold transition-all cursor-pointer ${
                               activeLayerId === layer.id
                                 ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                 : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                             }`}
                             onClick={() => setActiveLayerId(layer.id)}
                           >
                             {/* Type badge */}
                             <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-black shrink-0 ${
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
                                 className="flex-1 min-w-0 text-xs p-0.5 border rounded bg-white text-slate-700 outline-none"
                                 value={editingNameValue}
                                 onChange={e => setEditingNameValue(e.target.value)}
                                 onBlur={commitRename}
                                 onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingLayerName(null); }}
                                 autoFocus
                                 onClick={e => e.stopPropagation()}
                               />
                             ) : (
                               <span
                                 className="flex-1 min-w-0 truncate"
                                 onDoubleClick={(e) => { e.stopPropagation(); startRename(layer.id, layer.name); }}
                                 title={layer.name}
                               >
                                 {layer.name}
                               </span>
                             )}

                             {/* Visibility toggle */}
                             <button
                               onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                               className="p-0.5 hover:bg-slate-200 rounded shrink-0"
                               title={layer.visible ? 'Hide layer' : 'Show layer'}
                             >
                               {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-slate-300" />}
                             </button>

                             {/* Reorder & Delete (non-background only) */}
                             {!layer.isBackground && (
                               <>
                                 <button
                                   onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'up'); }}
                                   className="p-0.5 hover:bg-slate-200 rounded shrink-0"
                                   title="Move up"
                                   disabled={idx <= 1}
                                 >
                                   <ChevronUp size={12} className={idx <= 1 ? 'text-slate-200' : ''} />
                                 </button>
                                 <button
                                   onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'down'); }}
                                   className="p-0.5 hover:bg-slate-200 rounded shrink-0"
                                   title="Move down"
                                   disabled={idx >= layers.length - 1}
                                 >
                                   <ChevronDown size={12} className={idx >= layers.length - 1 ? 'text-slate-200' : ''} />
                                 </button>
                                 <button
                                   onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                                   className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-500 shrink-0"
                                   title="Delete layer"
                                 >
                                   <X size={12} />
                                 </button>
                               </>
                             )}
                           </div>
                         ))}
                       </div>

                       {/* Add Layer Button — F1/F2 and Spectral Moments (both multi-layer canvases) */}
                       {(activeTab === 'vowel' || activeTab === 'spectral') && (
                       <div className="mt-2 pt-2 border-t border-slate-100">
                         <div className="relative">
                           <button
                             onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
                             disabled={layers.length >= 10}
                             className={`w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-bold transition-all ${layers.length >= 10 ? 'text-slate-300 cursor-not-allowed' : 'text-sky-700 hover:bg-sky-50 border border-dashed border-sky-200'}`}
                           >
                             <Plus size={12} />
                             <span>Add Layer</span>
                           </button>
                           {showAddMenu && layers.length < 10 && (
                             <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                               <button
                                 onClick={() => { addLayer('point'); setShowAddMenu(false); }}
                                 className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-sky-50 flex items-center gap-2"
                               >
                                 <span className="w-4 h-4 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-black">P</span>
                                 Point Layer
                               </button>
                               <button
                                 onClick={() => { addLayer('trajectory'); setShowAddMenu(false); }}
                                 className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-sky-50 flex items-center gap-2"
                               >
                                 <span className="w-4 h-4 rounded bg-emerald-100 text-emerald-600 flex items-center justify-center text-[9px] font-black">T</span>
                                 Trajectory Layer
                               </button>
                             </div>
                           )}
                         </div>
                       </div>
                       )}
                     </div>
                   )}
                 </div>
               )}

               {/* Point Info Field Selector (F1/F2, 3D & Spectral Moments) */}
               {(activeTab === 'vowel' || activeTab === '3d' || activeTab === 'spectral') && (
                 <div className="relative">
                   <button
                     onClick={() => setShowPointInfoSettings(!showPointInfoSettings)}
                     className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${showPointInfoSettings ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                     title="Configure point info fields"
                   >
                     <MessageSquare size={14} />
                     <span>Point Info</span>
                   </button>
                   {showPointInfoSettings && (
                     <div className="absolute top-full mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[220px] p-3">
                       <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                         <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Point Info Fields</span>
                         <button onClick={() => setShowPointInfoSettings(false)} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
                           <X size={12} />
                         </button>
                       </div>
                       <div className="max-h-[300px] overflow-y-auto space-y-1">
                         {(() => {
                           const allFields: { key: string; label: string }[] = [];
                           const seen = new Set<string>();
                           if (datasetMeta) {
                             for (const m of datasetMeta.columnMappings) {
                               let key: string | null = null;
                               // Include all non-formant, non-ignore fields (filter + data)
                               if (m.role === 'file_id') key = 'file_id';
                               else if (m.role === 'speaker') key = 'speaker';
                               else if (m.role === 'duration') key = 'duration';
                               else if ((m.role === 'field' || m.role === 'pitch') && m.fieldName) key = m.fieldName;
                               // Case-insensitive dedup to prevent near-duplicates like 'file_id' vs 'File_ID'
                               const dedup = key?.toLowerCase().trim();
                               if (!key || !dedup || seen.has(dedup)) continue;
                               seen.add(dedup);
                               allFields.push({ key, label: prettyLabel(key, datasetMeta) });
                             }
                           }
                           const selected = currentConfig.tooltipFields || [];
                           const atMax = selected.length >= 10;
                           return allFields.map(field => {
                             const isChecked = selected.includes(field.key);
                             return (
                               <label
                                 key={field.key}
                                 className={`flex items-center gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded ${!isChecked && atMax ? 'opacity-40 cursor-not-allowed' : ''}`}
                               >
                                 <input
                                   type="checkbox"
                                   className="rounded text-sky-700"
                                   checked={isChecked}
                                   disabled={!isChecked && atMax}
                                   onChange={() => {
                                     const newFields = isChecked
                                       ? selected.filter(k => k !== field.key)
                                       : [...selected, field.key];
                                     handleConfig('tooltipFields', newFields);
                                   }}
                                 />
                                 <span className="text-slate-700 font-medium">{field.label}</span>
                               </label>
                             );
                           });
                         })()}
                       </div>
                       {(currentConfig.tooltipFields || []).length >= 10 && (
                         <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 italic">Max 10 fields</div>
                       )}
                     </div>
                   )}
                 </div>
               )}

               {/* Point Info Field Selector (Duration) */}
               {activeTab === 'duration' && (
                 <div className="relative">
                   <button
                     onClick={() => setShowDurationPointInfoSettings(!showDurationPointInfoSettings)}
                     className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${showDurationPointInfoSettings ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                     title="Configure point info fields"
                   >
                     <MessageSquare size={14} />
                     <span>Point Info</span>
                   </button>
                   {showDurationPointInfoSettings && (
                     <div className="absolute top-full mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[220px] p-3">
                       <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                         <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Point Info Fields</span>
                         <button onClick={() => setShowDurationPointInfoSettings(false)} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
                           <X size={12} />
                         </button>
                       </div>
                       <div className="max-h-[300px] overflow-y-auto space-y-1">
                         {(() => {
                           const allFields: { key: string; label: string }[] = [];
                           const seen = new Set<string>();
                           if (datasetMeta) {
                             for (const m of datasetMeta.columnMappings) {
                               let key: string | null = null;
                               // Include all non-formant, non-ignore fields (filter + data)
                               if (m.role === 'file_id') key = 'file_id';
                               else if (m.role === 'speaker') key = 'speaker';
                               else if (m.role === 'duration') key = 'duration';
                               else if ((m.role === 'field' || m.role === 'pitch') && m.fieldName) key = m.fieldName;
                               // Case-insensitive dedup to prevent near-duplicates like 'file_id' vs 'File_ID'
                               const dedup = key?.toLowerCase().trim();
                               if (!key || !dedup || seen.has(dedup)) continue;
                               seen.add(dedup);
                               allFields.push({ key, label: prettyLabel(key, datasetMeta) });
                             }
                           }
                           const selected = currentConfig.durationTooltipFields || ['file_id', 'duration'];
                           const atMax = selected.length >= 10;
                           return allFields.map(field => {
                             const isChecked = selected.includes(field.key);
                             return (
                               <label
                                 key={field.key}
                                 className={`flex items-center gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded ${!isChecked && atMax ? 'opacity-40 cursor-not-allowed' : ''}`}
                               >
                                 <input
                                   type="checkbox"
                                   className="rounded text-sky-700"
                                   checked={isChecked}
                                   disabled={!isChecked && atMax}
                                   onChange={() => {
                                     const newFields = isChecked
                                       ? selected.filter(k => k !== field.key)
                                       : [...selected, field.key];
                                     handleConfig('durationTooltipFields', newFields);
                                   }}
                                 />
                                 <span className="text-slate-700 font-medium">{field.label}</span>
                               </label>
                             );
                           });
                         })()}
                       </div>
                       {(currentConfig.durationTooltipFields || []).length >= 10 && (
                         <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 italic">Max 10 fields</div>
                       )}
                     </div>
                   )}
                 </div>
               )}

               <button onClick={() => setHelpMode(!helpMode)} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${helpMode ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`} title="Toggle help tooltips on controls"><HelpCircle size={14} /><span>Help</span></button>
               <button onClick={handleExportClick} className="flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all bg-white text-sky-700 border-sky-200 hover:bg-sky-50"><Download size={14} /><span>Export</span></button>
               <button onClick={() => handleConfig('bwMode', !currentConfig.bwMode)} className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${currentConfig.bwMode ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}><Printer size={14} /><span>B&W</span></button>
             </div>
          )}
        </div>

        {/* Dynamic Config Toolbar */}
        {activeTab !== 'table' && activeTab !== 'stats' && (
          <div className="bg-slate-100 rounded-lg p-3 border border-slate-200 text-xs">

            {/* ═══ F1/F2 & 3D: Two-Row Layout ═══ */}
            {(activeTab === 'vowel' || activeTab === '3d') && (
              <div className="space-y-2">
                {/* ── Row 1: Data & Coordinate Space ── */}
                <div className="flex items-center gap-4 flex-wrap min-h-[40px]">
                  <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <Settings2 size={14} />
                    <span>Config</span>
                  </div>

                  <div className="h-6 w-px bg-slate-300"></div>

                  {/* Data variant */}
                  {datasetMeta?.formantVariants && datasetMeta.formantVariants.length >= 2 && (
                    <HelpTooltip helpMode={helpMode} text="Switch between raw and smoothed formant data. Smoothed values reduce measurement noise from the acoustic analysis.">
                    <div className="flex items-center gap-1.5 mr-2">
                      <span className="font-semibold text-slate-600 flex items-center gap-1"><Waves size={12} />Data:</span>
                      <select
                        value={currentConfig.useSmoothing ? datasetMeta.formantVariants[1] : datasetMeta.formantVariants[0]}
                        onChange={e => handleConfig('useSmoothing', e.target.value !== datasetMeta!.formantVariants![0])}
                        className="text-xs p-1 border border-slate-200 rounded bg-white font-bold text-slate-700"
                        title="Select formant data variant"
                      >
                        {datasetMeta.formantVariants.map(variant => (
                          <option key={variant} value={variant}>{variant}</option>
                        ))}
                      </select>
                    </div>
                    </HelpTooltip>
                  )}

                  {/* Scale */}
                  <HelpTooltip helpMode={helpMode} text="Formant frequency scale. Hz = raw values. Bark/ERB/Mel = psychoacoustic scales. Lobanov/Nearey = speaker-normalised (requires Speaker ID).">
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="font-semibold text-slate-600 flex items-center gap-1"><ArrowUpDown size={12} />Scale:</span>
                    <select
                      value={bgConfig.normalization || 'hz'}
                      onChange={e => updateLayerConfig(layers[0].id, 'normalization', e.target.value as NormalizationMethod)}
                      className="text-xs p-1 border border-slate-200 rounded bg-white font-bold text-slate-700"
                      title="Formant normalization method"
                    >
                      <option value="hz">Hz</option>
                      <option value="bark">Bark</option>
                      <option value="erb">ERB</option>
                      <option value="mel">Mel</option>
                      <option value="lobanov">Lobanov</option>
                      <option value="nearey1">Nearey 1</option>
                    </select>
                  </div>
                  </HelpTooltip>

                  {/* Axis ranges */}
                  <div className="flex items-center gap-2 border-r border-slate-300 pr-4 mr-2">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">{getAxisLabel('F1', (bgConfig.normalization || 'hz') as NormalizationMethod)}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Min</span>
                        <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [parseFloat(e.target.value), bgConfig.f1Range[1]])} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Max</span>
                        <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [bgConfig.f1Range[0], parseFloat(e.target.value)])} />
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">{getAxisLabel('F2', (bgConfig.normalization || 'hz') as NormalizationMethod)}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Min</span>
                        <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [parseFloat(e.target.value), bgConfig.f2Range[1]])} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-slate-500">Max</span>
                        <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [bgConfig.f2Range[0], parseFloat(e.target.value)])} />
                      </div>
                    </div>
                    {activeTab === '3d' && (
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">{getAxisLabel('F3', (bgConfig.normalization || 'hz') as NormalizationMethod)}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f3Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f3Range', [parseFloat(e.target.value), bgConfig.f3Range[1]])} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f3Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f3Range', [bgConfig.f3Range[0], parseFloat(e.target.value)])} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mode */}
                  <HelpTooltip helpMode={helpMode} text="Point mode plots individual tokens at a single timepoint. Trajectory mode draws formant movement lines across time.">
                  <div className="flex items-center gap-1.5">
                    <label className="font-semibold text-slate-600">Mode:</label>
                    <select
                      className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 text-xs font-bold"
                      value={currentConfig.plotType}
                      onChange={e => {
                        const newType = e.target.value;
                        handleConfig('plotType', newType);
                        if (newType === 'trajectory') {
                          // Ensure trajectory range spans full range on mode switch
                          const maxTime = availableTimePoints.length > 0 ? availableTimePoints[availableTimePoints.length - 1] : 100;
                          const minTime = availableTimePoints.length > 0 ? availableTimePoints[0] : 0;
                          if ((currentConfig.trajectoryOnset ?? 0) >= (currentConfig.trajectoryOffset ?? 100)) {
                            handleConfig('trajectoryOnset', minTime);
                            handleConfig('trajectoryOffset', maxTime);
                          }
                        }
                      }}
                    >
                      <option value="point">Point</option>
                      <option value="trajectory">Trajectory</option>
                    </select>
                  </div>
                  </HelpTooltip>

                  {/* Time / Range */}
                  {currentConfig.plotType !== 'trajectory' ? (
                    <div className="flex items-center gap-2">
                      <label className="font-semibold text-slate-600">Time:</label>
                      <select
                        className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 w-16"
                        value={currentConfig.timePoint}
                        onChange={e => handleConfig('timePoint', parseInt(e.target.value))}
                      >
                        {availableTimePoints.map(t => (
                          <option key={t} value={t}>{tpLabel(t)}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Range</span>
                        <div className="flex items-center gap-1">
                          <select className="p-0.5 border rounded text-[10px] w-12" value={currentConfig.trajectoryOnset ?? 0} onChange={e => handleConfig('trajectoryOnset', parseInt(e.target.value))}>
                            {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                          </select>
                          <span className="text-slate-400">-</span>
                          <select className="p-0.5 border rounded text-[10px] w-12" value={currentConfig.trajectoryOffset ?? 100} onChange={e => handleConfig('trajectoryOffset', parseInt(e.target.value))}>
                            {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Row 2: Visual Controls (shared with Spectral Moments scatter) ── */}
                <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                  {renderEncodingControls()}
                </div>
              </div>
            )}

            {/* ═══ Non-vowel/3d tabs: original flat layout ═══ */}
            {activeTab !== 'vowel' && activeTab !== '3d' && (
              <>
              <div className="flex flex-wrap items-center gap-4 min-h-[44px]">
                <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <Settings2 size={14} />
                  <span>Config</span>
                </div>

                <div className="h-6 w-px bg-slate-300"></div>

                {/* ── Spectral Moments Row 1: Mode / Axes / Type / Moment / Time ── */}
                {activeTab === 'spectral' && !spectralMeta.available && (
                  <span className="text-xs text-slate-400 italic">
                    No spectral columns (COG / SD / skew / kurt / band ratio, tracks or coefficients) detected in this dataset.
                  </span>
                )}
                {activeTab === 'spectral' && spectralMeta.available && (
                  <>
                    {/* Which plot */}
                    <div className="flex items-center gap-2">
                      <label className="font-semibold text-slate-600">Plot:</label>
                      <select
                        className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                        value={currentConfig.spectralMode}
                        onChange={e => handleConfig('spectralMode', e.target.value)}
                      >
                        <option value="scatter">Scatter</option>
                        <option value="box">Distribution</option>
                        <option value="timeline">Mean contours</option>
                        <option value="density">Density</option>
                      </select>
                    </div>

                    {/* Which variant of that plot */}
                    {currentConfig.spectralMode === 'scatter' && (
                      <HelpTooltip helpMode={helpMode} text={`Points = one marker per token. Trajectory = a path through the axis space over time, swept along whichever data set is chosen below.`}>
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Mode:</label>
                        <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={currentConfig.plotType}
                          onChange={e => {
                            const next = e.target.value;
                            handleConfig('plotType', next);
                            // Coefficients cannot be swept, so move the axes onto a
                            // time-varying kind rather than leaving the plot on a
                            // selection the Data dropdown can no longer show.
                            if (next === 'trajectory' && spectralAxes.kind === 'coeff') {
                              setSpectralKind(spectralAxes.kindsAvailable.find(k => k !== 'coeff') ?? 'point');
                            }
                          }}>
                          <option value="point">Points</option>
                          <option value="trajectory">Trajectory</option>
                        </select>
                      </div>
                      </HelpTooltip>
                    )}
                    {currentConfig.spectralMode === 'box' && (
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Mode:</label>
                        <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={currentConfig.spectralViolin ? 'violin' : 'box'} onChange={e => handleConfig('spectralViolin', e.target.value === 'violin')}>
                          <option value="box">Box</option>
                          <option value="violin">Violin</option>
                        </select>
                      </div>
                    )}
                    {currentConfig.spectralMode === 'timeline' && (
                      <HelpTooltip helpMode={helpMode} text="Normalised draws every token on a 0→1 axis, which discards duration — a 30 ms and a 120 ms segment look the same width. Absolute uses each token's real duration in milliseconds; the group mean is drawn only where enough tokens still overlap.">
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Mode:</label>
                        <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={currentConfig.spectralContourAbsolute ? 'absolute' : 'normalised'} onChange={e => handleConfig('spectralContourAbsolute', e.target.value === 'absolute')}>
                          <option value="normalised">Normalised</option>
                          <option value="absolute">Absolute (ms)</option>
                        </select>
                      </div>
                      </HelpTooltip>
                    )}

                    {/* Scatter: which data set, then the axes within it */}
                    {currentConfig.spectralMode === 'scatter' && (
                      <>
                        {spectralAxes.kindsAvailable.length > 1 && (
                          <HelpTooltip helpMode={helpMode} text="Which set of columns to plot. Both axes stay on the same set, so you can never compare a track sample against a %-timepoint by accident. Coefficients describe contour shape (k0 height, k1 slope, k2 curvature) and have no time axis, so they cannot be swept as a trajectory.">
                          <div className="flex items-center gap-2">
                            <label className="font-semibold text-slate-600">Data:</label>
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={spectralAxes.kind}
                              onChange={e => setSpectralKind(e.target.value as SpectralKind)}>
                              {spectralAxes.kindsAvailable
                                .filter(k => currentConfig.plotType !== 'trajectory' || k !== 'coeff')
                                .map(k => <option key={k} value={k}>{spectralKindLabel(k)}</option>)}
                            </select>
                          </div>
                          </HelpTooltip>
                        )}

                        <HelpTooltip helpMode={helpMode} text="Axes define the shared coordinate space for every layer, so they live on the background layer.">
                        <div className="flex items-center gap-2">
                          <label className="font-semibold text-slate-600">Axes X:</label>
                          <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                            value={spectralAxes.x?.measure ?? ''}
                            onChange={e => setSpectralAxis('x', { measure: e.target.value as any })}>
                            {spectralAxes.measuresFor(spectralAxes.x?.region ?? '').map(m => <option key={m.key} value={m.key}>{m.short}</option>)}
                          </select>
                          {/* Region: which phase of the segment this axis measures (closure, release …) */}
                          {spectralAxes.showRegions && (
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                              value={spectralAxes.x?.region ?? ''}
                              onChange={e => setSpectralAxis('x', { region: e.target.value })}>
                              {spectralAxes.regions.map(r => <option key={r} value={r}>{spectralRegionLabel(r)}</option>)}
                            </select>
                          )}
                          {/* Coefficients pick their order per axis — k0 × k1 of one measure is the point */}
                          {spectralAxes.kind === 'coeff' && (
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                              value={spectralAxes.x?.index ?? 0}
                              onChange={e => setSpectralAxis('x', { index: parseInt(e.target.value, 10) })}>
                              {spectralAxes.indices.map(i => <option key={i} value={i}>{spectralIndexLabel('coeff', i)}</option>)}
                            </select>
                          )}
                          <label className="font-semibold text-slate-600">Y:</label>
                          <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                            value={spectralAxes.y?.measure ?? ''}
                            onChange={e => setSpectralAxis('y', { measure: e.target.value as any })}>
                            {spectralAxes.measuresFor(spectralAxes.y?.region ?? '').map(m => <option key={m.key} value={m.key}>{m.short}</option>)}
                          </select>
                          {/* Axes may sit in different regions — closure COG against release COG */}
                          {spectralAxes.showRegions && (
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                              value={spectralAxes.y?.region ?? ''}
                              onChange={e => setSpectralAxis('y', { region: e.target.value })}>
                              {spectralAxes.regions.map(r => <option key={r} value={r}>{spectralRegionLabel(r)}</option>)}
                            </select>
                          )}
                          {spectralAxes.kind === 'coeff' && (
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                              value={spectralAxes.y?.index ?? 0}
                              onChange={e => setSpectralAxis('y', { index: parseInt(e.target.value, 10) })}>
                              {spectralAxes.indices.map(i => <option key={i} value={i}>{spectralIndexLabel('coeff', i)}</option>)}
                            </select>
                          )}
                        </div>
                        </HelpTooltip>

                        {/* Points: one shared position, as with formants. Trajectory: a sweep range. */}
                        {currentConfig.plotType !== 'trajectory' && spectralAxes.kind !== 'coeff' && spectralAxes.indices.length > 1 && (
                          <div className="flex items-center gap-2">
                            <label className="font-semibold text-slate-600">{spectralAxes.kind === 'track' ? 'Sample:' : 'Time:'}</label>
                            <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700"
                              value={spectralAxes.x?.index ?? spectralAxes.indices[0]}
                              onChange={e => setSpectralPosition(parseFloat(e.target.value))}>
                              {spectralAxes.indices.map(i => <option key={i} value={i}>{spectralIndexLabel(spectralAxes.kind, i)}</option>)}
                            </select>
                          </div>
                        )}
                        {currentConfig.plotType === 'trajectory' && spectralSweepGrid.length > 1 && (
                          <HelpTooltip helpMode={helpMode} text="Trim the sweep to part of the segment — useful when the first or last sample is unreliable (the track is inset by half an analysis window, so the endpoints are not literally the segment edges).">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Range</span>
                            <div className="flex items-center gap-1">
                              <select className="p-0.5 border rounded text-[10px]"
                                value={bgConfig.spectralTrajRange[0] || spectralSweepGrid[0]}
                                onChange={e => updateLayerConfig(layers[0].id, 'spectralTrajRange', [parseFloat(e.target.value), bgConfig.spectralTrajRange[1] || spectralSweepGrid[spectralSweepGrid.length - 1]])}>
                                {spectralSweepGrid.map(i => <option key={i} value={i}>{spectralIndexLabel(spectralAxes.kind, i)}</option>)}
                              </select>
                              <span className="text-slate-400">–</span>
                              <select className="p-0.5 border rounded text-[10px]"
                                value={bgConfig.spectralTrajRange[1] || spectralSweepGrid[spectralSweepGrid.length - 1]}
                                onChange={e => updateLayerConfig(layers[0].id, 'spectralTrajRange', [bgConfig.spectralTrajRange[0] || spectralSweepGrid[0], parseFloat(e.target.value)])}>
                                {spectralSweepGrid.map(i => <option key={i} value={i}>{spectralIndexLabel(spectralAxes.kind, i)}</option>)}
                              </select>
                            </div>
                          </div>
                          </HelpTooltip>
                        )}
                      </>
                    )}

                    {/* Box / density: one scalar feature (active layer) */}
                    {(currentConfig.spectralMode === 'box' || currentConfig.spectralMode === 'density') && (
                      <HelpTooltip helpMode={helpMode} text="The value being summarised. Coefficients describe the shape of the measurement contour: k0 its overall height, k1 its slope, k2 its curvature. A box plot of k1 by group turns a visual impression of contour direction into a comparable number.">
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Measure:</label>
                        <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={spectralFeatureValue} onChange={e => handleConfig('spectralFeature', e.target.value)}>
                          {spectralFeatureOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      </HelpTooltip>
                    )}

                    {/* Contours: which measure to average */}
                    {currentConfig.spectralMode === 'timeline' && (
                      <HelpTooltip helpMode={helpMode} text="Plots every available value of one spectral measure against segment position: dense track samples when that family has them, otherwise percentage points such as 20/50/80%. Faded lines are individual tokens; coloured lines are group means. This does not change the separate scatter Trajectory mode.">
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Measure:</label>
                        <select className="p-1.5 border border-slate-300 rounded bg-white text-slate-700" value={spectralTimelineValue} onChange={e => handleConfig('spectralTimelineMoment', e.target.value)}>
                          {spectralContourOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      </HelpTooltip>
                    )}
                  </>
                )}

                {/* Mode toggle (dist tab) */}
                {activeTab === 'dist' && (
                  <HelpTooltip helpMode={helpMode} text="Counts = categorical bar chart of token frequencies. Distribution = continuous histogram of a numeric variable (duration, formants, etc.).">
                  <div className="flex items-center gap-1.5">
                    <label className="font-semibold text-slate-600">Mode:</label>
                    <select
                      className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 text-xs font-bold"
                      value={currentConfig.distMode || 'counts'}
                      onChange={e => handleConfig('distMode', e.target.value)}
                    >
                      <option value="counts">Counts</option>
                      <option value="histogram">Distribution</option>
                    </select>
                  </div>
                  </HelpTooltip>
                )}

                {/* Data variant (traj tabs) */}
                {(activeTab === 'traj_f1f2' || activeTab === 'traj_series') && datasetMeta?.formantVariants && datasetMeta.formantVariants.length >= 2 && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="font-semibold text-slate-600 flex items-center gap-1"><Waves size={12} />Data:</span>
                    <select
                      value={currentConfig.useSmoothing ? datasetMeta.formantVariants[1] : datasetMeta.formantVariants[0]}
                      onChange={e => handleConfig('useSmoothing', e.target.value !== datasetMeta!.formantVariants![0])}
                      className="text-xs p-1 border border-slate-200 rounded bg-white font-bold text-slate-700"
                      title="Select formant data variant"
                    >
                      {datasetMeta.formantVariants.map(variant => (
                        <option key={variant} value={variant}>{variant}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Scale (traj tabs) */}
                {(activeTab === 'traj_f1f2' || activeTab === 'traj_series') && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="font-semibold text-slate-600 flex items-center gap-1"><ArrowUpDown size={12} />Scale:</span>
                    <select
                      value={bgConfig.normalization || 'hz'}
                      onChange={e => updateLayerConfig(layers[0].id, 'normalization', e.target.value as NormalizationMethod)}
                      className="text-xs p-1 border border-slate-200 rounded bg-white font-bold text-slate-700"
                      title="Formant normalization method"
                    >
                      <option value="hz">Hz</option>
                      <option value="bark">Bark</option>
                      <option value="erb">ERB</option>
                      <option value="mel">Mel</option>
                      <option value="lobanov">Lobanov</option>
                      <option value="nearey1">Nearey 1</option>
                    </select>
                  </div>
                )}

                {/* Range Controls */}
                {(activeTab !== 'spectral' || spectralMeta.available) && (
                <div className="flex items-center gap-2 border-r border-slate-300 pr-4 mr-2">
                  {/* Spectral scatter: manual axis ranges on the shared (background) coordinate
                      space, labelled by the current axis measures. 0 / 0 = auto-fit. */}
                  {activeTab === 'spectral' && currentConfig.spectralMode === 'scatter' && (
                    <>
                      <div className="flex flex-col" title="X axis range — set both to 0 for auto-fit">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">X · {spectralAxes.x ? spectralFeatureLabel(spectralAxes.x) : ''}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(bgConfig.spectralXRange, 'x', 0)} onChange={e => updateLayerConfig(layers[0].id, 'spectralXRange', spectralRangeEdit(bgConfig.spectralXRange, 'x', 0, e.target.value))} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(bgConfig.spectralXRange, 'x', 1)} onChange={e => updateLayerConfig(layers[0].id, 'spectralXRange', spectralRangeEdit(bgConfig.spectralXRange, 'x', 1, e.target.value))} />
                        </div>
                      </div>
                      <div className="flex flex-col" title="Y axis range — set both to 0 for auto-fit">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">Y · {spectralAxes.y ? spectralFeatureLabel(spectralAxes.y) : ''}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(bgConfig.spectralYRange, 'y', 0)} onChange={e => updateLayerConfig(layers[0].id, 'spectralYRange', spectralRangeEdit(bgConfig.spectralYRange, 'y', 0, e.target.value))} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(bgConfig.spectralYRange, 'y', 1)} onChange={e => updateLayerConfig(layers[0].id, 'spectralYRange', spectralRangeEdit(bgConfig.spectralYRange, 'y', 1, e.target.value))} />
                        </div>
                      </div>
                    </>
                  )}
                  {/* Spectral summary modes: value-axis range for the active layer.
                      Density plots the measure on X; box/timeline plot it on Y. */}
                  {activeTab === 'spectral' && currentConfig.spectralMode !== 'scatter' && (() => {
                    const isDensity = currentConfig.spectralMode === 'density';
                    const rangeKey = isDensity ? 'spectralXRange' : 'spectralYRange';
                    const axis = isDensity ? 'x' : 'y';
                    const range = (currentConfig[rangeKey] || [0, 0]) as [number, number];
                    return (
                      <div className="flex flex-col" title="Value axis range — set both to 0 for auto-fit">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">
                          {currentConfig.spectralMode === 'timeline'
                            ? (spectralContourOptions.find(o => o.value === spectralTimelineValue)?.label ?? '')
                            : spectralAxisChip(spectralFeatureValue)}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(range, axis, 0)} onChange={e => handleConfig(rangeKey, spectralRangeEdit(range, axis, 0, e.target.value))} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step="any" className="w-14 p-0.5 border rounded text-[10px]" value={spectralRangeValue(range, axis, 1)} onChange={e => handleConfig(rangeKey, spectralRangeEdit(range, axis, 1, e.target.value))} />
                        </div>
                      </div>
                    );
                  })()}
                  {activeTab === 'traj_f1f2' && (
                    <>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">{getAxisLabel('F1', (bgConfig.normalization || 'hz') as NormalizationMethod)}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [parseFloat(e.target.value), bgConfig.f1Range[1]])} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f1Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f1Range', [bgConfig.f1Range[0], parseFloat(e.target.value)])} />
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-slate-400 uppercase leading-tight">{getAxisLabel('F2', (bgConfig.normalization || 'hz') as NormalizationMethod)}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Min</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[0]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [parseFloat(e.target.value), bgConfig.f2Range[1]])} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-slate-500">Max</span>
                          <input type="number" step={getRangeStep(bgConfig.normalization || 'hz')} className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.f2Range[1]} onChange={e => updateLayerConfig(layers[0].id, 'f2Range', [bgConfig.f2Range[0], parseFloat(e.target.value)])} />
                        </div>
                      </div>
                    </>
                  )}
                  {activeTab === 'traj_series' && (
                    <>
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
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Range</span>
                      <div className="flex items-center gap-1">
                        <select className="p-0.5 border rounded text-[10px] w-12" value={currentConfig.trajectoryOnset ?? 0} onChange={e => handleConfig('trajectoryOnset', parseInt(e.target.value))}>
                          {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                        </select>
                        <span className="text-slate-400">-</span>
                        <select className="p-0.5 border rounded text-[10px] w-12" value={currentConfig.trajectoryOffset ?? 100} onChange={e => handleConfig('trajectoryOffset', parseInt(e.target.value))}>
                          {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col justify-center">
                      <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">X-Axis</span>
                      <div className="flex rounded border border-slate-300 overflow-hidden">
                        <button
                          className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${currentConfig.timeNormalized !== false ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                          onClick={() => handleConfig('timeNormalized', true)}
                        >Normalised</button>
                        <button
                          className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${currentConfig.timeNormalized === false ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                          onClick={() => handleConfig('timeNormalized', false)}
                        >Absolute</button>
                      </div>
                    </div>
                    {/* Duration field selector — only when absolute mode AND percentage-format data
                        (time-slice data uses its own native extraction range). */}
                    {currentConfig.timeNormalized === false && datasetMeta?.trajectoryFormat === 'percentage' && durationFieldOptions.length > 0 && (
                      <div className="flex flex-col justify-center">
                        <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Duration from</span>
                        <select
                          className="p-0.5 border rounded text-[10px]"
                          value={currentConfig.trajectoryDurationField ?? ''}
                          onChange={e => handleConfig('trajectoryDurationField', e.target.value || undefined)}
                          title="Choose which field provides token durations for absolute time-series scaling"
                        >
                          {durationFieldOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    </>
                  )}
                  {activeTab === 'duration' && (
                    <>
                      <HelpTooltip helpMode={helpMode} text="Choose the variable for the Y-axis. Duration is the default. You can also plot formant values (F1/F2/F3) or other numeric fields from your dataset.">
                      <div className="flex items-center gap-2">
                        <label className="font-semibold text-slate-600">Y-Axis:</label>
                        <select className="p-0.5 border rounded text-[10px]" value={currentConfig.durationYField || 'duration'} onChange={e => handleConfig('durationYField', e.target.value)}>
                          {numericVariableOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                      </HelpTooltip>
                      {formantValueKeys.has(currentConfig.durationYField || '') && (
                        <div className="flex flex-col justify-center">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Time</span>
                          <select className="p-0.5 border rounded text-[10px]"
                            value={currentConfig.durationFormantTimePoint ?? 50}
                            onChange={e => handleConfig('durationFormantTimePoint', parseInt(e.target.value))}>
                            {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                          </select>
                        </div>
                      )}
                      {/* Min is only honoured below zero: a duration axis starts at 0,
                          a signed measure (skew, a coefficient, the band ratio) does not. */}
                      <div className="flex flex-col justify-center">
                        <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Value Range</span>
                        <div className="flex items-center gap-1">
                          <input type="number" step="0.1" className="w-14 p-0.5 border rounded text-[10px]"
                            title="Axis minimum. 0 = auto; only a negative value moves the floor below zero."
                            value={bgConfig.durationRange[0]}
                            onChange={e => updateLayerConfig(layers[0].id, 'durationRange', [parseFloat(e.target.value) || 0, bgConfig.durationRange[1]])} />
                          <span className="text-[9px] text-slate-400">–</span>
                          <input type="number" step="0.1" className="w-14 p-0.5 border rounded text-[10px]"
                            title="Axis maximum. 0 = auto."
                            value={bgConfig.durationRange[1]}
                            onChange={e => updateLayerConfig(layers[0].id, 'durationRange', [bgConfig.durationRange[0], parseFloat(e.target.value) || 0])} />
                        </div>
                      </div>
                    </>
                  )}
                  {activeTab === 'dist' && currentConfig.distMode !== 'histogram' && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold text-slate-500">Max Count</span>
                      <input type="number" step="10" className="w-12 p-0.5 border rounded text-[10px]" value={bgConfig.countRange[1]} onChange={e => updateLayerConfig(layers[0].id, 'countRange', [0, parseInt(e.target.value)])} />
                    </div>
                  )}
                </div>
                )}

                {/* Duration Row 1 continued: Whiskers, Centre, Order */}
                {activeTab === 'duration' && (
                  <>
                    <HelpTooltip helpMode={helpMode} text="Controls how far whisker lines extend. IQR = 1.5× interquartile range (outliers shown separately). Range = full min-to-max span.">
                    <div className="flex flex-col justify-center">
                      <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Whiskers</span>
                      <div className="flex rounded border border-slate-300 overflow-hidden">
                        <button
                          className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.boxWhiskerMode || 'iqr') === 'iqr' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                          onClick={() => handleConfig('boxWhiskerMode', 'iqr')}
                        >1.5×IQR</button>
                        <button
                          className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.boxWhiskerMode || 'iqr') === 'minmax' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                          onClick={() => handleConfig('boxWhiskerMode', 'minmax')}
                        >Range</button>
                      </div>
                    </div>
                    </HelpTooltip>

                    <HelpTooltip helpMode={helpMode} text="The thick line inside the box. Median = middle value (robust to outliers). Mean = arithmetic average. Values prints that number beside each box.">
                    <div className="flex flex-col justify-center">
                      <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Centre</span>
                      <div className="flex items-center gap-2">
                        <div className="flex rounded border border-slate-300 overflow-hidden">
                          <button
                            className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.boxCenterLine || 'median') === 'median' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            onClick={() => handleConfig('boxCenterLine', 'median')}
                          >Median</button>
                          <button
                            className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.boxCenterLine || 'median') === 'mean' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            onClick={() => handleConfig('boxCenterLine', 'mean')}
                          >Mean</button>
                        </div>
                        <label className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer">
                          <input type="checkbox" className="rounded text-sky-700 scale-90" checked={!!currentConfig.showCenterValueLabels}
                            onChange={e => handleConfig('showCenterValueLabels', e.target.checked)} />
                          Values
                        </label>
                      </div>
                    </div>
                    </HelpTooltip>

                    <HelpTooltip helpMode={helpMode} text="Box ordering on X-axis. Alpha = alphabetical. Central = sorted by median/mean centrality. Arrow toggles ascending/descending.">
                    <div className="flex flex-col justify-center">
                      <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Order</span>
                      <div className="flex items-center gap-1">
                        <div className="flex rounded border border-slate-300 overflow-hidden">
                          <button
                            className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.durationBoxOrder || 'alpha') === 'alpha' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            onClick={() => handleConfig('durationBoxOrder', 'alpha')}
                          >Alpha</button>
                          <button
                            className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${(currentConfig.durationBoxOrder || 'alpha') === 'central' ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            onClick={() => handleConfig('durationBoxOrder', 'central')}
                          >Central</button>
                        </div>
                        <button
                          onClick={() => handleConfig('durationBoxDir', currentConfig.durationBoxDir === 'asc' ? 'desc' : 'asc')}
                          className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600"
                          title={currentConfig.durationBoxDir === 'asc' ? 'Ascending' : 'Descending'}
                        >
                          {currentConfig.durationBoxDir === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                        </button>
                      </div>
                    </div>
                    </HelpTooltip>
                  </>
                )}

                {/* General Visualization Controls (spectral has its own Row 2 for these) */}
                {activeTab !== 'duration' && activeTab !== 'traj_series' && activeTab !== 'dist' && activeTab !== 'spectral' && (
                  renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))
                )}

                {activeTab !== 'traj_series' && activeTab !== 'duration' && activeTab !== 'dist' && activeTab !== 'spectral' && (
                  <div className="h-6 w-px bg-slate-300"></div>
                )}

            {/* Distribution: Histogram mode Row 1 — X Variable, Time, Y-Axis */}
            {activeTab === 'dist' && currentConfig.distMode === 'histogram' && (
                <>
                    <div className="h-6 w-px bg-slate-300"></div>
                    <div className="flex items-center gap-4">
                      {/* X Variable */}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">X Variable</span>
                        <select className="p-1 border border-slate-300 rounded text-[10px]"
                          value={currentConfig.distHistXVar || 'duration'}
                          onChange={e => handleConfig('distHistXVar', e.target.value)}>
                          {numericVariableOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Time point selector (only for formant variables) */}
                      {formantValueKeys.has(currentConfig.distHistXVar || '') && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Time</span>
                          <select className="p-1 border border-slate-300 rounded text-[10px]"
                            value={currentConfig.distHistTimePoint ?? 50}
                            onChange={e => handleConfig('distHistTimePoint', parseInt(e.target.value))}>
                            {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Y Mode */}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Y-Axis</span>
                        <select className="p-1 border border-slate-300 rounded text-[10px]"
                          value={currentConfig.distHistYMode || 'count'}
                          onChange={e => handleConfig('distHistYMode', e.target.value)}>
                          <option value="count">Count</option>
                          <option value="density">Density</option>
                        </select>
                      </div>
                    </div>
                </>
            )}

            {/* Distribution Counts: ordering controls in Row 1 */}
            {activeTab === 'dist' && currentConfig.distMode !== 'histogram' && (
                <>
                    <HelpTooltip helpMode={helpMode} text="Sort the top-level groups on the X-axis. Count = by total frequency. Alpha = alphabetically. Arrow toggles ascending/descending.">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Group Order</span>
                      <div className="flex items-center gap-1">
                        <select className="p-1 border border-slate-300 rounded text-[10px]" value={currentConfig.distGroupOrder} onChange={e => handleConfig('distGroupOrder', e.target.value)}>
                          <option value="count">Count</option>
                          <option value="alpha">Alpha</option>
                        </select>
                        <button onClick={() => handleConfig('distGroupDir', currentConfig.distGroupDir === 'asc' ? 'desc' : 'asc')} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600" title={currentConfig.distGroupDir === 'asc' ? 'Ascending' : 'Descending'}>
                          {currentConfig.distGroupDir === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                        </button>
                      </div>
                    </div>
                    </HelpTooltip>

                    <HelpTooltip helpMode={helpMode} text="Sort individual bars within each group. Count = by value. Alpha = alphabetically. Arrow toggles ascending/descending.">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Bar Order</span>
                      <div className="flex items-center gap-1">
                        <select className="p-1 border border-slate-300 rounded text-[10px]" value={currentConfig.distBarOrder} onChange={e => handleConfig('distBarOrder', e.target.value)}>
                          <option value="count">Count</option>
                          <option value="alpha">Alpha</option>
                        </select>
                        <button onClick={() => handleConfig('distBarDir', currentConfig.distBarDir === 'asc' ? 'desc' : 'asc')} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600" title={currentConfig.distBarDir === 'asc' ? 'Ascending' : 'Descending'}>
                          {currentConfig.distBarDir === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                        </button>
                      </div>
                    </div>
                    </HelpTooltip>

                    <div className="h-6 w-px bg-slate-300"></div>

                    <HelpTooltip helpMode={helpMode} text="Grouped = bars side by side for each category. Stacked = bars stacked vertically within each group.">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Bar Mode</span>
                      <select className="p-1 border border-slate-300 rounded text-[10px]" value={currentConfig.distBarMode || 'grouped'} onChange={e => handleConfig('distBarMode', e.target.value)}>
                        <option value="grouped">Grouped</option>
                        <option value="stacked">Stacked</option>
                      </select>
                    </div>
                    </HelpTooltip>

                    {currentConfig.textureBy !== 'none' && currentConfig.textureBy !== currentConfig.colorBy && (
                      <HelpTooltip helpMode={helpMode} text="When both Colour and Texture are set to different variables, choose which variable forms the primary grouping level.">
                      <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2 duration-300">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Cluster By</span>
                        <select className="p-1 border border-slate-300 rounded text-[10px] max-w-[80px]" value={currentConfig.distPrimaryVar || 'color'} onChange={e => handleConfig('distPrimaryVar', e.target.value)}>
                          <option value="color">Color ({currentConfig.colorBy})</option>
                          <option value="texture">Pattern ({currentConfig.textureBy})</option>
                        </select>
                      </div>
                      </HelpTooltip>
                    )}

                    <HelpTooltip helpMode={helpMode} text="Count = show raw token counts. Percent = show percentages. In stacked+percentage mode, the 100% button normalises each stack to fill 100%.">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Values</span>
                      <div className="flex items-center gap-1">
                        <select className="p-1 border border-slate-300 rounded text-[10px]" value={currentConfig.distValueMode || 'count'} onChange={e => handleConfig('distValueMode', e.target.value)}>
                          <option value="count">Count</option>
                          <option value="percentage">Percent</option>
                        </select>
                        {currentConfig.distValueMode === 'percentage' && currentConfig.distBarMode === 'stacked' && (
                          <button onClick={() => handleConfig('distNormalize', !currentConfig.distNormalize)} className={`p-1 border rounded text-[10px] ${currentConfig.distNormalize ? 'bg-sky-100 border-sky-200 text-sky-800' : 'bg-white border-slate-300 text-slate-600'}`} title="Normalize each stack to 100%">100%</button>
                        )}
                      </div>
                    </div>
                    </HelpTooltip>
                </>
            )}


            {/* ... Rest of Toggles ... */}
            {activeTab === 'traj_f1f2' && (
               <>
                  {renderVariableSelect('Line Type', currentConfig.lineTypeBy, v => handleConfig('lineTypeBy', v))}

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Line Opacity</span>
                     <input type="range" min="0" max="1" step="0.02" value={opacityToSlider(currentConfig.trajectoryLineOpacity)} onChange={e => handleConfig('trajectoryLineOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                   </div>

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Mean Width</span>
                     <input type="range" min="1" max="10" step="0.5" value={currentConfig.meanTrajectoryWidth} onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                   </div>

                   <div className="flex items-center gap-1 ml-2">
                     <span className="text-slate-500 font-bold">Mean Opacity</span>
                     <input type="range" min="0" max="1" step="0.02" value={opacityToSlider(currentConfig.meanTrajectoryOpacity)} onChange={e => handleConfig('meanTrajectoryOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                   </div>

                   <div className="flex items-center gap-1 ml-2">
                     <label className="flex items-center gap-1 cursor-pointer text-slate-500 font-bold">
                       <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showTrajectoryLabels} onChange={e => handleConfig('showTrajectoryLabels', e.target.checked)} />
                       <span>Lbl</span>
                     </label>
                     {currentConfig.showTrajectoryLabels && (
                       <input type="range" min="8" max="72" step="1" title="Label Size" value={currentConfig.meanTrajectoryLabelSize || 12} onChange={e => handleConfig('meanTrajectoryLabelSize', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                     )}
                   </div>

                   {currentConfig.showTrajectoryLabels && (currentConfig.colorBy !== 'none' || currentConfig.lineTypeBy !== 'none') && (
                     <select
                       className="text-[9px] p-0.5 border rounded ml-2"
                       title="Label Source"
                       value={currentConfig.meanLabelType}
                       onChange={e => handleConfig('meanLabelType', e.target.value)}
                     >
                       <option value="auto">Auto</option>
                       <option value="color">Color Key</option>
                       <option value="shape">Line Key</option>
                       <option value="both">Both</option>
                     </select>
                   )}

                   {/* traj_f1f2 reference vowels */}
                   <div className="relative ml-2">
                        <button
                            onClick={() => {
                            handleConfig('showReferenceVowels', !currentConfig.showReferenceVowels);
                            if (!currentConfig.showReferenceVowels) setShowRefDropdown(true);
                            }}
                            className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border shadow-sm transition-colors ${currentConfig.showReferenceVowels ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                        >
                            <Check size={12} className={currentConfig.showReferenceVowels ? 'opacity-100' : 'opacity-0'} />
                            <span>Refs</span>
                        </button>

                        {currentConfig.showReferenceVowels && (
                            <button onClick={() => setShowRefDropdown(!showRefDropdown)} className="ml-1 text-[10px] text-sky-700 underline font-bold">Config</button>
                        )}
                        {showRefDropdown && currentConfig.showReferenceVowels && (
                            <div className="absolute top-full mt-2 left-0 bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-64 z-50">
                            <div className="flex justify-between border-b border-slate-100 pb-2 mb-2">
                                <span className="font-bold text-slate-500">Reference Settings</span>
                                <button onClick={() => setShowRefDropdown(false)} className="text-slate-400 hover:text-slate-600">×</button>
                            </div>

                            <div className="mb-3 space-y-2 pb-3 border-b border-slate-100">
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Label Size</span>
                                    <input type="range" min="8" max="24" value={currentConfig.refVowelLabelSize} onChange={e => handleConfig('refVowelLabelSize', parseInt(e.target.value))} className="w-24 h-1 accent-slate-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Label Opacity</span>
                                    <input type="range" min="0" max="1" step="0.02" value={opacityToSlider(currentConfig.refVowelLabelOpacity)} onChange={e => handleConfig('refVowelLabelOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-24 h-1 accent-slate-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Ellipse Opacity</span>
                                    <input type="range" min="0" max="1" step="0.02" value={opacityToSlider(currentConfig.refVowelEllipseLineOpacity)} onChange={e => handleConfig('refVowelEllipseLineOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-24 h-1 accent-slate-600" />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>Fill Opacity</span>
                                    <input type="range" min="0" max="1" step="0.02" value={opacityToSlider(currentConfig.refVowelEllipseFillOpacity)} onChange={e => handleConfig('refVowelEllipseFillOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-24 h-1 accent-slate-600" />
                                </div>
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {globalReferences.map(ref => (
                                <label key={ref.label} className="flex items-center space-x-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded">
                                    <input type="checkbox" checked={currentConfig.selectedReferenceVowels.includes(ref.label)} onChange={() => toggleReferenceVowel(ref.label)} className="rounded text-sky-700" />
                                    <span className="font-mono font-bold text-slate-700">{ref.label}</span>
                                </label>
                                ))}
                            </div>
                            <div className="pt-2 mt-2 border-t border-slate-100 flex justify-between text-[10px]">
                                <button onClick={selectAllRefVowels} className="text-sky-700 hover:underline">All</button>
                                <button onClick={clearRefVowels} className="text-slate-400 hover:underline">None</button>
                            </div>
                            </div>
                        )}
                        </div>
               </>
            )}

              </div>

            {/* ── Time Series: Row 2 — Colour, Line Type, Lines / Means / Labels ── */}
            {activeTab === 'traj_series' && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                {/* Colour */}
                {renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))}

                {/* Line Type */}
                {renderVariableSelect('Line Type', currentConfig.lineTypeBy, v => handleConfig('lineTypeBy', v))}

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Lines */}
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">Lines</span>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1 text-[9px] text-slate-500">
                      <span>Width</span>
                      <input type="range" min="0.5" max="5" step="0.5" title="Individual Line Width" value={currentConfig.trajectoryLineWidth ?? 1} onChange={e => handleConfig('trajectoryLineWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-slate-500">
                      <span>Opacity</span>
                      <input type="range" min="0" max="1" step="0.02" title="Individual Line Opacity (0 = hidden)" value={opacityToSlider(currentConfig.trajectoryLineOpacity ?? 0.5)} onChange={e => handleConfig('trajectoryLineOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                    </div>
                  </div>
                </div>

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Means */}
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1 cursor-pointer" title="Show Mean Trajectories">
                    <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showMeanTrajectories} onChange={e => handleConfig('showMeanTrajectories', e.target.checked)} />
                    <span className="font-bold">Means</span>
                  </label>
                  {currentConfig.showMeanTrajectories && (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1 text-[9px] text-slate-500">
                        <span>Width</span>
                        <input type="range" min="1" max="10" step="0.5" title="Mean Line Width" value={currentConfig.meanTrajectoryWidth ?? 3} onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-slate-500">
                        <span>Opacity</span>
                        <input type="range" min="0" max="1" step="0.02" title="Mean Line Opacity" value={opacityToSlider(currentConfig.meanTrajectoryOpacity ?? 1)} onChange={e => handleConfig('meanTrajectoryOpacity', sliderToOpacity(parseFloat(e.target.value)))} className="w-16 h-1 accent-slate-600" />
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-slate-500">
                        <span>Pts</span>
                        <input type="range" min="0" max="10" step="0.5" title="Mean Point Size (0 = hidden)" value={currentConfig.meanTrajectoryPointSize ?? 4} onChange={e => handleConfig('meanTrajectoryPointSize', parseFloat(e.target.value))} className="w-12 h-1 accent-slate-600" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Labels */}
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1 cursor-pointer" title="Show Trajectory Labels">
                    <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showTrajectoryLabels} onChange={e => handleConfig('showTrajectoryLabels', e.target.checked)} />
                    <span className="font-bold">Labels</span>
                  </label>
                  {currentConfig.showTrajectoryLabels && (
                    <>
                      <div className="flex items-center gap-1 text-[9px] text-slate-500">
                        <span>Size</span>
                        <input type="range" min="8" max="72" step="1" title="Label Size" value={currentConfig.meanTrajectoryLabelSize || 12} onChange={e => handleConfig('meanTrajectoryLabelSize', parseFloat(e.target.value))} className="w-16 h-1 accent-slate-600" />
                      </div>
                      {(currentConfig.colorBy !== 'none' || currentConfig.lineTypeBy !== 'none') && (
                        <select className="text-[9px] p-0.5 border rounded" title="Label Source" value={currentConfig.meanLabelType} onChange={e => handleConfig('meanLabelType', e.target.value)}>
                          <option value="auto">Auto</option>
                          <option value="color">Color Key</option>
                          <option value="shape">Line Key</option>
                          <option value="both">Both</option>
                        </select>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Duration: Row 2 — Plot By, Colour, Texture, Group By, Show ── */}
            {activeTab === 'duration' && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                {renderVariableSelect('Plot By', currentConfig.durationPlotBy || 'none', v => handleConfig('durationPlotBy', v))}
                {renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))}
                {renderVariableSelect('Texture', currentConfig.textureBy, v => handleConfig('textureBy', v))}

                {(() => {
                  const clusterOpts: { label: string; value: string }[] = [{ label: 'None', value: 'none' }];
                  const seen = new Set<string>();
                  for (const vk of [currentConfig.colorBy, currentConfig.textureBy]) {
                    if (vk && vk !== 'none' && !seen.has(vk)) {
                      seen.add(vk);
                      const opt = variableOptions.find(o => o.value === vk);
                      clusterOpts.push({ label: opt?.label || vk, value: vk });
                    }
                  }
                  if (clusterOpts.length <= 1) return null;
                  const curCluster = currentConfig.durationClusterBy || 'none';
                  if (curCluster !== 'none' && !clusterOpts.some(o => o.value === curCluster)) {
                    setTimeout(() => handleConfig('durationClusterBy', 'none'), 0);
                  }
                  return (
                    <div className="flex items-center gap-2">
                      <label className="font-semibold text-slate-600">Group By:</label>
                      <select
                        className="p-1.5 border border-slate-300 rounded bg-white text-slate-700 max-w-[120px]"
                        value={curCluster}
                        onChange={e => handleConfig('durationClusterBy', e.target.value)}
                      >
                        {clusterOpts.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })()}

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Show Toggles — heading above checkboxes */}
                <HelpTooltip helpMode={helpMode} text="Toggle visibility of box plot elements. Quartiles = Q1-Q3 box. Outliers = points beyond 1.5×IQR (only in IQR whisker mode). Points = raw data jittered on the plot.">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Show</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer" title="Quartile Boxes">
                      <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showQuartiles} onChange={e => handleConfig('showQuartiles', e.target.checked)} />
                      <span className="text-[10px] font-bold text-slate-600">Quartiles</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer" title="Outlier points (IQR mode only)">
                      <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showOutliers} onChange={e => handleConfig('showOutliers', e.target.checked)} />
                      <span className={`text-[10px] font-bold ${(currentConfig.boxWhiskerMode || 'iqr') === 'iqr' ? 'text-slate-600' : 'text-slate-300'}`}>Outliers</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer" title="Show individual data points">
                      <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.boxShowPoints} onChange={e => handleConfig('boxShowPoints', e.target.checked)} />
                      <span className="text-[10px] font-bold text-slate-600">Points</span>
                    </label>
                    {currentConfig.boxShowPoints && (
                      <input
                        type="range"
                        min="0" max="1" step="0.02"
                        title="Point Opacity"
                        value={opacityToSlider(currentConfig.pointOpacity)}
                        onChange={e => handleConfig('pointOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                        className="w-14 h-1 accent-slate-600"
                      />
                    )}
                  </div>
                </div>
                </HelpTooltip>

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Box Width & Gap Controls */}
                <HelpTooltip helpMode={helpMode} text="W = box width in pixels (0 = auto). GG = gap between clusters (slot units). BG = gap between boxes within a cluster.">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Layout</span>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1" title="Box Width (0 = auto)">
                      <span className="text-[9px] text-slate-500">W</span>
                      <input type="number" min="0" max="100" step="1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.boxWidth || 0} onChange={e => handleConfig('boxWidth', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="flex items-center gap-1" title="Group Gap (cluster spacing)">
                      <span className="text-[9px] text-slate-500">GG</span>
                      <input type="number" min="0" max="5" step="0.1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.durationGroupGap ?? 1.5} onChange={e => handleConfig('durationGroupGap', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="flex items-center gap-1" title="Box Gap (space between boxes)">
                      <span className="text-[9px] text-slate-500">BG</span>
                      <input type="number" min="0" max="5" step="0.1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.durationBoxGap ?? 0.4} onChange={e => handleConfig('durationBoxGap', parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
                </HelpTooltip>
              </div>
            )}

            {/* ── Spectral Moments: Row 2 — Visual Controls (Colour onwards, matching F1/F2) ── */}
            {activeTab === 'spectral' && spectralMeta.available && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                {/* Scatter: full F1/F2-style encoding controls (Colour, Shape/Line Type,
                    Lines/Means/Labels/Points/Ellipses) — identical layout to the F1/F2 tab. */}
                {currentConfig.spectralMode === 'scatter' && renderEncodingControls()}

                {/* Summary modes: colour, then the visual controls for that mode */}
                {currentConfig.spectralMode !== 'scatter' && (
                  <>
                    {renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))}
                    {currentConfig.spectralMode === 'timeline' &&
                      renderVariableSelect('Line Type', currentConfig.lineTypeBy, v => handleConfig('lineTypeBy', v))}
                    {currentConfig.spectralMode === 'box' &&
                      renderVariableSelect('Fill Type', currentConfig.textureBy, v => handleConfig('textureBy', v))}
                    {currentConfig.spectralMode === 'density' &&
                      renderVariableSelect('Line Type', currentConfig.lineTypeBy, v => handleConfig('lineTypeBy', v))}
                    {currentConfig.spectralMode === 'box' && spectralIndicesOfKind(spectralMeta, 'coeff').length > 1 && (
                      <label className="flex items-center gap-1 cursor-pointer ml-1" title="Show one mini plot per coefficient, sharing the group axis. Each panel gets its own scale, so k0 doesn't dwarf the rest.">
                        <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.spectralCoeffFacets} onChange={e => handleConfig('spectralCoeffFacets', e.target.checked)} />
                        <span className="text-[10px] font-bold text-slate-600">All coefficients</span>
                      </label>
                    )}
                    {(currentConfig.spectralMode === 'box' || currentConfig.spectralMode === 'density')
                      && parseSpectralFeature(spectralFeatureValue)?.kind === 'coeff' && (
                      <label className="flex items-center gap-1 cursor-pointer ml-1" title="Negate the coefficient. A rising contour has a negative k1, so flipping the sign makes 'higher = rising' read naturally.">
                        <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.spectralFlipSign} onChange={e => handleConfig('spectralFlipSign', e.target.checked)} />
                        <span className="text-[10px] font-bold text-slate-600">Flip sign</span>
                      </label>
                    )}

                    {/* Mean contours: individual lines, mean lines, points, labels, band */}
                    {currentConfig.spectralMode === 'timeline' && (
                      <>
                        <div className="w-px h-6 bg-slate-200"></div>
                        <HelpTooltip helpMode={helpMode} text="The faded per-token contours behind the means. With hundreds of tokens, a low opacity reads as a cloud; a higher one shows individual shapes.">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Lines</span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer" title="Show individual token contours">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.spectralShowIndividual} onChange={e => handleConfig('spectralShowIndividual', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Individual</span>
                            </label>
                            {currentConfig.spectralShowIndividual && (
                              <>
                                <input type="range" min="0" max="1" step="0.02" title="Line Opacity"
                                  value={opacityToSlider(currentConfig.trajectoryLineOpacity ?? 0.15)}
                                  onChange={e => handleConfig('trajectoryLineOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                                  className="w-14 h-1 accent-slate-600" />
                                <input type="number" min="0.5" max="6" step="0.5" title="Line Width"
                                  className="w-10 p-0.5 border rounded text-[10px]"
                                  value={currentConfig.trajectoryLineWidth || 1}
                                  onChange={e => handleConfig('trajectoryLineWidth', parseFloat(e.target.value) || 1)} />
                              </>
                            )}
                          </div>
                        </div>
                        </HelpTooltip>

                        <HelpTooltip helpMode={helpMode} text="The group mean contours: line width and opacity, the sample dots along them, and the ±1 SD band showing spread at each position.">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Means</span>
                          <div className="flex items-center gap-2">
                            <input type="number" min="0.5" max="12" step="0.5" title="Mean Line Width"
                              className="w-10 p-0.5 border rounded text-[10px]"
                              value={currentConfig.meanTrajectoryWidth || 3}
                              onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value) || 1)} />
                            <input type="range" min="0" max="1" step="0.02" title="Mean Line Opacity"
                              value={opacityToSlider(currentConfig.meanTrajectoryOpacity ?? 1)}
                              onChange={e => handleConfig('meanTrajectoryOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                              className="w-14 h-1 accent-slate-600" />
                            <label className="flex items-center gap-1 cursor-pointer" title="Dots at each sampled position">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showMeanTrajectoryPoints !== false} onChange={e => handleConfig('showMeanTrajectoryPoints', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Pts</span>
                            </label>
                            {currentConfig.showMeanTrajectoryPoints !== false && (
                              <input type="range" min="1" max="10" step="0.5" title="Point Size"
                                value={currentConfig.meanTrajectoryPointSize ?? 4}
                                onChange={e => handleConfig('meanTrajectoryPointSize', parseFloat(e.target.value))}
                                className="w-14 h-1 accent-slate-600" />
                            )}
                            <label className="flex items-center gap-1 cursor-pointer" title="Shade ±1 standard deviation around each group mean">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.spectralShowBand} onChange={e => handleConfig('spectralShowBand', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">±1 SD</span>
                            </label>
                            {currentConfig.spectralShowBand && (
                              <input type="range" min="0" max="1" step="0.02" title="Band Opacity"
                                value={opacityToSlider(currentConfig.spectralBandOpacity ?? 0.18)}
                                onChange={e => handleConfig('spectralBandOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                                className="w-14 h-1 accent-slate-600" />
                            )}
                          </div>
                        </div>
                        </HelpTooltip>

                        <HelpTooltip helpMode={helpMode} text="Name each mean contour at its end, so the plot reads without the legend.">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Labels</span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer" title="Label each group mean">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showTrajectoryLabels} onChange={e => handleConfig('showTrajectoryLabels', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Show</span>
                            </label>
                            {currentConfig.showTrajectoryLabels && (
                              <input type="range" min="8" max="36" step="1" title="Label Size"
                                value={currentConfig.meanTrajectoryLabelSize || 12}
                                onChange={e => handleConfig('meanTrajectoryLabelSize', parseFloat(e.target.value))}
                                className="w-16 h-1 accent-slate-600" />
                            )}
                          </div>
                        </div>
                        </HelpTooltip>
                      </>
                    )}

                    {/* Distribution: the same box vocabulary as the Data Summaries tab */}
                    {currentConfig.spectralMode === 'box' && (
                      <>
                        <div className="w-px h-6 bg-slate-200"></div>
                        <HelpTooltip helpMode={helpMode} text="What the box shows. Quartiles = the Q1–Q3 body. Whiskers reach 1.5×IQR into the data (outliers drawn separately) or the full min/max. The thick line is the median or the mean. Mean adds a diamond marker; Points scatters the raw values.">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Show</span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer" title="Quartile box (Q1–Q3)">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showQuartiles !== false} onChange={e => handleConfig('showQuartiles', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Quartiles</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="Points beyond the whiskers (IQR mode only)">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showOutliers !== false} onChange={e => handleConfig('showOutliers', e.target.checked)} />
                              <span className={`text-[10px] font-bold ${(currentConfig.boxWhiskerMode || 'iqr') === 'iqr' ? 'text-slate-600' : 'text-slate-300'}`}>Outliers</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="Mean marker (diamond)">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.showMeanMarker} onChange={e => handleConfig('showMeanMarker', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Mean</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="Raw values, jittered across the slot">
                              <input type="checkbox" className="rounded text-sky-700" checked={currentConfig.boxShowPoints} onChange={e => handleConfig('boxShowPoints', e.target.checked)} />
                              <span className="text-[10px] font-bold text-slate-600">Points</span>
                            </label>
                            {currentConfig.boxShowPoints && (
                              <>
                                <input type="range" min="0" max="1" step="0.02" title="Point Opacity"
                                  value={opacityToSlider(currentConfig.pointOpacity)}
                                  onChange={e => handleConfig('pointOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                                  className="w-14 h-1 accent-slate-600" />
                                <input type="range" min="1" max="16" step="1" title="Point Size"
                                  value={currentConfig.pointSize}
                                  onChange={e => handleConfig('pointSize', parseFloat(e.target.value))}
                                  className="w-14 h-1 accent-slate-600" />
                              </>
                            )}
                          </div>
                        </div>
                        </HelpTooltip>

                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Box</span>
                          <div className="flex items-center gap-2">
                            <select className="p-0.5 border rounded text-[10px]" title="Whisker extent"
                              value={currentConfig.boxWhiskerMode || 'iqr'} onChange={e => handleConfig('boxWhiskerMode', e.target.value)}>
                              <option value="iqr">1.5×IQR</option>
                              <option value="minmax">Min–Max</option>
                            </select>
                            <select className="p-0.5 border rounded text-[10px]" title="Centre line"
                              value={currentConfig.boxCenterLine || 'median'} onChange={e => handleConfig('boxCenterLine', e.target.value)}>
                              <option value="median">Median</option>
                              <option value="mean">Mean</option>
                            </select>
                            <label className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer" title="Print the centre value beside each box">
                              <input type="checkbox" className="rounded text-sky-700 scale-90" checked={!!currentConfig.showCenterValueLabels}
                                onChange={e => handleConfig('showCenterValueLabels', e.target.checked)} />
                              Values
                            </label>
                            <div className="flex items-center gap-1" title="Box width in px (0 = auto)">
                              <span className="text-[9px] text-slate-500">W</span>
                              <input type="number" min="0" max="200" step="1" className="w-10 p-0.5 border rounded text-[10px]"
                                value={currentConfig.boxWidth || 0}
                                onChange={e => handleConfig('boxWidth', parseFloat(e.target.value) || 0)} />
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Density: curve weight and fill */}
                    {currentConfig.spectralMode === 'density' && (
                      <>
                        <div className="w-px h-6 bg-slate-200"></div>
                        <HelpTooltip helpMode={helpMode} text="Line width and opacity affect only the density curves. Fill opacity independently controls the shaded area beneath them.">
                        <div className="flex items-end gap-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase leading-none">Line Width</span>
                            <input type="range" min="0.5" max="12" step="0.5" title="Line Width"
                              value={currentConfig.meanTrajectoryWidth || 2}
                              onChange={e => handleConfig('meanTrajectoryWidth', parseFloat(e.target.value) || 1)}
                              className="w-16 h-1 accent-slate-600" />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase leading-none">Line Opacity</span>
                            <input type="range" min="0" max="1" step="0.02" title="Line Opacity"
                              value={opacityToSlider(currentConfig.meanTrajectoryOpacity ?? 1)}
                              onChange={e => handleConfig('meanTrajectoryOpacity', sliderToOpacity(parseFloat(e.target.value)))}
                              className="w-16 h-1 accent-slate-600" />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase leading-none">Fill Opacity</span>
                            <input type="range" min="0" max="1" step="0.02" title="Fill Opacity"
                              value={opacityToSlider(currentConfig.spectralDensityFill ?? 0.18)}
                              onChange={e => handleConfig('spectralDensityFill', sliderToOpacity(parseFloat(e.target.value)))}
                              className="w-16 h-1 accent-slate-600" />
                          </label>
                        </div>
                        </HelpTooltip>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Dist Counts: Row 2 — Colour, Texture, Layout ── */}
            {activeTab === 'dist' && currentConfig.distMode !== 'histogram' && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                {renderVariableSelect('Plot By', currentConfig.distPlotBy || 'none', v => handleConfig('distPlotBy', v))}
                {renderVariableSelect('Group By', currentConfig.groupBy, v => handleConfig('groupBy', v))}
                {renderVariableSelect('Colour', currentConfig.colorBy, v => handleConfig('colorBy', v))}
                {renderVariableSelect('Texture By', currentConfig.textureBy, v => handleConfig('textureBy', v))}

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Bar Width & Gap Controls */}
                <HelpTooltip helpMode={helpMode} text="Bar width = bar width in pixels (0 = auto). Group gap = gap between the Group By clusters (needs Group By set). Bar gap = gap between bars inside a cluster.">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase leading-none mb-0.5">Layout</span>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1" title="Bar Width (0 = auto)">
                      <span className="text-[9px] text-slate-500">Bar width</span>
                      <input type="number" min="0" max="100" step="1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.distBarWidth || 0} onChange={e => handleConfig('distBarWidth', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="flex items-center gap-1" title="Group Gap (needs Group By)">
                      <span className={`text-[9px] ${currentConfig.groupBy !== 'none' ? 'text-slate-500' : 'text-slate-300'}`}>Group gap</span>
                      <input type="number" min="0" max="50" step="1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.distGroupGap || 0} onChange={e => handleConfig('distGroupGap', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="flex items-center gap-1" title="Bar Gap">
                      <span className="text-[9px] text-slate-500">Bar gap</span>
                      <input type="number" min="0" max="20" step="1" className="w-10 p-0.5 border rounded text-[10px]" value={currentConfig.distBarGap || 0} onChange={e => handleConfig('distBarGap', parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
                </HelpTooltip>
              </div>
            )}

            {/* ── Dist Histogram: Row 2 — Colour, Overlap, Opacity, Bins ── */}
            {activeTab === 'dist' && currentConfig.distMode === 'histogram' && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 min-h-[40px]">
                {renderVariableSelect('Plot By', currentConfig.distPlotBy || 'none', v => handleConfig('distPlotBy', v))}
                {renderVariableSelect('Colour', currentConfig.distHistColorBy || 'none', v => handleConfig('distHistColorBy', v))}

                {/* Overlap mode (only when colouring) */}
                {currentConfig.distHistColorBy && currentConfig.distHistColorBy !== 'none' && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Overlap</span>
                    <select className="p-1 border border-slate-300 rounded text-[10px]"
                      value={currentConfig.distHistOverlap || 'stacked'}
                      onChange={e => handleConfig('distHistOverlap', e.target.value)}>
                      <option value="stacked">Stacked</option>
                      <option value="overlaid">Overlaid</option>
                    </select>
                  </div>
                )}

                {/* Opacity slider (overlaid only) */}
                {currentConfig.distHistColorBy && currentConfig.distHistColorBy !== 'none' && currentConfig.distHistOverlap === 'overlaid' && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-500">Opacity</span>
                    <input type="range" min="0.1" max="1" step="0.05"
                      value={currentConfig.distHistOpacity ?? 0.6}
                      onChange={e => handleConfig('distHistOpacity', parseFloat(e.target.value))}
                      className="w-16 h-1 accent-slate-600" />
                  </div>
                )}

                <div className="w-px h-6 bg-slate-200"></div>

                {/* Bins */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold text-slate-500 uppercase">Bins</span>
                  <input type="number" min="5" max="200" step="1"
                    className="w-12 p-0.5 border rounded text-[10px]"
                    value={currentConfig.distHistBinCount || 30}
                    onChange={e => handleConfig('distHistBinCount', Math.max(1, parseInt(e.target.value) || 30))} />
                </div>
              </div>
            )}

              </>
            )}

          </div>
        )}

        {/* ═══ Table Tab Config Bar ═══ */}
        {(activeTab === 'table' || activeTab === 'stats') && (
          <div className="bg-slate-100 rounded-lg p-3 border border-slate-200 text-xs">
            <div className="flex flex-wrap items-center gap-4 min-h-[44px]">
              <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <Settings2 size={14} />
                <span>Config</span>
              </div>

              {/* Mode selector (Table only — Statistics has its own controls) */}
              {activeTab === 'table' && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold text-slate-500 uppercase">Mode</span>
                <select className="p-1 border border-slate-300 rounded text-[10px]"
                  value={['browse', 'summary'].includes(currentConfig.tableMode) ? currentConfig.tableMode : 'browse'}
                  onChange={e => handleConfig('tableMode', e.target.value)}>
                  <option value="browse">Browse</option>
                  <option value="summary">Summary</option>
                </select>
              </div>
              )}

              <div className="h-6 w-px bg-slate-300"></div>

              {/* Browse mode controls */}
              {activeTab === 'table' && (currentConfig.tableMode || 'browse') === 'browse' && availableTimePoints.length > 1 && (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Time</span>
                    <select className="p-1 border border-slate-300 rounded text-[10px]"
                      value={currentConfig.tableFormantTime ?? 50}
                      onChange={e => handleConfig('tableFormantTime', parseInt(e.target.value))}
                      disabled={currentConfig.tableExpandTimePoints}>
                      {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" className="rounded text-sky-700"
                      checked={currentConfig.tableExpandTimePoints || false}
                      onChange={e => handleConfig('tableExpandTimePoints', e.target.checked)} />
                    <span className="text-[10px] font-bold text-slate-600">Expand all time points</span>
                  </label>
                </>
              )}

              {/* Summary mode controls */}
              {activeTab === 'table' && currentConfig.tableMode === 'summary' && (() => {
                const selectedMeasures = currentConfig.tableSummaryMeasures || ['duration'];
                const hasFormantMeasure = selectedMeasures.some(m => formantValueKeys.has(m));
                return (
                <>
                  {renderVariableSelect('Group By', currentConfig.tableSummaryGroupBy || 'none', v => handleConfig('tableSummaryGroupBy', v))}

                  {/* Measures multi-select popover */}
                  <div className="relative">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Measures</span>
                      <button
                        onClick={() => setShowSummaryMeasureSettings(!showSummaryMeasureSettings)}
                        className={`px-2 py-1 text-[10px] font-medium border rounded transition-all text-left min-w-[100px] ${
                          showSummaryMeasureSettings
                            ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {selectedMeasures.length === 1
                          ? numericVariableOptions.find(o => o.value === selectedMeasures[0])?.label || selectedMeasures[0]
                          : `${selectedMeasures.length} selected`
                        }
                      </button>
                    </div>
                    {showSummaryMeasureSettings && (
                      <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[200px] p-3">
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Measures</span>
                          <button onClick={() => setShowSummaryMeasureSettings(false)} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
                            <X size={12} />
                          </button>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto space-y-1">
                          {numericVariableOptions.map(opt => {
                            const isChecked = selectedMeasures.includes(opt.value);
                            const isLastChecked = isChecked && selectedMeasures.length === 1;
                            const atMax = selectedMeasures.length >= 10;
                            return (
                              <label
                                key={opt.value}
                                className={`flex items-center gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded ${
                                  isLastChecked ? 'opacity-50 cursor-not-allowed' : !isChecked && atMax ? 'opacity-40 cursor-not-allowed' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded text-sky-700"
                                  checked={isChecked}
                                  disabled={isLastChecked || (!isChecked && atMax)}
                                  onChange={() => {
                                    const newMeasures = isChecked
                                      ? selectedMeasures.filter(m => m !== opt.value)
                                      : [...selectedMeasures, opt.value];
                                    handleConfig('tableSummaryMeasures', newMeasures);
                                  }}
                                />
                                <span className="text-slate-700 font-medium">{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        {selectedMeasures.length >= 10 && (
                          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 italic">Max 10 measures</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Layout toggle (only when multiple measures selected) */}
                  {selectedMeasures.length > 1 && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Layout</span>
                      <select className="p-1 border border-slate-300 rounded text-[10px]"
                        value={currentConfig.tableSummaryLayout || 'separate'}
                        onChange={e => handleConfig('tableSummaryLayout', e.target.value)}>
                        <option value="separate">Separate</option>
                        <option value="combined">Combined</option>
                      </select>
                    </div>
                  )}

                  {/* Time dropdown (when any formant measure is selected) */}
                  {hasFormantMeasure && availableTimePoints.length > 1 && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Time</span>
                      <select className="p-1 border border-slate-300 rounded text-[10px]"
                        value={currentConfig.tableFormantTime ?? 50}
                        onChange={e => handleConfig('tableFormantTime', parseInt(e.target.value))}>
                        {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                      </select>
                    </div>
                  )}
                </>
                );
              })()}

              {/* Analysis mode controls */}
              {activeTab === 'stats' && (() => {
                const analysisType = currentConfig.tableAnalysisType || 'continuous';
                const selectedAnalysisMeasures = currentConfig.tableAnalysisMeasures || ['duration'];
                const hasFormantAnalysisMeasure = selectedAnalysisMeasures.some(m => formantValueKeys.has(m));
                return (
                <>
                  {/* Analysis Type Toggle */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Type</span>
                    <select className="p-1 border border-slate-300 rounded text-[10px]"
                      value={analysisType}
                      onChange={e => handleConfig('tableAnalysisType', e.target.value)}>
                      <option value="continuous">Continuous</option>
                      <option value="categorical">Categorical</option>
                    </select>
                  </div>

                  {analysisType === 'continuous' && (
                    <>
                      {/* Multi-measure popover */}
                      <div className="relative">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Measures</span>
                          <button
                            onClick={() => setShowAnalysisMeasureSettings(!showAnalysisMeasureSettings)}
                            className={`px-2 py-1 text-[10px] font-medium border rounded transition-all text-left min-w-[100px] ${
                              showAnalysisMeasureSettings
                                ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {selectedAnalysisMeasures.length === 1
                              ? numericVariableOptions.find(o => o.value === selectedAnalysisMeasures[0])?.label || selectedAnalysisMeasures[0]
                              : `${selectedAnalysisMeasures.length} selected`
                            }
                          </button>
                        </div>
                        {showAnalysisMeasureSettings && (
                          <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[200px] p-3">
                            <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Measures</span>
                              <button onClick={() => setShowAnalysisMeasureSettings(false)} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
                                <X size={12} />
                              </button>
                            </div>
                            <div className="max-h-[300px] overflow-y-auto space-y-1">
                              {numericVariableOptions.map(opt => {
                                const isChecked = selectedAnalysisMeasures.includes(opt.value);
                                const isLastChecked = isChecked && selectedAnalysisMeasures.length === 1;
                                const atMax = selectedAnalysisMeasures.length >= 10;
                                return (
                                  <label
                                    key={opt.value}
                                    className={`flex items-center gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded ${
                                      isLastChecked ? 'opacity-50 cursor-not-allowed' : !isChecked && atMax ? 'opacity-40 cursor-not-allowed' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="rounded text-sky-700"
                                      checked={isChecked}
                                      disabled={isLastChecked || (!isChecked && atMax)}
                                      onChange={() => {
                                        const newMeasures = isChecked
                                          ? selectedAnalysisMeasures.filter(m => m !== opt.value)
                                          : [...selectedAnalysisMeasures, opt.value];
                                        handleConfig('tableAnalysisMeasures', newMeasures);
                                      }}
                                    />
                                    <span className="text-slate-700 font-medium">{opt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                            {selectedAnalysisMeasures.length >= 10 && (
                              <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 italic">Max 10 measures</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Time dropdown (when any formant measure is selected) */}
                      {hasFormantAnalysisMeasure && availableTimePoints.length > 1 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Time</span>
                          <select className="p-1 border border-slate-300 rounded text-[10px]"
                            value={currentConfig.tableAnalysisFormantTime ?? 50}
                            onChange={e => handleConfig('tableAnalysisFormantTime', parseInt(e.target.value))}>
                            {availableTimePoints.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Factor A */}
                      {renderVariableSelect('Factor A', currentConfig.tableAnalysisGroupBy || 'none', v => handleConfig('tableAnalysisGroupBy', v))}

                      {/* Factor B (only when Factor A is set) */}
                      {currentConfig.tableAnalysisGroupBy && currentConfig.tableAnalysisGroupBy !== 'none' &&
                        renderVariableSelect('Factor B', currentConfig.tableAnalysisGroupBy2 || 'none', v => handleConfig('tableAnalysisGroupBy2', v))
                      }

                      {/* Unit of analysis — only meaningful with repeated tokens per speaker */}
                      {statsSpeakerInfo.repeated && (
                        <HelpTooltip helpMode={helpMode} text="Tokens from one speaker are correlated. Speaker means uses one mean per speaker per group, which keeps the observations independent. Tokens uses every token and can overstate significance.">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Unit</span>
                          <select className="p-1 border border-slate-300 rounded text-[10px]"
                            value={(currentConfig.statsUnit || 'speakers')}
                            onChange={e => handleConfig('statsUnit', e.target.value)}>
                            <option value="speakers">Speaker means (recommended)</option>
                            <option value="tokens">Tokens</option>
                          </select>
                        </div>
                        </HelpTooltip>
                      )}

                      {/* No speaker column: record what the user knows about the speakers */}
                      {!statsSpeakerInfo.hasSpeakers && (
                        <HelpTooltip helpMode={helpMode} text="The data has no speaker column. Record what you know: with one speaker the tokens are independent; with several speakers the results can overstate significance.">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Speakers</span>
                          <select className="p-1 border border-slate-300 rounded text-[10px]"
                            value={currentConfig.statsSpeakerAssumption || 'unknown'}
                            onChange={e => handleConfig('statsSpeakerAssumption', e.target.value)}>
                            <option value="unknown">Unknown</option>
                            <option value="single">One speaker</option>
                            <option value="multiple">Several speakers</option>
                          </select>
                        </div>
                        </HelpTooltip>
                      )}

                      {/* Test choice — one-way only; two-way always uses factorial ANOVA.
                          The options follow the design: paired tests when Factor A varies
                          within speakers and speaker means are the unit. */}
                      {currentConfig.tableAnalysisGroupBy && currentConfig.tableAnalysisGroupBy !== 'none'
                        && (!currentConfig.tableAnalysisGroupBy2 || currentConfig.tableAnalysisGroupBy2 === 'none') && (
                        <HelpTooltip helpMode={helpMode} text="Automatic runs the assumption checks (Shapiro-Wilk normality; Levene's variances for independent designs) and picks the appropriate test. Select a test yourself to override — the result panel warns you when your choice disagrees with the checks.">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">Test</span>
                          <select className="p-1 border border-slate-300 rounded text-[10px]"
                            value={currentConfig.statsTestChoice || 'auto'}
                            onChange={e => handleConfig('statsTestChoice', e.target.value)}>
                            <option value="auto">Automatic (recommended)</option>
                            {statsSpeakerInfo.hasSpeakers && statsSpeakerInfo.repeated && (
                              <optgroup label="Model (all tokens)">
                                <option value="lmm">Mixed-effects model (random intercepts)</option>
                              </optgroup>
                            )}
                            {statsSpeakerInfo.repeated && statsSpeakerInfo.within
                              && (currentConfig.statsUnit || 'speakers') === 'speakers' ? (
                              <>
                                <optgroup label="Two conditions (paired)">
                                  <option value="paired-t">Paired t-test</option>
                                  <option value="wilcoxon">Wilcoxon signed-rank</option>
                                </optgroup>
                                <optgroup label="Three or more conditions (repeated)">
                                  <option value="rm-anova">Repeated-measures ANOVA</option>
                                  <option value="friedman">Friedman test</option>
                                </optgroup>
                              </>
                            ) : (
                              <>
                                <optgroup label="Two groups">
                                  <option value="student-t">Student's t-test</option>
                                  <option value="welch-t">Welch's t-test</option>
                                  <option value="mann-whitney">Mann-Whitney U</option>
                                </optgroup>
                                <optgroup label="Three or more groups">
                                  <option value="anova">One-way ANOVA</option>
                                  <option value="welch-anova">Welch's ANOVA</option>
                                  <option value="kruskal">Kruskal-Wallis</option>
                                </optgroup>
                              </>
                            )}
                          </select>
                        </div>
                        </HelpTooltip>
                      )}
                    </>
                  )}

                  {analysisType === 'categorical' && (
                    <>
                      {renderVariableSelect('Row Var', currentConfig.tableAnalysisCatVar1 || 'none', v => handleConfig('tableAnalysisCatVar1', v))}
                      {renderVariableSelect('Col Var', currentConfig.tableAnalysisCatVar2 || 'none', v => handleConfig('tableAnalysisCatVar2', v))}
                    </>
                  )}
                </>
                );
              })()}
            </div>

            {/* Row 2: Alpha threshold */}
            {activeTab === 'stats' && (
              (currentConfig.tableAnalysisType === 'categorical'
                ? (currentConfig.tableAnalysisCatVar1 && currentConfig.tableAnalysisCatVar1 !== 'none' && currentConfig.tableAnalysisCatVar2 && currentConfig.tableAnalysisCatVar2 !== 'none')
                : (currentConfig.tableAnalysisGroupBy && currentConfig.tableAnalysisGroupBy !== 'none')
              )
            ) && (
              <div className="flex items-center gap-3 flex-wrap border-t border-slate-200 pt-2 mt-2 min-h-[28px]">
                <span className="text-[9px] font-bold text-slate-500 uppercase">α =</span>
                <input type="number" min="0.001" max="0.1" step="0.01"
                  className="w-14 p-0.5 border rounded text-[10px]"
                  value={currentConfig.tableAlpha ?? 0.05}
                  onChange={e => handleConfig('tableAlpha', parseFloat(e.target.value) || 0.05)} />
              </div>
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
            onFitToData={handleFitToData}
            datasetMeta={datasetMeta}
            speakerStats={speakerStats}
          />
        )}
        {activeTab === '3d' && (
          <Scatter3DPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
            speakerStats={speakerStats}
            datasetMeta={datasetMeta}
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
            speakerStats={speakerStats}
            datasetMeta={datasetMeta}
          />
        )}
        {activeTab === 'traj_series' && (
          <TrajectoryTimeSeries
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
            speakerStats={speakerStats}
            datasetMeta={datasetMeta}
          />
        )}
        {activeTab === 'spectral' && (
          <SpectralMomentsPlot
            ref={plotRef}
            layers={layers}
            layerData={layerData}
            activeLayerId={activeLayerId}
            datasetMeta={datasetMeta}
            onLegendClick={handleLegendClick}
            onAutoRange={setSpectralAutoRange}
          />
        )}
        {activeTab === 'duration' && (
          <DurationPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            datasetMeta={datasetMeta}
            styleOverrides={styleOverrides}
            onLegendClick={handleLegendClick}
          />
        )}
        {activeTab === 'dist' && (
          <PhonemeDistributionPlot
            ref={plotRef}
            data={activeData}
            config={currentConfig}
            datasetMeta={datasetMeta}
            onLegendClick={handleLegendClick}
            styleOverrides={styleOverrides}
          />
        )}
        {activeTab === 'table' && (
          <TablePanel
            data={activeData}
            config={currentConfig}
            datasetMeta={datasetMeta}
            availableTimePoints={availableTimePoints}
            variableOptions={variableOptions}
            numericVariableOptions={numericVariableOptions}
          />
        )}
        {activeTab === 'stats' && (
          <AnalysisView
            data={activeData}
            config={currentConfig}
            datasetMeta={datasetMeta}
            availableTimePoints={availableTimePoints}
            variableOptions={variableOptions}
            numericVariableOptions={numericVariableOptions}
          />
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
          bwMode={currentConfig.bwMode}
        />
      )}

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        plotRef={plotRef}
        layers={layers}
        defaultTitle={bgConfig.colorBy !== 'none' ? bgConfig.colorBy : bgConfig.groupBy}
        activeTab={activeTab}
      />

      <OutlierExportDialog
        isOpen={showOutlierExport}
        onClose={() => setShowOutlierExport(false)}
        outliers={sortedOutliers}
        checked={outlierScan.checked}
        skipped={outlierScan.skipped}
        sd={currentConfig.ellipseSD}
        axes={{ x: 'F2', y: 'F1' }}
        multiLayer={layers.filter(l => l.visible).length > 1}
        datasetMeta={datasetMeta ?? null}
        pointInfoFields={currentConfig.tooltipFields || []}
      />

      {/* Close dropdowns on click outside */}
      {(showAddMenu || layerPanelOpen || showPointInfoSettings || showDurationPointInfoSettings || showSummaryMeasureSettings || showAnalysisMeasureSettings || editingItem) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowAddMenu(false); setLayerPanelOpen(false); setShowPointInfoSettings(false); setShowDurationPointInfoSettings(false); setShowSummaryMeasureSettings(false); setShowAnalysisMeasureSettings(false); setEditingItem(null); }}></div>
      )}
    </div>
  );
};

export default MainDisplay;
