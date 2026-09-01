
/** Sentinel value for tokens with empty/missing field values, visible in sidebar filters */
export const UNDEFINED_LABEL = '(Undefined)';

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
  trajectory: TrajectoryPoint[];      // Formant data across time (time always 0-100%)
  trajectoryDurationMs?: number;      // Native extraction range for time-slice data (for absolute time plots)
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
  snapMeansToGrid: boolean;
  /** Field name to use as token duration in absolute-time plots.
   *  Empty/undefined = fall back to SpeechToken.duration (from the duration-role column). */
  trajectoryDurationField?: string;

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

  // Box-plot Config — shared by the Data Summaries boxes and the Spectral distribution,
  // so a box reads the same wherever it is drawn
  showQuartiles: boolean;
  showMeanMarker: boolean;
  showOutliers: boolean;
  boxShowPoints: boolean;
  boxWhiskerMode: 'iqr' | 'minmax';        // 1.5×IQR vs min/max whiskers
  boxCenterLine: 'median' | 'mean';        // what the thick center line represents
  showCenterValueLabels: boolean;          // print the centre statistic's value beside each box
  boxWidth: number;                        // box width in px (0 = auto)

  // Duration Plot Config
  durationYField: string;                  // 'duration' (default) or any field key
  durationFormantTimePoint: number;         // timepoint for formant Y-axis extraction (default: 50)
  durationPlotBy: string;                  // 'none' or field key — faceting variable
  durationClusterBy: string;               // 'none' or field key — hierarchical x-axis grouping
  durationBoxOrder: 'alpha' | 'central';   // box ordering within clusters
  durationBoxDir: 'asc' | 'desc';          // ordering direction
  durationTooltipFields: string[];          // configurable tooltip fields
  durationGroupGap: number;                 // gap between clusters in slot units (default 1.5)
  durationBoxGap: number;                   // additional slot units between boxes (0 = no gap, default 0.4)

  // Distribution Plot Config
  distPlotBy: string;                        // 'none' or field key — faceting variable for distributions
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

  // Spectral Config (consonant analysis: COG/SD/skew/kurt and the band energy ratio)
  spectralMode: 'scatter' | 'box' | 'timeline' | 'density';
  // Scatter point layers plot any two scalar features. A feature ref is either a
  // moment at a timepoint ('COG@50') or a shape coefficient ('COG~k1').
  // Both axes live on the background layer so every layer shares one coordinate
  // space. Each ref encodes moment + kind + index, so the kind of the X ref is what
  // the "Data" selector shows; both axes are always kept on the same kind.
  spectralXFeature: string;                  // scatter X feature ref
  spectralYFeature: string;                  // scatter Y feature ref
  spectralFeature: string;                   // single feature for box / density
  spectralTimelineMoment: string;            // contour family ref (e.g. 'release:COG'); grid from data
  // Trajectory sweep range, as indices into the active grid ([0,0] = full sweep).
  spectralTrajRange: [number, number];
  spectralViolin: boolean;                   // box mode: false = box, true = violin
  spectralShowIndividual: boolean;           // contours: faded per-token lines
  spectralBandOpacity: number;               // contours: ±1 SD band fill opacity
  spectralDensityFill: number;               // density: area fill opacity
  spectralShowBand: boolean;                 // contours: ±1 SD band around each mean
  spectralContourAbsolute: boolean;          // contours: absolute (ms) instead of normalised
  // Duration column an absolute-time contour is stretched over. '' = the token's own
  // duration. A dataset can hold several (whole segment, closure, release), and a
  // release contour is only honest over the release duration.
  spectralDurationField: string;
  spectralCoeffFacets: boolean;              // box: one mini plot per coefficient
  spectralFlipSign: boolean;                 // box/density: negate values (k1: neg = rising)
  spectralXRange: [number, number];          // scatter X range ([0,0] = auto)
  spectralYRange: [number, number];          // scatter/box/density value range ([0,0] = auto)

  // Variable scatter Config (any numeric measure against any other)
  varXField: string;                         // measure on X ('' until chosen)
  varYField: string;                         // measure on Y
  varXTime: number;                          // timepoint for a formant X measure
  varYTime: number;                          // timepoint for a formant Y measure
  varXRange: [number, number];               // [0,0] = fit to the data
  varYRange: [number, number];
  varShowRegression: boolean;                // least-squares line
  varRegressionPerGroup: boolean;            // one line per colour group vs one overall
  varShowStats: boolean;                     // r / R² / p / n readout on the plot
  varRegressionWidth: number;

  // Table Panel Config
  tableMode: 'browse' | 'summary' | 'analysis';
  tableFormantTime: number;                  // shared time dropdown for Browse mode (default: 50)
  tableExpandTimePoints: boolean;            // show all time points in columns (default: false)
  tableAnalysisDV: string;                   // dependent variable key (default: 'duration')
  tableAnalysisGroupBy: string;              // grouping variable key (default: 'none')
  tableAnalysisFormantTime: number;          // time point for formant DV (default: 50)
  tableAlpha: number;                        // significance threshold (default: 0.05)
  statsTestChoice: string;                   // 'auto' or a forced test key (see TestChoice)
  statsUnit: string;                         // 'speakers' (means per speaker) | 'tokens'
  statsSpeakerAssumption: string;            // no speaker column: 'unknown' | 'single' | 'multiple'
  tableSummaryGroupBy: string;               // grouping variable for summary mode (default: 'none')
  tableSummaryMeasures: string[];             // selected numeric measures (default: ['duration'])
  tableSummaryLayout: 'combined' | 'separate'; // table layout mode (default: 'separate')
  tableAnalysisType: 'continuous' | 'categorical'; // analysis paradigm (default: 'continuous')
  tableAnalysisGroupBy2: string;              // second IV / Factor B (default: 'none')
  tableAnalysisMeasures: string[];            // multi-DV selection (default: ['duration'])
  tableAnalysisCatVar1: string;               // row variable for contingency (default: 'none')
  tableAnalysisCatVar2: string;               // column variable for contingency (default: 'none')

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
  // Per-axis tick sizes. Unset = follow the size that axis has always used, so an
  // untouched export renders exactly as before. A plot whose x axis is labelled in two
  // layers (boxes within clusters, bars within groups) sizes the outer layer with
  // xGroupLabelSize and the inner one with xTickLabelSize.
  xTickLabelSize?: number;
  yTickLabelSize?: number;
  xGroupLabelSize?: number;
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
  | 'token_id' | 'timepoint'
  | 'spectral_cog' | 'spectral_sd' | 'spectral_skew' | 'spectral_kurt' | 'spectral_bandratio'
  | 'field' | 'ignore';

