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

### Column Roles
| Role | Description | Aliases |
|------|-------------|---------|
| `file_id` | Speaker/file identifier | `fileid`, `speaker`, `speaker_id`, `participant`, `subject` |
| `word` | Word context | `words` |
| `syllable` | Syllable | `syl` |
| `syllable_mark` | Syllable mark | `syl_mark` |
| `canonical_stress` | Expected stress | `can_stress`, `expected_stress` |
| `lexical_stress` | Transcribed stress | `lex_stress`, `transcribed_stress` |
| `canonical` | Target phoneme | `phoneme`, `target`, `target_phoneme`, `vowel`, `segment` |
| `produced` | Actual allophone | `allophone`, `actual`, `realised`, `realized`, `transcribed` |
| `alignment` | Alignment type | `align`, `align_type` |
| `type` | Segment type | `segment_type` |
| `canonical_type` | Vowel category | `can_type`, `vowel_type` |
| `voice_pitch` | Voice pitch | `pitch` |
| `xmin` | Onset time | `onset`, `start`, `start_time` |
| `duration` | Segment duration | `dur`, `seg_dur` |
| `formant` | Formant data (auto-detected from pattern `f[1-3]_<time>_<variant>`) | |
| `custom` | User-defined categorical field | |
| `ignore` | Column is not imported | |

### Formant Column Detection
- Regex pattern: `f[1-3]_<timepoint>[_<variant>]` (e.g., `f1_50`, `f2_30_smooth`)
- Supports multiple formant variants (e.g., raw + smoothed); select between them via the Data dropdown in the config toolbar
- Time points are derived from the data (not hardcoded); all plots use `findNearestTimePoint()` for flexible lookup

### Custom Columns
- Any unrecognized categorical column (<=50 unique values in sample) is assigned `custom` role
- Custom columns are stored in `SpeechToken.customFields` as `Record<string, string>`
- Can be used as visual encodings (Color By, Shape By, etc.) and as filter fields in the sidebar

### Data Mapping Dialog
- Modal UI listing all detected columns with role dropdowns
- Shows sample data preview for each column
- User can reassign roles, set custom field names, or ignore columns
- Formant columns show formant/time-point details and auto-detected variant tags (e.g., "smooth")
- **Sidebar column**: Every non-ignore, non-formant role has a checkbox to control sidebar visibility
  - Filter-type fields (type, canonical, produced, word, alignment, stresses, etc.) default to **checked**
  - Data-type fields (file_id, xmin, duration, syllable) default to **unchecked**
  - Users can toggle any field on/off; settings persist after import
- Role labels: "Phoneme" (canonical), "Allophone" (produced) — parenthetical suffixes removed for clarity

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

### Duration Plot
- Box-and-whisker plots per phoneme group
- Configurable: quartiles, mean marker, outliers, individual data points
- Adjustable max duration range

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
| **Group By** | Duration | Same as Color By |

### Encoding Dropdown Filtering
- Visual encoding dropdowns (Color By, Shape By, Line Type By, Texture By) only list variables whose corresponding field is **active in the sidebar** (`showInSidebar === true` on the column mapping)
- The mapping from variable names to column roles uses `getLabel` conventions (e.g. `phoneme` → `canonical` role)
- Custom columns are included only if they are sidebar-active
- `None` is always available regardless of sidebar state

### Color Palette
- Default: 19 colors (`#ef4444`, `#3b82f6`, `#10b981`, ...)
- B&W mode: 12 greyscale steps from `#000000` to `#ffffff`
- Style editor palette automatically switches to greyscale swatches when B&W mode is active

### Shapes
12 shapes: `circle`, `square`, `triangle`, `diamond`, `hexagon`, `circle-open`, `square-open`, `triangle-open`, `diamond-open`, `plus`, `cross`, `asterisk`

### Line Types
5 patterns: `solid`, `dash`, `dot`, `longdash`, `dotdash`

### Style Editor
- Click any legend item to open a floating style editor
- Edit color (palette grid), shape (icon grid), line type (dropdown), or texture (pattern selector)
- Per-layer overrides stored in `layer.styleOverrides`

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
- **Flat, independent filters** — no hierarchical dependency between Type, Category, and Phonemes
- Empty array = nothing selected = nothing passes (for required filters: types, phonemes)
- Optional filters (alignments, words, stress, etc.): empty array = no restriction

