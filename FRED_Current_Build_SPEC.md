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
| Role | Description | Aliases / pattern |
|------|-------------|---------|
| `speaker` | Speaker identifier | `speaker_id`, `participant`, `subject` |
| `file_id` | File identifier | `fileid`, `filename`, `file` |
| `duration` | Segment duration | `dur`, `seg_dur`, fuzzy `dur_*` / `*_dur` |
| `formant` | Formant data | pattern `f[1-5]_<time>[_<variant>]`, bare `f1`, named `f1_onset` |
| `pitch` | Pitch / F0 data | pattern `f0_<time>[_<variant>]`, `pitch`, `voice_pitch` |
| `token_id` | Groups long-format rows into tokens | `segment_id`, `item_id`, `obs_id`, … |
| `timepoint` | Time column for long format | `times_norm`, `time_rel`, `timepoint`, … |
| `spectral_cog` / `spectral_sd` / `spectral_skew` / `spectral_kurt` / `spectral_bandratio` | Consonant spectral measurements (see Spectral section) | measure synonyms with an optional region label and `_N%`, `_tN` or `_kN` suffix |
| `field` | Generic field (categorical or data) | *(any unrecognized column)* |
| `ignore` | Column is not imported | |

All columns that don't match a built-in role are assigned `field` role, with the original
column header as `fieldName`. The xmin column (aliases: `xmin`, `onset`, `start`,
`start_time`) is treated as a `field` with `isDataField: true` and populates
`SpeechToken.xmin`.

### Formant & Pitch Column Detection
- **Formant regex**: `f[1-5]_<timepoint>[_<variant>]` (e.g., `f1_50`, `f2_30_smooth`); bare
  `f1`…`f5` = single measurement at timepoint 0; named targets (`f1_onset`) map to synthetic
  timepoints. F4/F5 are stored as named data fields (TrajectoryPoint holds f1–f3).
- **Pitch regex**: `f0_<timepoint>[_<variant>]` (e.g., `f0_50`, `f0_80_smooth`)
- Supports multiple formant variants (e.g., raw + smoothed); select between them via the Data dropdown in the config toolbar
- Time points are derived from the data (not hardcoded); all plots use `findNearestTimePoint()` for flexible lookup

### Rows and cells
- **A row is not a line.** CSV allows a newline inside a quoted field, and exporters write
  one whenever a label contains a line break. Splitting the text on newlines tore such a
  row in two: the tail arrived as a row of its own, so the *file id* of that row held half
  a row of formant numbers while the dialog — which samples the first few lines — looked
  perfectly fine. `splitRows(text)` scans for newlines **outside** quotes, and every reader
  (upload, header toggle, parse) goes through it.
- `splitRow(line, delimiter)` splits one row into cells, keeping a quoted delimiter inside
  its value (`"Maungawhau,"`), reading a doubled quote as an escaped one (`""` → `"`), and
  collapsing a value that spanned lines into a single line so it reads as one label.

### Delimiters, headers, robustness (verified by probe tests)
- Delimiter: comma or tab only (chosen by count in the first line). Semicolon files parse
  as a single column.
- Header row auto-detected (`detectHeaderRow` heuristic + user override "First row: Data").
- CRLF and LF line endings; UTF-8 with or without BOM; quoted values with embedded
  delimiters and doubled quotation marks.