export interface ColumnMapping {
  csvHeader: string;
  role: ColumnRole;
  fieldName?: string;         // Display name for 'field' role columns (defaults to csvHeader)
  timePoint?: number;
  formant?: 'f1' | 'f2' | 'f3' | 'f4' | 'f5';
  isSmooth?: boolean;
  formantLabel?: string;
  formantTarget?: string;       // Named target (e.g. "onset", "midpoint") for non-numeric timepoints
  spectralRegion?: string;      // Segment region for spectral columns (e.g. "closure", "release")
  showInSidebar?: boolean;
  isDataField?: boolean;      // true = data/plot value (no sidebar), false/undefined = filter/label
}

export type TrajectoryFormat = 'percentage' | 'time-slice' | 'single-point';
export type TrajectoryUnit = 'ms' | 'sec';

export interface TrajectorySpacing {
  kind: 'uniform' | 'listed' | 'irregular';
  medianInterval?: number;    // for 'uniform'
  values?: number[];          // for 'listed' (≤8 unique timepoints)
}

export interface DatasetMeta {
  fileName: string;
  columnMappings: ColumnMapping[];
  timePoints: number[];
  timePointLabels?: Record<number, string>;  // Maps numeric index → display label (e.g. 0→"onset", 50→"50%")
  rowCount: number;
  formantVariants?: string[];
  sourceFormat?: 'wide' | 'long';
  trajectoryFormat?: TrajectoryFormat;       // Confirmed (or auto-detected) format of trajectory data
  trajectoryUnit?: TrajectoryUnit;           // For 'time-slice' format only
  trajectorySpacing?: TrajectorySpacing;     // Description for the confirmation panel
  provenance?: DatasetProvenance;            // From the exporter's JSON sidecar, when one was loaded
}

/**
 * What the exporter recorded about how the numbers in the CSV were measured, read from
 * the JSON sidecar written beside it. Two CSVs can carry identically-named columns
 * measured under different settings, so anything here that changes what a column *means*
 * belongs in the axis label, not just in a settings panel.
 */
export interface DatasetProvenance {
  /** Name of the sidecar the values came from, for the dataset info panel. */
  sourceFile: string;
  /** Bands of the band-energy ratio, [low, high] in Hz. Absent when not exported. */
  bandRatio?: BandRatioBands;
}

/** The two frequency bands a band-energy ratio compares, each [low, high] in Hz. */
export interface BandRatioBands {
  low: [number, number];
  high: [number, number];
  /** Unit the exporter reports the ratio in, e.g. 'dB'. */
  units: string;
}
