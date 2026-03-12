
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
  speaker: string;                    // For normalization grouping (Lobanov/Nearey)
  file_id: string;                    // For data provenance / tooltip
  xmin: number;
  duration: number;
  trajectory: TrajectoryPoint[];      // Formant data across time
  fields: Record<string, string>;     // All other columns (user's headers as keys)
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
  durationYField: string;                  // 'duration' (default) or any field key
  durationFormantTimePoint: number;         // timepoint for formant Y-axis extraction (default: 50)
  durationPlotBy: string;                  // 'none' or field key — faceting variable
  durationClusterBy: string;               // 'none' or field key — hierarchical x-axis grouping
  durationWhiskerMode: 'iqr' | 'minmax';  // 1.5×IQR vs min/max whiskers
  durationCenterLine: 'median' | 'mean';   // what the thick center line represents
  durationBoxOrder: 'alpha' | 'central';   // box ordering within clusters
  durationBoxDir: 'asc' | 'desc';          // ordering direction
  durationTooltipFields: string[];          // configurable tooltip fields
  durationBoxWidth: number;                 // box width in px (0 = auto)
  durationGroupGap: number;                 // gap between clusters in slot units (default 1.5)
  durationBoxGap: number;                   // additional slot units between boxes (0 = no gap, default 0.4)

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
  distBarWidth: number;                     // bar width in px (0 = auto)
  distGroupGap: number;                     // gap between groups in px (0 = auto)
  distBarGap: number;                       // gap between bars within group in px (0 = auto)
  distMode: 'counts' | 'histogram';         // sub-mode: categorical counts vs continuous histogram
  distHistXVar: string;                      // numeric field for histogram x-axis (default: 'duration')
  distHistTimePoint: number;                 // timepoint for formant extraction (default: 50)
  distHistBinCount: number;                  // number of histogram bins (default: 30)
  distHistColorBy: string;                   // categorical split variable (default: 'none')
  distHistYMode: 'count' | 'density';        // y-axis mode (default: 'count')
  distHistOverlap: 'stacked' | 'overlaid';   // multi-color bar mode (default: 'stacked')
  distHistOpacity: number;                   // bar opacity for overlaid mode (default: 0.6)

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
  filters: Record<string, string[]>;  // field name → selected values (empty = nothing passes)
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
  label: string;  // grouping field value (e.g. phoneme name)
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
  | 'speaker' | 'file_id'
  | 'duration' | 'formant' | 'pitch'
  | 'field' | 'ignore';

export interface ColumnMapping {
  csvHeader: string;
  role: ColumnRole;
  fieldName?: string;         // Display name for 'field' role columns (defaults to csvHeader)
  timePoint?: number;
  formant?: 'f1' | 'f2' | 'f3';
  isSmooth?: boolean;
  formantLabel?: string;
  showInSidebar?: boolean;
  isDataField?: boolean;      // true = data/plot value (no sidebar), false/undefined = filter/label
}

export interface DatasetMeta {
  fileName: string;
  columnMappings: ColumnMapping[];
  timePoints: number[];
  rowCount: number;
  formantVariants?: string[];
}
