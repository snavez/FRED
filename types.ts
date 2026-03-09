
export interface TrajectoryPoint {
  time: number;
  f1: number;
  f2: number;
  f3: number;
  f1_smooth: number;
  f2_smooth: number;
  f3_smooth: number;
}

export interface SpeechToken {
  id: string;
  file_id: string;
  word: string;
  syllable: string;
  syllable_mark: string;
  canonical_stress: string;
  lexical_stress: string;
  canonical: string;
  produced: string;
  alignment: string;
  type: string;
  canonical_type: string;
  voice_pitch: string;
  xmin: number;
  duration: number;
  trajectory: TrajectoryPoint[]; // 0 to 100 in 10% steps
  customFields?: Record<string, string>;
}

export type VariableType = string;

export interface StyleOverrides {
  colors: Record<string, string>;
  shapes: Record<string, string>;
  textures: Record<string, number>; // index for pattern
  lineTypes: Record<string, string>; // key for dash pattern (e.g., 'solid', 'dash')
}

export type NormalizationMethod = 'hz' | 'bark' | 'erb' | 'mel' | 'lobanov' | 'nearey1';

export interface PlotConfig {
  invertX: boolean; // F2
  invertY: boolean; // F1
  colorBy: VariableType;
  shapeBy: VariableType;
  lineTypeBy: VariableType;
  textureBy: VariableType;
  bwMode: boolean;

  // Data Source Config
  useSmoothing: boolean;
  normalization: NormalizationMethod;

  timePoint: number; // 0, 10, ... 100

  // Grouping for categorical plots
  groupBy: VariableType;

  // Base Plot Mode
  plotType: 'point' | 'trajectory';

  // Trajectory Settings
  trajectoryOnset: number; // 0-100
  trajectoryOffset: number; // 0-100

  // Trajectory Time Series Config
  timeNormalized: boolean;
  showMeanTrajectories: boolean;

  // Trajectory F1/F2 Config
  showIndividualLines: boolean;
  trajectoryLineOpacity: number;
  trajectoryLineWidth: number;
  showTrajectoryLabels: boolean;
  meanTrajectoryLabelSize: number;
  meanTrajectoryWidth: number;
  meanTrajectoryOpacity: number;
  showArrows: boolean;
  showMeanTrajectoryPoints: boolean;
  meanTrajectoryPointSize: number;
  meanTrajectoryArrowSize: number;
  showReferenceVowels: boolean;
  selectedReferenceVowels: string[];
  referencePitchFilter: string[]; // Filter references by pitch

  // Reference Vowel Style Config
  refVowelLabelOpacity: number;
  refVowelLabelSize: number;
  refVowelEllipseLineOpacity: number;
  refVowelEllipseFillOpacity: number;

  // Duration Plot Config
  showQuartiles: boolean;
  showMeanMarker: boolean;
  showOutliers: boolean;
  showDurationPoints: boolean;

  // Distribution Plot Config
  separatePlots: boolean;
  distGroupOrder: 'count' | 'alpha';
  distGroupDir: 'asc' | 'desc';
  distBarOrder: 'count' | 'alpha';
  distBarDir: 'asc' | 'desc';
  distBarMode: 'grouped' | 'stacked';
  distPrimaryVar: 'color' | 'texture';
  distValueMode: 'count' | 'percentage';
  distNormalize: boolean;

  // Scatter Plot Visibility
  showPoints: boolean;
  showEllipses: boolean;
  showCentroids: boolean;
  labelAsCentroid: boolean;

  // Scatter Plot Configuration
  pointSize: number;
  pointOpacity: number;

  centroidSize: number;
  centroidOpacity: number;
  labelSize: number;
  meanLabelType: 'auto' | 'color' | 'shape' | 'both';

  lineWidth: number;
  ellipseSD: number;
  ellipseLineWidth: number;
  ellipseLineOpacity: number;
  ellipseFillOpacity: number;

  // Tooltip
  tooltipFields?: string[];

  // Ranges
  f1Range: [number, number];
  f2Range: [number, number];
  f3Range: [number, number];
  timeSeriesFrequencyRange: [number, number]; // Specific for Time Series plot
  durationRange: [number, number];
  countRange: [number, number];
}