- Empty / non-numeric cells (`NA`) yield NaN for that measurement; the token is kept.
- 50k-row files parse in ~150 ms.
- **FormantStudio** (https://github.com/snavez/FormantStudio) emits formant + spectral CSVs
  in this format directly.

### Generic Fields
- All non-built-in columns are assigned `field` role with `fieldName` set to the CSV header
- Categorical columns (<=50 unique values in sample) default to filter fields (`isDataField: false`)
- Numeric/high-cardinality columns default to data fields (`isDataField: true`)
- All field values are stored in `SpeechToken.fields: Record<string, string>` — a single generic dictionary
- Fields can be used as visual encodings (Color By, Shape By, etc.) and as filter fields in the sidebar
- The user can toggle any field between Filter and Data mode in the Data Mapping Dialog
- **One rule decides what is a label** (`utils/filterFields.ts`): a column is a label —
  filterable in the sidebar, offered as an encoding — when it has a filter key and is not
  a data field, unless the user explicitly asks for it with `showInSidebar: true`. The
  sidebar, the visibility popover and the Colour / Shape / Group menus all read
  `listFilterFields`, so **anything you can filter by you can also group by**, and a
  column confirmed as Data never appears among the filters.
- Every token value is read through `getLabel(token, key)` — filters, sidebar options and
  encodings share the one accessor
- A measure role only sticks to a column of numbers: `voice_pitch` holding high/low is
  auto-detected as a label, not a pitch measure, and the same guard applies to `*_dur`
  columns and to region-labelled spectral names
- **Missing values are read as missing, not as text** (`hasValue`): exporters write an
  unmeasured cell as empty, `NA`, `n/a`, `NaN`, `null`, `-` or `.`, and a column measured
  for only some segments (a release duration, a burst COG) is mostly those. Counting them
  as text made such a column look categorical, which dropped it from every numeric menu
  while a fully-populated `MAU_dur` beside it came through fine.
- **Detection reads deeper than the preview** (`DETECTION_ROWS`, 200 rows): the mapping
  dialog previews five rows, but a sparse column can be empty in all five, which says
  nothing about what it holds

### Data Mapping Dialog
- Modal UI listing all detected columns with role dropdowns and sample data preview
- User can reassign roles, set field names, or ignore columns
- **Role options**: Formant Value, Duration Value, Pitch Value, Spectral COG / Diffusion
  (SD) / Skew / Kurtosis / Band Energy Ratio, Token ID, Timepoint, Custom Field, Ignore
  (Speaker/File ID are assigned via the quick-assign dropdowns at the top)
- **Filter/Data toggle**: Every non-ignored column gets a Filter/Data toggle
  - **Filter**: categorical label for sidebar filtering (default for low-cardinality columns)
  - **Data**: numeric value for plotting, not shown in sidebar (default for high-cardinality columns)
- **Sidebar checkbox**: shown when Filter is selected; controls sidebar visibility (defaults checked)
- **CSV column order, always** (`utils/mappingRows.ts` → `buildMappingRows`): rows follow
  the file's header order in every view. A column never moves when its role or its
  Filter/Data toggle changes, and a collapsed family sits at the position of its earliest
  column. Ordering by role instead moved a row out from under the cursor as it was
  reclassified, and put the same column in different places depending on the view it was
  reached from.
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

### Box-plot config (shared)
- `showQuartiles`, `showOutliers`, `showMeanMarker`, `boxShowPoints`, `boxWhiskerMode`,
  `boxCenterLine` and `boxWidth` are shared by the Data Summaries boxes and the Spectral
  distribution, so a box reads the same wherever it is drawn. Layout fields that only make
  sense for the clustered duration layout (`durationGroupGap`, `durationBoxGap`,
  `durationBoxOrder`, `durationBoxDir`) stay duration-specific.

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
- **Value range override** (`durationRange`): manual Y minimum and maximum; 0 = auto. The
  maximum auto-fits to 110% of the data max. The minimum is 0 for durations and stays 0
  unless the data actually goes negative (skewness, a DCT coefficient, the band energy
  ratio), in which case the floor drops to 110% of the data min and a dashed zero
  reference line is drawn across the plot. Only a negative override moves the floor.
- **Y-axis ticks** (`utils/axisTicks.ts` → `axisTicks`): ticks sit on a nice 1/2/5×10^k
  step inside the range and are formatted to exactly the decimals that step needs. The
  previous `(max-min)/5` walk with `toFixed(2)` produced uneven, untrue labels on small
  ranges (0, .02, .04, .05, .07, .09 for a duration axis).
- **Centre value labels** (`showCenterValueLabels`): prints the centre statistic's value
  beside each box, following whichever statistic `boxCenterLine` selects. Shared with the
  Spectral distribution plot.
- **Interactive legend**: HTML overlay with colour swatches + texture pattern previews. Click any item to open the StyleEditor for manual colour/texture customisation. Style overrides persist via `layer.styleOverrides`
- **Configurable tooltip**: hover over outlier circles or jitter points to see token details. Field selector popover (max 10 fields) with `durationTooltipFields` stored in PlotConfig
- **Zoom & Pan**: scroll wheel zooms towards cursor, click-drag to pan. +/−/RESET VIEW buttons at bottom-left. Canvas transform applied to rendering; hit-detection inverse-transforms mouse coordinates
- **Plot border**: a grey frame (`#94a3b8`) bounds the data area, matching the Spectral tab.
  Drawn last so data never covers it, and inside the transformed space so it pans and zooms
  with the plot. The legend overlay sits wholly inside it.

### Scatter (any variable against any other)
- Tab under **General**, for the question you are still forming: whether two measurements
  separate your categories at all. Any numeric variable in the dataset can go on either
  axis — `COG_release_50%` against `release_dur`, a formant against a pitch, a duration
  against a spectral coefficient.
- **Measures** (`utils/measures.ts`) are the shared catalogue of numeric variables:
  `listNumericMeasures` enumerates them (token duration, then duration / pitch / spectral
  / data columns, then the formants the file carries), `measureValue` reads one from a
  token, and `measureLabel` names the axis. A formant needs a timepoint before it names a
  single number, so those measures get their own time dropdown per axis
  (`formantMeasureKeys` says which).
- Both axes live on the background layer, so every visible layer shares one coordinate
  space, as on the F1/F2 and Spectral scatters.
- Colour lives in Row 2 with the rest of the encodings, not twice.
- **The same visual vocabulary as F1/F2**: colour and shape encodings, points (size,
  opacity), SD ellipses per group, group means as markers or labels, the on-screen legend
  and StyleEditor, hover point-info, pan/zoom, and image export. `renderEncodingControls`
  takes a `forcePointMode` flag so a trajectory layer is not offered line controls this
  plot cannot honour.
- **Fit** (`linearFit` in `services/statistics.ts`): a least-squares line with Pearson's
  `r`, `R²`, the two-tailed p-value against no relationship (t = r√(n−2)/√(1−r²) on n−2
  df) and `n`, drawn over the x-range the data actually covers. Fit **All tokens** or
  **per colour group** — a single line through several clouds can suggest a relationship
  that holds in none of them. The readout is drawn on the plot for the active layer.
- Ranges default to fitting the data (`fitRange`), with Min/Max boxes to pin them; data
  is clipped to the frame.

### Spectral (Consonant analysis)
- Tab between **Time Series** and **Data Summaries** (labelled **Spectral**; `activeTab` id
  stays `'spectral'`), for consonant spectral data.
- **Measures, not just moments** (`SpectralMeasureKey`): the four spectral moments — centre
  of gravity (COG), standard deviation / spread (SD), skewness, kurtosis — plus the
  **band energy ratio** (`bandratio`, 10·log10(P_high / P_low) in dB), which FormantStudio
  exports in the same loop under the same naming scheme. `SPECTRAL_MEASURE_DEFS` is the
  full list, moments first in conventional moment order; each def carries `isMoment` and
  `centredAtZero`. `SPECTRAL_MOMENT_DEFS` is derived from it by `isMoment` and still means
  exactly the four moments; `SpectralMomentKey` is the narrow type for code that means
  those four.
- Each measure can arrive in **three forms**, discovered and stored separately by
  `utils/spectralMoments.ts` (`discoverSpectralColumns`). Synonyms (centroid→COG,
  spread/stdev/SpecDiff→SD, kurtosis→kurt, bandratio/bandenergyratio/ber→bandratio) and an
  optional `_smooth` suffix are tolerated:
  - **Point** — a measure at a position: `COG_20%`, `bandratio_50%` (`getSpectralValue`).
  - **Track** — a dense contour over normalised time: `COG_t0` … `COG_tN`
    (`getSpectralTrackValue`, `getSpectralTrack`).
  - **Coefficient** — DCT/polynomial coefficients describing a track's shape:
    `COG_k0` … `COG_kN`, conventionally k0 = height, k1 = slope, k2 = curvature
    (`getSpectralCoeffValue`).
  `parseSpectralColumn` classifies a column by suffix (`_tN` / `_kN` tested before `_N%`).
  **Grid lengths are always read from the data** — a dataset may carry any number of track
  samples or coefficients (`spectralIndicesOfKind`).
- **Regions**: a column may name the phase of the segment it measures, between the measure
  and the position — `COG_closure_20%`, `bandratio_release_t3`. Region labels are free text
  read from the header (`splitMeasureAndRegion`; the longest leading run of parts spelling a
  measure wins, so `centre_of_gravity_burst_50%` is COG in the `burst` region). Every
  measurement is addressed by **measure × region × kind × position**, so closure never
  shares a slot with release. `meta.regions` lists them in the order the dataset presents
  them, and `spectralMeasuresOfKind` / `spectralIndicesOfKind` / `spectralKindsAvailable` /
  `spectralRegionsOfKind` answer what each region carries — regions need not be symmetric.
  A dataset with no region labels behaves exactly as before (region `''`).
- **Features** (`SpectralFeature`) are the scalars an axis or measure picker can offer:
  a moment at a timepoint in a region (`release:COG@50`) or a coefficient
  (`closure:COG~k1`); refs without a region prefix (`COG@50`) mean the unlabelled family,
  so configs saved before regions existed still resolve. `listSpectralFeatures` enumerates
  them (optionally within one region), `resolveSpectralFeature` falls back when a stored
  ref is absent, `resolveSpectralAxes` resolves a scatter pair together (an unusable Y
  falls back to X's partner — the next moment in X's own region at the same position), and
  `getSpectralFeatureValue` reads one. Tracks are excluded — they are vectors, selected by
  moment alone. `spectralFeatureAt` moves a feature along its grid, which is how a
  trajectory sweeps.
- **Explicit mapping roles**: the Data Mapping dialog offers **Spectral COG / Spectral
  Diffusion (SD) / Spectral Skew / Spectral Kurtosis / Spectral Band Energy Ratio** roles
  (`spectral_cog` / `spectral_sd` / `spectral_skew` / `spectral_kurt` /
  `spectral_bandratio` in `ColumnRole`), so columns with *any* name can feed
  the Spectral tab. Role-mapped columns are authoritative in `discoverSpectralColumns`
  (claimed first; the header-pattern scan fills remaining slots). The role names the
  *measure*; which of the three forms a column holds is read from its name suffix, and its
  region from `ColumnMapping.spectralRegion` (auto-filled from the header, editable in the
  dialog — so a hand-named column can be labelled `release` by hand).
- The CSV parser auto-assigns these roles by header via the shared `detectSpectralRole`
  (COG/centroid, SD/stdev/spread/SpecDiff/diffusion, skew(ness), kurt(osis) — bare, or with
  a region label and/or a `_N%`, `_tN` or `_kN` suffix); mis-assignments can be corrected in
  the dialog. The explicit roles also keep spectral columns clear of the high-cardinality
  "ignore" heuristic. Values are stored in `token.fields` under the column name, and
  spectral columns appear in the Data Summaries numeric Y-axis options. Analysis metadata
  that shares the suffix (`winms_closure_20%`, `nsamples_20%`, `winsource_20%`) is left
  alone — the *head* of the name must spell a measure — and a region-labelled name is only
  accepted when the column's sampled values are actually numeric, so a categorical
  `skew_notes` is not swept up. Per-region durations (`closure_dur`, `release_dur`) stay
  duration fields, usable on the Data Summaries Y axis.
- **Family roll-ups in the mapping dialog**: spectral columns sharing a role, kind and base
  name (region included) collapse into one group row per family, so tracks stay separate
  from point moments and closure from release:
  - "Spectral COG at timepoints · closure · 3 columns · 20% to 80%"
  - "Spectral COG track · release · 11 columns · t0 to t10"
  - "Spectral COG coefficients · 4 columns · k0 to k3"
  Each spectral group row carries a **Region** box that relabels the whole family at once.
  Expanding shows each member with its role dropdown, a chip giving its position
  (`50%`, `t3`, `k1` — `spectralColumnChip`) and its own region box. Remapping a member
  removes it from the group live. (Formant groups need `TRAJECTORY_MIN_POINTS` (4) columns; spectral families group
  from 2.)
- **Signed measures**: a def with `centredAtZero` (today only the band ratio: 0 dB = equal
  energy in both bands) is drawn with a dashed zero reference line across every axis that
  carries it — scatter X and Y, distribution, mean contours, density — whenever the range
  spans zero (`isCentredAtZero`, `drawFrame`'s `zero` argument). The range is **not** forced
  symmetric. The same flag is what a diverging colour scale would key off; FRED currently
  colour-maps only categorical variables, so there is no continuous-colour site yet.
- **Band edges and the provenance sidecar** (`services/provenance.ts`): two CSVs exported
  with different band edges carry identically-named `bandratio_*` columns that are not
  comparable, and nothing in the header says so. FormantStudio writes
  `<file>.provenance.json` beside the CSV with `spectral.band_ratio_low_hz`,
  `spectral.band_ratio_high_hz` and `spectral.band_ratio_units`. The file picker takes
  multiple files (a browser cannot go looking for the sidecar itself); a sidecar whose name
  matches the data file is parsed into `DatasetMeta.provenance`, carried onto
  `SpectralMeta.bandRatio` by `discoverSpectralColumns`, and stated in every axis label —
  `Band ratio 5.5–7.5k / 0.4–0.9k (dB)` — plus a **Dataset info** line in the sidebar with
  the exact edges in its tooltip. With no sidecar the label reads `Band Energy Ratio (dB)`;
  edges are never invented. A malformed or partial sidecar is treated as no sidecar.
- **Axis ticks**: all four views tick through `utils/axisTicks.ts` (`axisTicks`), so labels
  sit on a nice step and are formatted to that step's decimals.
- **Control row** reads Plot → Mode → Data → Axes → position → ranges:
  - **Plot** (`spectralMode`) — Scatter / Distribution / Mean contours / Density.
  - **Mode** — the variant of that plot: `plotType` (Points/Trajectory) for scatter,
    `spectralViolin` (Box/Violin) for distribution, `spectralContourAbsolute`
    (Normalised/Absolute) for contours.
  - **Data** — which column kind the axes sit on, derived from the X feature's kind.
    Switching it re-seeds both axes (`setSpectralKind`), so **both axes always share a
    kind** — a track sample can never be compared against a %-timepoint. Coefficients are
    withheld while Mode is Trajectory, since they have no time axis.
  - **Axes X/Y** list moments only; for coefficients each axis gains its own order picker
    (k0 × k1 of one moment being the headline plot). When the dataset labels regions, each
    axis also gains a **region** dropdown — the two axes may sit in *different* regions, so
    closure COG × release COG plots the two phases of each token against each other.
    Changing an axis's region snaps its moment and position back into what that region
    actually carries.
  - Switching Data **keeps each axis's moment and region** (`spectralFeatureOnKind`), so
    COG × SD of the release stays COG × SD of the release, just sampled along the new
    grid; positions move proportionally between the two time-like kinds (50% ↔ t5, and
    back), while coefficient orders start at k0 since they are not positions in time.
    Switching plot type carries the same measurement across: the box/density measure
    (`resolveSpectralMeasure`) and the contour family (`resolveSpectralContour`) fall back
    to the scatter X axis when the stored one does not fit the dataset.
  - **Time / Sample** is one shared position dropdown moving both axes together, mirroring
    the formant tabs. **Range** (`spectralTrajRange`, `[0,0]` = full) trims the trajectory
    sweep, mirroring the Time Series range control.
- **Colour** grouping (`config.colorBy`) drives grouping/colouring across all modes. Summary
  modes also expose a geometry-appropriate second grouping channel: **Line Type**
  (`lineTypeBy`) for Mean contours and Density, and **Fill Type** (`textureBy`) for
  Distribution. The renderer groups by the actual colour × secondary combinations, and
  the on-screen legend + StyleEditor work through the shared encoding maps.
- Four modes (`config.spectralMode`):
  - **Feature scatter** — any feature on X vs any on Y (`spectralXFeature` /
    `spectralYFeature`, on the background layer). COG@50 × SD@50 separates sibilant from
    non-sibilant fricatives; **k0 × k1** (height × slope) is a 2D shape space where
    categories that overlap on height alone often separate once direction is added. This
    mode is a **multi-layer canvas** (see below).
  - **Distribution** — box-and-whisker (1.5×IQR whiskers + outliers) or violin (Gaussian KDE)
    of one feature (`spectralFeature`) per colour × fill-type group. A box plot of **k1 by group** turns
    a visual impression of contour direction into a comparable number. **All coefficients**
    (`spectralCoeffFacets`) draws small multiples — one panel per coefficient sharing the
    group axis, each on **its own scale**, because k0 runs into the tens of thousands while
    k1 is a few hundred and a shared axis would flatten all but k0.
  - **Mean contours** — per colour × line-type group mean of one measurement family (`spectralTimelineMoment`,
    a `region:moment` ref such as `release:COG`) across the track grid, with an optional **±1 SD band** (`spectralShowBand`) and faded per-token
    lines (`spectralShowIndividual`). Grid selection is per measure and region: a dense
    track is preferred for that family, otherwise its %-timepoints are used. Thus COG
    track columns do not hide a Band Energy Ratio available only at 20/50/80%.
    Normalised time averages pointwise, which is valid because every token shares
    the grid. **Absolute** (`spectralContourAbsolute`) instead places each token's samples
    at its real times from the duration column chosen in the controls, resamples onto a
    common millisecond grid by
    linear interpolation, and averages only where ≥2 tokens still reach — so short tokens
    drop out of the tail instead of dragging the mean down, and the duration difference
    that normalised time hides becomes visible.
  - **Density** — Gaussian-KDE density curves of one feature per colour × line-type group
    (active layer).
    Groups with no values are skipped rather than drawn as a flat line on the axis.
- **Absolute-time contours measure the right span** (`utils/duration.ts`). A dataset can
  hold several duration columns — the whole segment, the closure, the release — and a
  release contour drawn across the segment duration misreports how long the release
  lasted. The **Duration** control (shown only in Absolute mode) names the column, and
  defaults to whichever duration column names the region being plotted
  (`durationFieldForRegion`: region `release` → `release_dur`). Naming a column is a
  statement about which span to measure, so a token with no value in it has **no**
  duration and is left out, rather than falling back to its whole segment and stretching
  the axis.
- **Each contour is resampled over its own span** (`utils/contours.ts`), from its own
  tokens. A shared grid made a group's shape *and length* depend on the longest group
  present, so adding a category silently redrew the ones already on the plot. The span
  runs to the group's **median duration**: past that fewer than half its tokens are still
  sounding, and a mean over the few longest describes them rather than the group. Two
  consequences worth knowing: a contour's length is readable as that group's median
  duration (/t/ ends at 26 ms, /tʰ/ at 59 ms, /ts/ at 77 ms in the release data), and
  every sample averages at least half the group. The time axis covers every contour
  drawn, extended to the 98th percentile of token durations only when the faded
  individual lines are shown; those lines are drawn at each token's own sample times,
  with no resampling at all.
- **Visual controls per mode** (Row 2, beside Colour). Contours and density reuse the
  trajectory config the scatter already uses, so a setting means the same thing wherever
  it appears; the distribution reuses the shared box-plot config with the Data Summaries
  tab:
  - **Mean contours** — **Line Type** supplies the second grouping variable. *Lines*: individual contours on/off (`spectralShowIndividual`)
    with opacity (`trajectoryLineOpacity`) and width (`trajectoryLineWidth`). *Means*:
    line width (`meanTrajectoryWidth`), opacity (`meanTrajectoryOpacity`), sample dots
    (`showMeanTrajectoryPoints` + `meanTrajectoryPointSize`), ±1 SD band
    (`spectralShowBand` + `spectralBandOpacity`). *Labels*: name each mean at the end of
    its contour (`showTrajectoryLabels` + `meanTrajectoryLabelSize`).
  - **Distribution** — **Fill Type** supplies the second grouping variable. *Show*: Quartiles / Outliers / Mean marker / raw Points (with
    opacity and size). *Box*: whisker extent (1.5×IQR or Min–Max), centre line
    (median or mean), box width in px.
  - **Density** — **Line Type** supplies the second grouping variable. Explicit **Line
    Width**, **Line Opacity** and **Fill Opacity** sliders control the curve and fill;
    line opacity does not multiply or otherwise alter `spectralDensityFill`.
- **Ranging fits what is drawn** (`utils/plotRange.ts`). Spectral measures are long-tailed,
  so ranging on the raw extent leaves the summary the plot exists to show as a sliver at
  one edge. `fitRange(must, tail)` always contains the `must` values and widens towards the
  `tail` cloud only as far as its trimmed quantiles:
  - Contours: means (and the band when shown) always fit; the individual lines widen the
    range only when they are drawn, and only to their 2nd–98th percentile.
  - Distribution: boxes, whiskers and mean markers always fit; outliers and raw points
    widen it to the 2nd–98th percentile of the values. Points past the axis are **clipped
    and counted** — a small `▲ n` / `▼ n` marker at the edge of each slot says how many,
    so nothing disappears silently.
  - Density: the 1st–99th percentile of the pooled values.
  - Every mode clips its drawing to the frame, so data never spills outside the axes (in
    the coefficient small-multiples, never into a neighbouring panel).
- **Coefficient sign** (`spectralFlipSign`, box/density only, shown only for coefficient
  features): a rising contour has a *negative* k1, which reads backwards on a chart, so the
  toggle negates the value and the axis label notes it.
- **Caveats surfaced in Help tooltips**: normalised time discards duration (pair a contour
  plot with a duration box plot in Data Summaries), and the track is inset by half an
  analysis window, so `t0` is not literally the segment onset.
- **Multi-layer scatter** (mirrors F1/F2): the scatter view iterates all visible layers using
  the shared global layer system. Each layer is drawn as **points** or **trajectories** per
  its own `plotType`:
  - *Point layer* — one marker per token at the axis features; optional individual points,
    per-group SD ellipses, and per-group means (centroids).
  - *Trajectory layer* — each token's path through the axis space over time (e.g. a stop
    release from onset→offset), plus a per-group **mean trajectory** with points and an
    optional arrowhead at the offset end. Optional faded individual paths. The path sweeps
    the **track grid** when the dataset has one (11 points rather than 3), else the
    %-timepoints.
  - The **background layer** (`layers[0]`) controls the shared coordinate space: both axis
    features and the axis ranges. Per-layer filters, colour and type are independent. A
    trajectory layer sweeps the *moments* of the axis features, which is what keeps point and
    trajectory layers overlayable on one pair of axes.
  - Trajectories need both axes on **point** features; coefficients are not time-varying, so
    a coefficient axis disables sweeping (the layer falls back to points and the control bar
    shows "Set both axes to moments to draw trajectories").
  - Enables the workflow: a point layer of fricative means + a trajectory layer of stop releases
    overlaid on one COG×SD plot to see where releases sit relative to frication/sibilance.
  - "Add Layer" (Point/Trajectory) is available on the Spectral tab as well as F1/F2.
  - **Full F1/F2-style visual controls**, shared verbatim with the F1/F2 tab (same layout, via
    `renderEncodingControls` in MainDisplay): Colour, Shape (point) / Line Type (trajectory),
    and — for point layers — Points (size/opacity), Ellipses (σ + line-width/line/fill),
    Means/centroids (size/opacity + label source), Labels (size); for trajectory layers —
    Lines (width/opacity), Means (width/opacity/points/arrow), Labels (size + source). Marker
    shapes, line-dash patterns, and centroid/trajectory labels all render on the canvas.
  - Encoding primitives (palette, `drawShape`, `ShapeIcon`, line-dash patterns,
    `computeEncodingMaps`) live in `utils/plotEncoding.tsx`, shared with the spectral plot.
  - **Legend**: top-right overlay (same position/style as F1/F2) listing each visible layer's
    colour / shape / line-type groups with counts; click an entry to edit its style. No entry is
    shown for a layer with no encoding variable set (so there is no "Background" placeholder
    swatch).
  - Default colour when no colour variable is set is neutral slate (`#64748b`), matching F1/F2.
- **Manual axis ranges** (Row 1, like F1/F2): scatter mode exposes X and Y Min/Max inputs on the
  background layer (`spectralXRange` / `spectralYRange`), labelled by the current axis features
  (e.g. "X · COG @50%", "Y · COG k1 (slope)"); summary modes expose a single value-axis Min/Max
  for the active layer (density writes X, box/contours write Y). Both Min and Max at 0 =
  auto-fit. With bands on, the contour auto-range widens to fit the ±1 SD ribbons.
  While a range is still auto, the plot reports the range it actually drew
  (`onAutoRange` → `spectralAutoRange` in MainDisplay) and the inputs display *those*
  numbers, so the arrows step from what is on screen. Editing one end seeds the other from
  the drawn range (`spectralRangeEdit`) rather than leaving it at a 0 the user never chose —
  without this, typing a Max collapsed the axis to [0, Max] and the data vanished.
- **Point Info**: configurable hover tooltip on the scatter (`config.tooltipFields`, shared with
  F1/F2), showing chosen fields plus the live values at the hovered point/vertex (labelled by
  feature, or by track step `t3` / timepoint on trajectories). The "Point Info" button appears
  on the Spectral tab.
- **Plot border**: a grey frame (`#94a3b8`) bounds the data area, matching F1/F2. On the
  Spectral tab the frame reserves a right-hand gutter whenever the on-screen legend is
  showing, so the border never cuts through the key and no data hides behind it; export
  renders keep the plain margin because they draw their own legend beside the plot.
- **Zoom & Pan** (scroll to zoom, drag to pan, Reset view).
- **Export** via the shared ExportDialog (`PlotHandle.generateImage`), with a multi-layer colour
  legend and optional title.
  Spectral exports pass `ExportConfig` into the shared axis frame: X/Y title sizes,
  shared or per-axis tick sizes, global font scaling and all axis/tick NudgePad offsets
  affect scatter, distribution, Mean contours and density exports. Export-only margins
  expand with those font sizes; the live canvas retains its compact typography.
- Empty-state messaging when no spectral columns are present, or a mode has too few positions.

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
- Modes: **Browse** and **Summary** (per-group descriptives). The former Analysis mode is
  now the Statistics tab; a persisted `tableMode: 'analysis'` falls back to Browse.

### Statistics (tab, `activeTab === 'stats'`)
- Renders `AnalysisView` (exported from TablePanel) on the active layer's **filtered**
  data — the sidebar filters apply to the tests exactly as to the plots.
- Engine in `services/statistics.ts` (jstat-esm for distribution CDFs): Shapiro-Wilk
  (AS R94/Royston), Levene (Brown-Forsythe), Student/Welch t, Mann-Whitney U, one-way and
  Welch ANOVA, Kruskal-Wallis, Tukey HSD, Dunn (Bonferroni), two-way factorial ANOVA with
  Type III SS + simple effects, chi-square / Fisher's exact with standardized residuals,
  effect sizes (Cohen's d, η², η²H, rank-biserial r, Cramér's V, partial η²).
- **Continuous**: multi-select Measures (≤10; formants at a chosen timepoint, duration,
  spectral features, custom numeric fields), Factor A, optional Factor B (two-way).
- **Speaker structure / unit of analysis**: `detectDesign()` classifies the factor as
  between-speaker (each speaker in one level) or within-speaker (speakers span levels)
  and counts complete speakers. With repeated tokens per speaker, `statsUnit` defaults to
  `'speakers'`: one mean per speaker per level. Between → independent tests on speaker
  means; within → `runRepeatedAnalysis()` on the complete-speaker matrix: paired t /
  Wilcoxon signed-rank (2 conditions), repeated-measures ANOVA with Greenhouse-Geisser
  correction / Friedman (3+), paired Bonferroni post-hocs, effect sizes dz / partial η² /
  Kendall's W / r. Normality target: differences (k=2) or model residuals (k≥3).
  `statsUnit: 'tokens'` is allowed with an amber banner (correlated tokens → optimistic
  p-values). Two-way with speaker unit aggregates to speaker×cell means. No speaker
  column: `statsSpeakerAssumption` ('unknown'|'single'|'multiple') records what the user
  knows and shapes the banner. A design banner above the results states speakers,
  tokens/speaker, design and unit.
- **Test choice** (`statsTestChoice`, one-way only): `'auto'` runs assumption checks and
  selects the test with a reasoning line; a forced test still runs the checks and the
  result card shows an amber advisory naming the recommended test
  (`TestResult.advisory`, built in `runAnalysis(grouped, alpha, testChoice)` /
  `runRepeatedAnalysis(matrix, names, alpha, testChoice)`).
  `applicableTests(k)` / `applicableRepeatedTests(k)` gate the choices; the Test dropdown
  offers paired options when the design is within-speaker and the unit is speaker means.
  An inapplicable forced choice falls back to the recommendation.
- **Mixed-effects model** (`statsTestChoice: 'lmm'`, one-way with a speaker column and
  repeated tokens): `services/lmm.ts` fits a random-intercepts linear mixed model on all
  tokens — `measure ~ factor + (1|speaker)` (plus `(1|word)` when a word field with ≥2
  values exists). Profiled REML/ML deviance per lme4 (Bates et al. 2015): sparse-free
  dense Cholesky of Λ'Z'ZΛ+I, penalized least squares, Nelder-Mead / golden-section over
  θ ≥ 0 with restarts; capped at `LMM_MAX_LEVELS` (1200) grouping levels. Inference by
  likelihood-ratio test on ML fits (`lmmLRT`), avoiding the mixed-model df problem;
  estimates reported from the REML fit. `TablePanel` renders formula, LRT card, fixed
  effects (treatment coding vs. first level) with SEs and t (|t| > 2 guide), variance
  components with near-zero warnings. Random intercepts only — random slopes via R export.
  Validated in `services/lmm.test.ts` against balanced-design closed forms
  (σ̂² = MS_within, σ̂_b² = (MS_between−MS_within)/r, SE(diff) = √(2σ²/m)), scale/shift
  invariances, and crossed-effects variance recovery.
- **Export for R (lme4)**: button on the design banner (`services/rExport.ts`) downloads
  `fred_data.csv` (token rows: measures, factors, speaker, word; `NA` for missing;
  `rName()` mirrors R's `make.names`) and `fred_analysis.R` — an lmerTest script per
  measure: ML full/null `anova()` LRT, REML `summary()`, commented random-slope and
  emmeans lines.
- **Categorical**: Row/Col variables → contingency table, chi-square (Fisher's exact for
  sparse 2×2), standardized residuals.
- Adjustable α; Copy/LaTeX/CSV export on every results table.

---

## 3. Multi-Layer System (F1/F2 and Spectral scatter)

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
- Visual encoding dropdowns (Color By, Shape By, Line Type By, Texture By) offer exactly
  the fields the sidebar lists as filters — both call `listFilterFields(datasetMeta)`, so
  the two menus can never disagree
- Any role can supply a label (`speaker`, `file_id`, `field`, `pitch`, `duration`, a
  spectral column); what decides is the Filter/Data classification, not the role
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

### Point Info (hover)
- The fields a hovered point shows are a property of the **view**, not of a layer: the
  popover writes them to every layer (`setAllLayersConfig`), and a tooltip falls back to
  whichever layer has fields configured (`tooltipFieldsFor`). Kept per layer, a new layer
  came up with none, and hovering one of its points showed the "choose some fields"
  placeholder — indistinguishable from a token with no data.
- **Only points that are drawn are hoverable** (`layerShowsPoints`). The hit-test index
  used to hold every visible layer's tokens whether or not that layer drew them, so a
  background layer showing just its means still won hits: the cursor sat on a visible
  point but the tooltip described an invisible one behind it. A layer contributes to the
  index when it draws points (`showPoints`), or, in trajectory mode, when its lines are
  not fully transparent.

### Sidebar Controls
- **Reset** beside the Filters heading selects every value in every field again, so there
  is a way back from a filtered view without hunting for which field is still narrowed.
  It is disabled when nothing is filtered out, which also makes it a live indicator that
  the view is complete.
- Each filter section has **All** / **Clear** buttons
- Search box appears when a field has >50 unique values
- **Gear icon** (Settings2) opens a popover listing every label field with checkboxes to toggle sidebar visibility
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

### Zoom and pan move the axes, not the picture
- Scaling the canvas shrank the frame along with the data, so zooming out to look for a
  stray token just made everything smaller inside a smaller box and anything past the old
  limits stayed hidden. Instead the frame stays where it is and the **range** it shows
  changes (`utils/zoomRange.ts`): the wheel zooms about the cursor, dragging pans, and the
  axis numbers — and the Min/Max boxes — say what is currently on screen.
- Applied to the F1/F2 plot, the Spectral plot and the Scatter tab. The value under the
  cursor stays under the cursor while zooming, and a zoom in followed by a zoom out
  returns where it started.
- Because the range *is* the view, "reset view" and "fit to data" are the same action:
  each plot offers **Fit to data**, and typing in the Min/Max boxes is just another way to
  set the same thing.

### Ellipses
- Standard deviation ellipses per group
- Configurable: SD multiplier (1-3), line width, line opacity, fill opacity

### Export outliers (F1/F2, point mode)
- **Outliers** button beside the ellipse controls lists every token falling outside the
  ellipse drawn around its group, as a CSV to work through — a mistracked formant lands
  well outside its vowel's cloud, so the ellipse on screen doubles as a review queue.
- Membership is decided by **Mahalanobis distance** from the group mean using the same
  population covariance the ellipse is drawn from: a token is exported exactly when it
  sits outside the ellipse on screen. The distance is invariant under a linear change of
  axes, so the scan runs in data space and the normalisation in force does not change
  which tokens are selected.
- Follows the plot: current filters, the visible layers, each layer's grouping
  (colour × shape), smoothing, normalisation, timepoint and its own σ setting. Groups of
  fewer than three points have no ellipse, so they are reported as unjudged rather than
  guessed at.
- **Token fields** are chosen in the dialog, starting from the Point Info fields and
  falling back to File ID — an export nobody can trace back to a recording is useless, so
  the download is blocked until at least one is picked (`listPointFields`, shared with the
  Point Info selector).
- Columns: `layer` (multi-layer only), `group`, the chosen token fields, `F1`, `F2` as
  plotted, `F1_z` / `F2_z` (per-axis deviation), `sd_distance` (Mahalanobis),
  `ellipse_sd` (only when visible layers use different σ), and **`divergence`** — the axis
  and direction of the excursion, worst first: `high F1`, `high F1; low F2`. A token
  outside the ellipse but ordinary on each axis alone (a combination the ellipse's tilt
  rules out) is named for whichever axis it deviates on most.
- Rows are sorted by distance, worst first; the file is `fred_outliers_<σ>SD.csv`.
- `utils/outliers.ts` holds the maths and the row building, so it is not tied to formants:
  any two plotted axes can be scanned the same way.

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

### Export axis labels and legends
- **Category labels are fitted, not dropped.** An export canvas is wide but its fonts are
  wider: at the export tick size a row of category names overlapped into an unreadable
  band. Labels now shrink a little to fit their bar and, when that is not enough, turn
  45° — the answer every plotting tool gives; a label is only dropped when there is not
  even the height to stand it up in. Bar value labels are fitted to their own bar the
  same way.
- Tick labels take the **tick** size (`xTickLabelSize ?? tickLabelSize`), not the axis
  *title* size, and the bottom margin reserves room for them.
- **Group names are drawn in exports.** They were suppressed unless `xGroupLabelSize` had
  been set by hand, which left distribution exports with no x axis at all; they now
  default to the tick size.
- **Every legend carries counts**, on screen and in export alike: `label (n=…)` for
  colour, line-type and texture keys, in every plot.

### Export Dialog
- Full-screen modal with a scale-1 **layout preview** and a full-resolution download.
  `utils/exportLayout.ts` is the shared contract for all seven canvas exporters: graph
  scale changes the logical composition, while resolution (`scale`) multiplies every
  pixel dimension uniformly and cannot change the relative size or position of text, plot,
  margins or legend.
- The dialog snapshots the config rendered in the preview. Controls immediately mark the
  preview stale, retain the previous image under an Updating overlay, and disable download
  until the new preview finishes. Download re-renders that exact snapshot—not mutable UI
  state—at the selected resolution. The preview also reports the final PNG dimensions.
- **Smart defaults**: `computeExportDefaults()` derives config from current layers (legend titles, section visibility)
- **Resolution**: configurable scale multiplier (1x–4x, default 3x)
- **Canvas**: auto-sized to fit plot + margins + legend. Bottom legends allocate real
  vertical canvas space; Spectral legends auto-size to their labels and support every
  position offered by the dialog.
- **Dynamic margins**: margins in `generateImage()` scale with font sizes so nothing overflows

### Quick Settings (always visible)
- Resolution buttons (1x–4x)
- Global Font Scale slider (0.5x–3.0x) — proportionally scales all text

### Collapsible Sections
Each section is collapsible with a dot indicator when non-default values are set:

- **Chart Title**: toggle on/off, text, size, NudgePad for position offset
- **Graph Geometry**: graph scale (linked/unlinked X/Y), NudgePad for graph offset
- **Axis Labels**: X/Y axis label sizes (linked/unlinked), tick number size, data label
  size; NudgePads for axis label offsets and tick offsets. Below the shared tick size,
  three per-axis overrides (`SizeSlider`): **X Axis Ticks** (`xTickLabelSize`), **X Group
  Labels** (`xGroupLabelSize` — the second x-axis row: the group name beneath a cluster of
  boxes or a group of bars) and **Y Axis Ticks** (`yTickLabelSize`). Each is optional and
  falls back to the size that axis already uses; the global Font Scale slider moves any
  overrides by the same ratio.
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
- Tab bar, grouped by purpose with hairline separators and small group labels (`TAB_GROUPS`
  in MainDisplay). Every plot stays one click away — the labels are a signpost, not a second
  level of navigation:
  - **Vowels** — F1/F2, 3D F1/F2/F3, Time Series
  - **Consonants** — Spectral
  - **General** — Data Summaries, Distributions, Statistics, Table (these work on any numeric field,
    spectral measures included, so they serve both vowel and consonant work)
- Config toolbar (context-sensitive per active tab)
- Plot area (fills remaining space)
- Layer panel dropdown (F1/F2 and Spectral — the multi-layer canvases)
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
    SpectralMomentsPlot.tsx            # Spectral tab (scatter/box/contours/density)
    TablePanel.tsx                     # Table view
    Sidebar.tsx                        # Filter sidebar
    Header.tsx                         # Top header bar
    ExportDialog.tsx                   # Export configuration modal
    StyleEditor.tsx                    # Floating style editor (colors/shapes/etc.)
    DataMappingDialog.tsx              # Column mapping dialog for import
    OutlierExportDialog.tsx            # Ellipse-outlier CSV export (field picker + preview)
    VariableScatterPlot.tsx            # Scatter tab: any measure vs any measure, with fit
  services/
    csvParser.ts                       # CSV/TSV parsing, auto-detection, alias table
    csvParser.test.ts                  # Parser tests
    statistics.ts                      # Statistical test engine (see Statistics tab)
    statistics.test.ts                 # Paired/RM test + pipeline tests
    lmm.ts                             # Random-intercepts mixed model (profiled REML/ML)
    lmm.test.ts                        # Closed-form / invariance / recovery validation
    rExport.ts                         # Export-for-R: fred_data.csv + lme4 script
  utils/
    getLabel.ts                        # Shared label extraction utility (checks fields dict)
    getLabel.test.ts                   # Label utility tests
    filterFields.ts                    # What counts as a label: sidebar filters = encodings
    filterFields.test.ts               # Label-field rule tests
    normalization.ts                   # Speaker stats, normalization (Lobanov, Nearey, etc.)
    plotEncoding.tsx                   # Shared encoding primitives (palette, shapes, dashes)
    contours.ts                        # Mean contours over absolute time (per-group spans)
    zoomRange.ts                       # Zoom/pan by moving the axis range, not the canvas
    zoomRange.test.ts                  # Zoom/pan range tests
    contours.test.ts                   # Contour resampling / span tests
    csv.ts                             # CSV cell quoting, row building, file download
    duration.ts                        # Which span a plot measures (columns, units, region match)
    duration.test.ts                   # Duration-source tests
    measures.ts                        # Numeric-variable catalogue + value accessor
    measures.test.ts                   # Measure catalogue / accessor tests
    outliers.ts                        # Tokens outside their group's ellipse (+ CSV rows)
    outliers.test.ts                   # Outlier scan / divergence / CSV tests
    pointInfo.ts                       # Which fields a hover shows; which layers are hoverable
    pointInfo.test.ts                  # Point-info / hoverability tests
    plotRange.ts                       # Axis ranges that fit what is drawn (fitRange, quantile)
    plotRange.test.ts                  # Range-fitting tests
    spectralMoments.ts                 # Spectral discovery/features (moments, regions, tracks, coeffs)
    spectralMoments.test.ts            # Spectral tests
    trajectory.ts                      # Trajectory interpolation helpers
    textureGenerator.ts                # Texture pattern generation
  scripts/
    generate-screenshots.mjs           # Regenerates docs/images via headless Edge
  docs/
    USER_MANUAL.md                     # User manual (screenshots in docs/images/)
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
`{ csvHeader, role: ColumnRole, fieldName?, timePoint?, formant?, isSmooth?, formantLabel?, formantTarget?, spectralRegion?, showInSidebar?, isDataField? }` — maps a CSV column to a role with optional metadata. `isDataField` distinguishes Filter vs Data fields; `showInSidebar` controls sidebar visibility; `spectralRegion` labels the segment phase a spectral column measures.

### DatasetMeta
`{ fileName, columnMappings: ColumnMapping[], timePoints: number[], rowCount, formantVariants: string[], provenance?: DatasetProvenance }` — file-level metadata derived at import time. `provenance` is read from the exporter's JSON sidecar when one was selected alongside the CSV and carries `bandRatio: { low, high, units }` — the frequency bands behind the band-ratio columns.

### ExportConfig
All export settings: scale, geometry, typography, title, legend position/visibility/titles, canvas dimensions.
`tickLabelSize` sizes tick text everywhere; the optional `xTickLabelSize`,
`yTickLabelSize` and `xGroupLabelSize` override it per axis and per x-axis layer.