### Built-in Filter Fields
| Field | Filter Key | Required? |
|-------|-----------|-----------|
| Type | `types` | Yes |
| Vowel Category | `vowelCategories` | Yes (for vowels) |
| Phonemes | `phonemes` | Yes |
| Words | `words` | No |
| Alignments | `alignments` | No |
| Allophones | `produced` | No |
| Expected Stress | `canonicalStress` | No |
| Transcribed Stress | `lexicalStress` | No |
| Syllable Mark | `syllableMark` | No |
| Voice Pitch | `voicePitch` | No |

### Custom Filters
- Dynamic filter sections for each custom column in the dataset
- Stored in `FilterState.customFilters: Record<string, string[]>`

### Sidebar Controls
- Each filter section has **All** / **Clear** buttons
- Word filter has a search box
- **Gear icon** (Settings2) opens a popover listing ALL available fields (built-in + custom) with checkboxes to toggle visibility in the sidebar
- `ColumnMapping.showInSidebar` controls field visibility; set during import via Sidebar column in the Data Mapping Dialog
- On import, `computeSelectAllFilters()` populates all filter arrays with all unique values

### Per-Layer Filtering
- Each layer has its own `FilterState`
- Sidebar edits the active layer's filters
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

### Affected Sliders (11 total)
1. `trajectoryLineOpacity` (config bar, trajectory mode)
2. `trajectoryLineOpacity` (traj_f1f2 / traj_series section)
3. `pointOpacity`
4. `ellipseLineOpacity`
5. `ellipseFillOpacity`
6. `meanTrajectoryOpacity` (config bar, trajectory mode)
7. `meanTrajectoryOpacity` (traj_f1f2 / traj_series section)
8. `centroidOpacity`
9. `refVowelLabelOpacity`
10. `refVowelEllipseLineOpacity`
11. `refVowelEllipseFillOpacity`

### Stored Values
- Config values remain linear 0-1 floats; only slider display/input is non-linear

---

## 9. Configurable Tooltip

### Configuration
- **Tooltip button** in the toolbar (F1/F2 and 3D tabs) opens a popover with checkboxes
- Select up to **10 fields** from all available built-in + custom columns
- Stored in `PlotConfig.tooltipFields: string[]`

### Default State
- Tooltip starts **empty** (no fields selected)
- When hovering a token with no fields selected, a friendly message is shown: *"Select fields from the Tooltip dropdown to see token data here."*
- Users opt-in to exactly the fields they want to see

### Dropdown Filtering
- The tooltip dropdown only shows fields that **actually exist in the loaded dataset**
- Fields are matched against `datasetMeta.columnMappings` — only roles with a mapped CSV column appear
- Custom columns from the dataset are always shown
- This prevents stale or unmapped fields (e.g., `xmin` when no onset column was mapped) from cluttering the dropdown

### Built-in Field Options (shown only when mapped)
| Key | Label |
|-----|-------|
| `file_id` | File ID |
| `word` | Word |
| `syllable` | Syllable |
| `syllable_mark` | Syllable Mark |
| `canonical_stress` | Expected Stress |
| `lexical_stress` | Transcribed Stress |
| `canonical` | Phoneme |
| `produced` | Allophone |
| `alignment` | Alignment |
| `type` | Type |
| `canonical_type` | Vowel Category |
| `voice_pitch` | Voice Pitch |
| `xmin` | Time (xmin) |
| `duration` | Duration |

Plus any custom columns from the dataset.

### Rendering
- First field rendered as header with accent styling
- Remaining fields in a 2-column grid
- `xmin` and `duration` formatted as `.toFixed(3)s`
- Custom fields accessed via `token.customFields`
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
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| 3D | Three.js (via @react-three/fiber + @react-three/drei) |
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
    getLabel.ts                        # Shared label extraction utility
    getLabel.test.ts                   # Label utility tests
    textureGenerator.ts                # Texture pattern generation
```

---

## 14. Key Data Types

### SpeechToken
Core data record representing one acoustic token with file_id, word, syllable, stress, phoneme, allophone, alignment, type, pitch, timing, trajectory points, and optional custom fields.

### PlotConfig
All visualization settings: axis inversion, visual encoding channels, plot type, point/ellipse/centroid/trajectory options, opacity values, tooltip fields, ranges.

### FilterState
All filter arrays (types, vowelCategories, phonemes, alignments, produced, words, stress, syllableMark, voicePitch) plus customFilters record.

### Layer
Combines id, name, visibility, isBackground flag, PlotConfig, FilterState, and StyleOverrides.

### DatasetMeta
File metadata: fileName, columnMappings, timePoints, customColumns, rowCount, formantVariants.

### ExportConfig
All export settings: scale, geometry, typography, title, legend position/visibility/titles, canvas dimensions.