export interface FilterState {
  types: string[]; // canonical_type values (e.g. 'vowel', 'consonant')
  vowelCategories: string[]; // 'monophthong', 'diphthong'
  phonemes: string[]; // canonical
  alignments: string[];
  produced: string[]; // allophones
  words: string[];
  canonicalStress: string[];
  lexicalStress: string[];
  syllableMark: string[];
  voicePitch: string[];
  fileIds: string[];
  customFilters?: Record<string, string[]>;
}

// Multi-Layer System
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  isBackground: boolean; // true only for layer[0], cannot delete
  config: PlotConfig;
  filters: FilterState;
  styleOverrides: StyleOverrides;
}

export interface LayerCounters {
  point: number;
  trajectory: number;
}

export interface LayerLegendConfig {
  layerId: string;
  show: boolean;
  colorTitle: string;
  shapeTitle: string;
  lineTypeTitle: string;
  textureTitle: string;
}

export interface ReferenceCentroid {
  canonical: string;
  f1: number;
  f2: number;
  sdX: number; // F2 SD
  sdY: number; // F1 SD
  angle: number;
}

export interface ExportConfig {
  scale: number; // Image quality multiplier (e.g., 3)

  // Graph Geometry
  graphScale?: number;
  graphScaleX?: number;
  graphScaleY?: number;
  graphX?: number;
  graphY?: number;

  // Axis Typography
  xAxisLabelSize: number;
  xAxisLabelX?: number; // Offset
  xAxisLabelY?: number; // Offset

  yAxisLabelSize: number;
  yAxisLabelX?: number; // Offset
  yAxisLabelY?: number; // Offset

  tickLabelSize: number;
  xAxisTickX?: number; // Offset
  xAxisTickY?: number; // Offset
  yAxisTickX?: number; // Offset
  yAxisTickY?: number; // Offset

  dataLabelSize: number; // For bars, points, centroids

  // Main Title
  showPlotTitle?: boolean;
  plotTitle?: string;
  plotTitleSize?: number;
  plotTitleX?: number; // Offset
  plotTitleY?: number; // Offset

  // Legend General
  showLegend: boolean;
  legendSource?: 'background' | 'overlay' | 'both'; // Deprecated: kept for other plot components
  legendPosition?: 'right' | 'bottom' | 'inside-top-right' | 'inside-top-left' | 'custom';
  legendX?: number; // Offset or coordinate
  legendY?: number;
  legendTitleSize: number;
  legendItemSize: number;

  // Multi-layer legend controls
  legendLayers?: string[]; // Which layer IDs appear in legend
  layerLegends?: LayerLegendConfig[]; // Per-layer legend config

  // Legend Specifics (background / single-layer)
  showColorLegend: boolean;
  colorLegendTitle: string;

  showShapeLegend: boolean;
  shapeLegendTitle: string;

  showTextureLegend: boolean;
  textureLegendTitle: string;

  showLineTypeLegend: boolean;
  lineTypeLegendTitle: string;

  // Overlay Legend Specifics (deprecated, kept optional for other plot components)
  showOverlayColorLegend?: boolean;
  overlayColorLegendTitle?: string;
  showOverlayShapeLegend?: boolean;
  overlayShapeLegendTitle?: string;
  showOverlayLineTypeLegend?: boolean;
  overlayLineTypeLegendTitle?: string;

  // Canvas Dimensions (auto-computed; kept for other plot components)
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface PlotHandle {
  exportImage: () => void; // Legacy direct download
  generateImage: (config: ExportConfig) => string; // Returns Data URL
}

// Flexible file parsing types
export type ColumnRole =
  | 'file_id' | 'word' | 'syllable' | 'syllable_mark'
  | 'canonical_stress' | 'lexical_stress' | 'canonical' | 'produced'
  | 'alignment' | 'type' | 'canonical_type' | 'voice_pitch'
  | 'xmin' | 'duration'
  | 'formant'
  | 'custom' | 'ignore';

export interface ColumnMapping {
  csvHeader: string;
  role: ColumnRole;
  timePoint?: number;
  formant?: 'f1' | 'f2' | 'f3';
  isSmooth?: boolean;
  formantLabel?: string;
  customFieldName?: string;
  showInSidebar?: boolean;
}

export interface DatasetMeta {
  fileName: string;
  columnMappings: ColumnMapping[];
  timePoints: number[];
  customColumns: string[];
  rowCount: number;
  formantVariants?: string[];
}
