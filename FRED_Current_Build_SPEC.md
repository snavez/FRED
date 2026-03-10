# FRED - Formant Research & Exploration Dashboard

## Overview

FRED is a browser-based vowel space visualization tool built with React, TypeScript, Vite, and Tailwind CSS. It provides interactive, multi-view analysis of acoustic speech data with flexible data import, multi-layer plotting, and publication-quality export.

---

## 1. Data Import & Parsing

### File Formats
- **CSV**, **TSV**, and **TXT** files accepted (`.csv`, `.tsv`, `.txt`)
- Delimiter auto-detected (tab vs comma) by counting occurrences in the first line

### Two-Step Import Flow
1. **Read & Detect**: File is read, headers extracted, and column mappings auto-detected via an alias table
2. **Mapping Dialog**: User reviews/adjusts column assignments in a modal before parsing

### Column Roles (`ColumnRole` type)
| Role | Description | Aliases |
|------|-------------|---------|
| `speaker` | Speaker identifier | `speaker_id`, `participant`, `subject` |
| `file_id` | File identifier | `fileid`, `filename`, `file` |
| `duration` | Segment duration | `dur`, `seg_dur` |
| `formant` | Formant data (auto-detected from pattern `f[1-3]_<time>[_<variant>]`) | |
| `pitch` | Pitch / F0 data (auto-detected from pattern `f0_<time>[_<variant>]`) | `f0`, `voice_pitch` |
| `field` | Generic field (categorical or data) | *(any unrecognized column)* |
| `ignore` | Column is not imported | |

All columns that don't match a built-in role are assigned `field` role. Previous named roles like `word`, `canonical`, `type`, `alignment`, etc. are now detected as `field` role with their original column header as `fieldName`. The xmin column (aliases: `xmin`, `onset`, `start`, `start_time`) is also treated as a `field` with `isDataField: true`.

### Formant & Pitch Column Detection
- **Formant regex**: `f[1-3]_<timepoint>[_<variant>]` (e.g., `f1_50`, `f2_30_smooth`)
- **Pitch regex**: `f0_<timepoint>[_<variant>]` (e.g., `f0_50`, `f0_80_smooth`)
- Supports multiple formant variants (e.g., raw + smoothed); select between them via the Data dropdown in the config toolbar
- Time points are derived from the data (not hardcoded); all plots use `findNearestTimePoint()` for flexible lookup
- xmin-like columns (`xmin`, `onset`, `start`, `start_time`) are auto-detected as `field` role with `isDataField: true` and used to populate `SpeechToken.xmin`

### Generic Fields
- All non-built-in columns are assigned `field` role with `fieldName` set to the CSV header
- Categorical columns (<=50 unique values in sample) default to filter fields (`isDataField: false`)
- Numeric/high-cardinality columns default to data fields (`isDataField: true`)
- All field values are stored in `SpeechToken.fields: Record<string, string>` — a single generic dictionary
- Fields can be used as visual encodings (Color By, Shape By, etc.) and as filter fields in the sidebar
- The user can toggle any field between Filter and Data mode in the Data Mapping Dialog

### Data Mapping Dialog
- Modal UI listing all detected columns with role dropdowns and sample data preview
- User can reassign roles, set field names, or ignore columns
- **Role options**: Speaker ID, File ID, Formant Value, Duration Value, Pitch Value, Custom Field, Ignore
- **Filter/Data toggle**: Every non-ignored column gets a Filter/Data toggle
  - **Filter**: categorical label for sidebar filtering (default for low-cardinality columns)
  - **Data**: numeric value for plotting, not shown in sidebar (default for high-cardinality columns)
- **Sidebar checkbox**: shown when Filter is selected; controls sidebar visibility (defaults checked)
- **Field Name column**: editable name for `field` and `pitch` roles (shown as "Field Name" header)
- Formant columns show formant/time-point details and auto-detected variant tags (e.g., "smooth")
- Help text sections with line breaks before "File ID" and "Data fields" explanations
- **Edit Column Mappings button**: in sidebar below token count, reopens the dialog with current mappings for adjustment after import
- **Stale file guard**: `dialogKey` embedded atomically in dialog state + `uploadIdRef` race condition guard prevents showing old file data when quickly uploading a new file

---

## 2. Plot Types

### F1/F2 Vowel Space (Canvas)
- 2D scatter plot with F1 (y-axis) and F2 (x-axis), axes invertible
- Supports both **Point** and **Trajectory** modes
- Multi-layer rendering (see Section 3)
- Interactive: pan (drag), zoom (scroll wheel), hover tooltips
- On-canvas legend with click-to-edit style overrides
- **Performance**: Spatial grid index for O(1) hover hit-testing; `requestAnimationFrame` throttling; hover state uses refs to avoid triggering canvas redraws

### 3D F1/F2/F3 Scatter
- Canvas-based orthographic 3D scatter plot
- Point and trajectory modes
- Adjustable F1, F2, F3 ranges
- Quick-align buttons (F1 vs F2, F2 vs F3, F1 vs F3) with correct axis orientation
- **Rotation control widget** — D-pad style directional arrows for predictable rotation with smooth animation (ease-out cubic, 300ms). ←→ turntable (Y-axis), ↑↓ tilt (X-axis), CW/CCW spin (Z-axis roll). Configurable step size (5°–90°). Complements shift+drag free rotation
- **3-axis rotation model**: alpha (Y-axis turntable, purely horizontal), beta (X-axis tilt), gamma (Z-axis roll/spin). Rotation order Ry·Rx·Rz for intuitive controls
- Centroid size/opacity sliders in sidebar (shared with F1/F2 plot)
- Combined color+shape legend when same variable mapped to both
- Ellipse line width respects config slider
- 360° unclamped rotation on all three axes

### Trajectory Time Series
- Line plots of formant trajectories over normalized time
- Individual lines + mean trajectories per group
- Configurable frequency range
- Derives bin count from actual data time-points
- **Mean trajectory labels** at line endpoints with anti-overlap displacement. Label source selectable (Color Key, Line Key, Both, Auto). Adjustable label size (8–72px)

### Duration Plot
- Box-and-whisker plots per phoneme/category group
- **Flexible Y-axis**: select any numeric field (Duration, xmin, pitch columns, data fields) via dropdown
- **Faceted subplots** (`durationPlotBy` / Plot By): splits data into a grid of sub-plots by any categorical variable
- **Hierarchical clustering** (`durationClusterBy` / Group By): groups boxes into clusters with bracket labels on a two-tier x-axis. Clusters are always sorted alphabetically; individual boxes within clusters are sorted independently
- **Box ordering** (`durationBoxOrder` / `durationBoxDir`): Alpha or Central tendency (mean/median), ascending or descending. Only affects individual box order within each cluster — cluster group order is always alphabetical
- **Whisker modes**: 1.5×IQR (with outlier circles) or Min-Max (whiskers extend to data extremes)
- **Center line**: Median or Mean toggle; center diamond marker always shown, tracks the selected center line
- **Show toggles**: Quartiles (box vs bar), Outliers, individual data Points
- **Coloured jitter points**: when Points is enabled, dots are coloured to match their box's colour variable with configurable opacity (`pointOpacity`)
- **Max Y override**: manual Y-axis maximum; 0 = auto-fit to 110% of data max
- **Interactive legend**: HTML overlay with colour swatches + texture pattern previews. Click any item to open the StyleEditor for manual colour/texture customisation. Style overrides persist via `layer.styleOverrides`
- **Configurable tooltip**: hover over outlier circles or jitter points to see token details. Field selector popover (max 10 fields) with `durationTooltipFields` stored in PlotConfig
- **Zoom & Pan**: scroll wheel zooms towards cursor, click-drag to pan. +/−/RESET VIEW buttons at bottom-left. Canvas transform applied to rendering; hit-detection inverse-transforms mouse coordinates

### Phoneme Distribution
- Bar chart showing phoneme counts/percentages
- Grouped or stacked bar modes
- Configurable ordering (count/alpha, asc/desc) for both groups and bars
- Cluster By control when two variables are mapped (color + texture)
- Normalization option for stacked percentage mode
- Separate sub-plots mode

### Data Table
- Tabular view of filtered tokens (first 1,000 rows)
- Shows: Word, Phoneme, Produced, Duration, F1/F2/F3 averages

---

## 3. Multi-Layer System (F1/F2 Plot Only)

### Architecture
- Up to **10 layers**, each with independent config, filters, and style overrides
- **Background layer** (`id='bg'`): always present, cannot be deleted, controls coordinate space (ranges, axis inversion)
- Additional layers can be **Point** or **Trajectory** type

### Layer Controls (Layers dropdown)
- Add/remove layers
- Toggle visibility per layer
- Reorder layers (drag up/down, background always first)
- Rename layers (double-click)
- Active layer selection (determines which layer's config the toolbar edits)

### Layer Data Independence
- Each layer has its own `FilterState` — sidebar filters apply to the active layer
- `layerData: Record<string, SpeechToken[]>` computed per layer via `useMemo`
- Non-F1/F2 plots always use the active layer's data

---

## 4. Visual Encoding

### Channels
| Channel | Applicable Plots | Options |
|---------|------------------|---------|
| **Color By** | All | None, + sidebar-active fields (Phoneme, Word, Allophone, etc.) |
| **Shape By** | F1/F2 (point mode), 3D | Same as Color By |
| **Line Type By** | F1/F2 (trajectory mode), Traj F1/F2, Time Series | Same as Color By |
| **Texture By** | Duration, Distribution | Same as Color By |
| **Plot By** | Duration | Same as Color By (faceted sub-plots) |
| **Group By** | Duration | Same as Color By (hierarchical clustering) |

### Encoding Dropdown Filtering
- Visual encoding dropdowns (Color By, Shape By, Line Type By, Texture By) list all fields from `datasetMeta.columnMappings` that are sidebar-active
- Built-in fields (`speaker`, `file_id`) plus all `field` and `pitch` role columns with a `fieldName` are eligible
- `None` is always available regardless of sidebar state
- `VariableType` is `string` (not a fixed union) to support dynamic field names as encoding variables

### Color Palette
- Default: 15 colors (`#ef4444`, `#3b82f6`, `#10b981`, `#f59e0b`, `#8b5cf6`, `#ec4899`, `#06b6d4`, `#84cc16`, `#64748b`, `#dc2626`, `#2563eb`, `#059669`, `#d97706`, `#7c3aed`, `#db2777`)
- B&W mode: 4 greyscale values (`#000000`, `#525252`, `#969696`, `#d4d4d4`)
- Style editor palette automatically switches to greyscale swatches when B&W mode is active

### Shapes
12 shapes: `circle`, `square`, `triangle`, `diamond`, `hexagon`, `circle-open`, `square-open`, `triangle-open`, `diamond-open`, `plus`, `cross`, `asterisk`

### Line Types
5 patterns: `solid`, `dash`, `dot`, `longdash`, `dotdash`

### Style Editor
- Click any legend item to open a floating style editor
- Edit color (palette grid), shape (icon grid), line type (dropdown), or texture (pattern selector)
- Per-layer overrides stored in `layer.styleOverrides`
- Supported in: F1/F2 (CanvasPlot), Trajectory F1/F2, Trajectory Time Series, Duration Plot, Phoneme Distribution

### Legend Deduplication & Mode Awareness
- When the same variable is assigned to multiple channels (e.g. Color By = Shape By = Phoneme), the legend combines them into a single section with merged icons
- Color + Shape: legend shows colored shape icons instead of separate color dots and grey shapes
- Color + Line Type: legend shows colored line segments with dash patterns
- **Trajectory mode**: legend always renders colored line segments (shapes are ignored since trajectories don't use shapes)
- Applies to both on-screen legends and canvas export legends (CanvasPlot and TrajectoryF1F2)

### Centroids
- Centroids always render as filled shapes, even when the assigned shape is "open" (e.g. circle-open, square-open)
- A white halo background is drawn behind each centroid for visibility against the data cloud

---

## 5. Filter System

### Architecture
- **Flat, independent filters** — no hierarchical dependency between fields
- `FilterState.filters: Record<string, string[]>` — single generic dictionary for all filter state
- Empty array = nothing selected = nothing passes for that field
- On import, `computeSelectAllFilters()` populates all filter arrays with all unique values
- Filter keys match field names from `datasetMeta.columnMappings` (e.g., `'speaker'`, `'file_id'`, `'type'`, `'phoneme'`, `'duration'`)
- Accessor pattern: `speaker` and `file_id` access dedicated SpeechToken properties; `duration` accesses `t.duration.toString()`; all others access `t.fields[key]`

### Dynamic Filter Fields
- Filter sections are generated dynamically from `datasetMeta.columnMappings`
- Any column with `isDataField !== true` and a valid filter key gets a filter section
- Supported roles for filtering: `speaker`, `file_id`, `duration` (when set to Filter), `pitch` (when set to Filter), `field`
- `formant` and `ignore` roles never appear as filters
- Filter section order mirrors CSV column order

### Cross-Filtering (Faceted Search)
- **Excel-style cross-filtering**: selecting values in one filter constrains available options in all other filters
- For each visible filter field X, options are computed by applying ALL other active filters to the data, then extracting unique values for X
- If any other filter has an empty selection (nothing passes), all fields show "No values"
- Selected values that disappear from cross-filtered options remain in filter state — they reappear when the constraining filter is changed back
- Performance: O(fields × tokens × active_filters) Set.has() operations; sub-10ms for typical datasets

### Sidebar Controls
- Each filter section has **All** / **Clear** buttons
- Search box appears when a field has >50 unique values
- **Gear icon** (Settings2) opens a popover listing ALL non-data fields with checkboxes to toggle sidebar visibility
- `ColumnMapping.showInSidebar` controls field visibility; set during import via the Data Mapping Dialog
- Pretty labels: underscores replaced with spaces, title-cased (e.g., `syllable_mark` → "Syllable Mark")

### Per-Layer Filtering
- Each layer has its own `FilterState`
- Sidebar edits the active layer's filters
- New layers get select-all filters via `computeSelectAllFilters(data, datasetMeta)`
- Token count display shows active layer filtered count vs total

---

## 6. Point Mode Features

### Points
- Toggle visibility, configurable size (1-10) and opacity (0-1)

### Ellipses
- Standard deviation ellipses per group
- Configurable: SD multiplier (1-3), line width, line opacity, fill opacity

### Centroids / Labels
- Mean position markers per group
- Display as shape marker or text label
- Configurable: size, opacity, label size
- **Mean Label Type**: Auto, Color Key, Shape Key, Both

---

## 7. Trajectory Mode Features

### Individual Lines
- Configurable opacity (0 = hidden)
- Onset/offset range selectors (any available time points)
- Arrows at trajectory endpoints (toggleable)

### Mean Trajectories
- Toggle visibility
- Configurable: line width (1-10), opacity, point markers, point size, arrow size
- Labels at midpoint (toggleable, configurable size)
- Time-steps derived from actual data (not hardcoded 0-100)

### Reference Vowels (Traj F1/F2 only)
- Overlay reference centroids + ellipses from exact-aligned monophthongs
- Select/deselect individual reference vowels
- Voice pitch filter for reference data
- Configurable: label size, label opacity, ellipse line opacity, ellipse fill opacity

---

## 8. Non-linear Opacity Sliders

### Curve
- Power curve mapping: `sliderToOpacity(x) = x^2`, `opacityToSlider(x) = sqrt(x)`
- ~75% of slider travel covers the 0-0.5 opacity range
- Step size: 0.02 (fine granularity at the compressed high end)

### Affected Sliders (12 total)
1. `trajectoryLineOpacity` (config bar, trajectory mode)
2. `trajectoryLineOpacity` (traj_f1f2 / traj_series section)
3. `pointOpacity` (F1/F2 point mode)
4. `pointOpacity` (Duration plot, jitter points — shown when Points checkbox is on)
5. `ellipseLineOpacity`
6. `ellipseFillOpacity`
7. `meanTrajectoryOpacity` (config bar, trajectory mode)
8. `meanTrajectoryOpacity` (traj_f1f2 / traj_series section)
9. `centroidOpacity`
10. `refVowelLabelOpacity`
11. `refVowelEllipseLineOpacity`
12. `refVowelEllipseFillOpacity`

### Stored Values
- Config values remain linear 0-1 floats; only slider display/input is non-linear

---

## 9. Configurable Tooltip

### Configuration
- **Tooltip button** in the toolbar (F1/F2 and 3D tabs) opens a popover with checkboxes
- Select up to **10 fields** from all available built-in + custom columns
- Stored in `PlotConfig.tooltipFields: string[]`
- **Duration plot**: separate tooltip field selector (`durationTooltipFields`, default: `['file_id', 'duration']`); works on outlier circles and jitter points

### Default State
- Tooltip starts **empty** (no fields selected)
- When hovering a token with no fields selected, a friendly message is shown: *"Select fields from the Tooltip dropdown to see token data here."*
- Users opt-in to exactly the fields they want to see

### Field Options
- Tooltip dropdown shows only fields that **actually exist in the loaded dataset**
- Built-in fields (`speaker`, `file_id`, `duration`) shown when mapped
- All `field` and `pitch` role columns with a `fieldName` are included
- Fields are matched against `datasetMeta.columnMappings` — unmapped fields don't appear

### Rendering
- First field rendered as header with accent styling
- Remaining fields in a 2-column grid
- `xmin` and `duration` formatted as `.toFixed(3)s`
- Fields accessed via `token.fields[key]`
- Tooltip uses the hovered token's layer config for field selection
- Trajectory F1/F2 chart now also uses the configurable tooltip fields (previously hardcoded)

---

## 10. Export System

### Export Dialog
- Full-screen modal with live preview (scale-1 preview, full-resolution download)
- **Smart defaults**: `computeExportDefaults()` derives config from current layers (legend titles, section visibility)
- **Resolution**: configurable scale multiplier (1x–4x, default 3x)
- **Canvas**: always auto-sized to fit plot + margins + legend; no manual canvas dimensions
- **Dynamic margins**: margins in `generateImage()` scale with font sizes so nothing overflows

### Quick Settings (always visible)
- Resolution buttons (1x–4x)
- Global Font Scale slider (0.5x–3.0x) — proportionally scales all text

### Collapsible Sections
Each section is collapsible with a dot indicator when non-default values are set:

- **Chart Title**: toggle on/off, text, size, NudgePad for position offset
- **Graph Geometry**: graph scale (linked/unlinked X/Y), NudgePad for graph offset
- **Axis Labels**: X/Y axis label sizes (linked/unlinked), tick number size, data label size; NudgePads for axis label offsets and tick offsets
- **Legend**: show/hide toggle, position (Right/Bottom/Inside/Custom), per-layer controls with editable titles, heading/item font sizes

### NudgePad Component
Replaces raw X/Y offset inputs with directional arrows (↑↓←→) + reset button:
- Default step: 10px (configurable per instance)
- Hold Shift for fine control (×0.2), Ctrl for coarse (×5)
- Center reset button returns to 0,0
- Current offset values shown when non-zero

### Typography Defaults (base sizes at 1.0x font scale)
- Axis labels: 96px (was 32px — 3× increase for document readability)
- Tick numbers: 64px (was 24px)
- Data labels: 64px (was 24px)
- Legend headings: 96px (was 36px)
- Legend items: 64px (was 24px)
- Plot title: 128px (was 48px)

### Persistence (localStorage)
- Font scale, resolution, and legend position persist across export sessions
- Offset values always start fresh from computed defaults

### Reset to Defaults
- Header "Reset" button recomputes all settings from current layers
- Resets font scale to 1.0x, re-derives legend titles, restores all offsets to 0

### Output
- PNG download with timestamped filename (`fred_export_{timestamp}.png`)

---

## 11. Application Layout

### Sidebar (Left Panel)
- File upload button (CSV/TSV/TXT)
- Active layer indicator
- Token count display (filtered / total)
- Filter sections (dynamically shown based on field visibility settings)
- Gear icon for field visibility configuration

### Header
- App title
- Token count badge

### Main Display (Center)
- Tab bar: F1/F2, 3D F1/F2/F3, Time Series, Duration, Phoneme Dist., Table
- Config toolbar (context-sensitive per active tab)
- Plot area (fills remaining space)
- Layer panel dropdown (F1/F2 tab only)
- Export button, B&W toggle, Tooltip settings button

---

## 12. Technology Stack

| Component | Technology |
|-----------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| 3D | Custom orthographic projection (Canvas 2D) |
| Icons | lucide-react |
| Canvas | HTML5 Canvas API (2D context) |
| Testing | Vitest |

---

## 13. File Structure

```
FRED/
  App.tsx                              # Main app component, state management, layer logic
  types.ts                             # All TypeScript interfaces and types
  index.tsx                            # Entry point
  index.html                           # HTML template
  components/
    MainDisplay.tsx                    # Tab bar, config toolbar, plot routing
    CanvasPlot.tsx                     # F1/F2 canvas plot (multi-layer)
    Scatter3DPlot.tsx                  # 3D F1/F2/F3 scatter
    TrajectoryF1F2.tsx                 # Trajectory F1/F2 plot
    TrajectoryTimeSeries.tsx           # Trajectory time series plot
    DurationPlot.tsx                   # Duration box plots
    PhonemeDistributionPlot.tsx        # Phoneme distribution bar charts
    Sidebar.tsx                        # Filter sidebar
    Header.tsx                         # Top header bar
    ExportDialog.tsx                   # Export configuration modal
    StyleEditor.tsx                    # Floating style editor (colors/shapes/etc.)
    DataMappingDialog.tsx              # Column mapping dialog for import
  services/
    csvParser.ts                       # CSV/TSV parsing, auto-detection, alias table
    csvParser.test.ts                  # Parser tests
  utils/
    getLabel.ts                        # Shared label extraction utility (checks fields dict)
    getLabel.test.ts                   # Label utility tests
    normalization.ts                   # Speaker stats, normalization (Lobanov, Nearey, etc.)
    textureGenerator.ts                # Texture pattern generation
```

---

## 14. Key Data Types

### SpeechToken
Core data record: `id`, `speaker`, `file_id`, `xmin` (number), `duration` (number), `trajectory: TrajectoryPoint[]`, `fields: Record<string, string>`. All categorical/text columns are stored generically in `fields` — there are no dedicated properties for word, phoneme, type, etc.

### PlotConfig
All visualization settings: axis inversion, visual encoding channels, plot type, point/ellipse/centroid/trajectory options, opacity values, tooltip fields, ranges. Duration-specific fields: `durationPlotBy`, `durationClusterBy`, `durationYField`, `durationBoxOrder` (`'alpha'|'central'`), `durationBoxDir` (`'asc'|'desc'`), `durationCenterLine` (`'median'|'mean'`), `durationWhiskerMode` (`'iqr'|'minmax'`), `durationRange`, `durationTooltipFields`, `showQuartiles`, `showOutliers`, `showDurationPoints`.

### FilterState
`{ filters: Record<string, string[]> }` — single generic dictionary. Keys are field names (e.g., `'speaker'`, `'type'`, `'phoneme'`), values are arrays of selected values. Empty array = nothing passes.

### Layer
Combines id, name, visibility, isBackground flag, PlotConfig, FilterState, and StyleOverrides.

### ColumnMapping
`{ csvHeader, role: ColumnRole, fieldName?, timePoint?, formant?, isSmooth?, formantLabel?, showInSidebar?, isDataField? }` — maps a CSV column to a role with optional metadata. `isDataField` distinguishes Filter vs Data fields; `showInSidebar` controls sidebar visibility.

### DatasetMeta
`{ fileName, columnMappings: ColumnMapping[], timePoints: number[], rowCount, formantVariants: string[] }` — file-level metadata derived at import time.

### ExportConfig
All export settings: scale, geometry, typography, title, legend position/visibility/titles, canvas dimensions.
