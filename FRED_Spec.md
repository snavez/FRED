# FRED (Formant Research for EDucation) — Technical Specification

**Version:** 1.0.0-draft
**Last Updated:** 2026-03-05
**Status:** In Development (functional prototype)

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Stories](#2-user-stories)
3. [System Architecture](#3-system-architecture)
4. [File Upload & Data Mapping](#4-file-upload--data-mapping)
5. [Filtering System](#5-filtering-system)
6. [Multi-Layer System](#6-multi-layer-system)
7. [Shared Plot Components](#7-shared-plot-components)
8. [Plot Types](#8-plot-types)
9. [Export Functionality](#9-export-functionality)
10. [AI Integration](#10-ai-integration)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Error Handling](#12-error-handling)
13. [Testing Criteria](#13-testing-criteria)
14. [Future Considerations](#14-future-considerations)

---

## 1. Overview

### 1.1 Purpose

FRED (Formant Research for EDucation) is a browser-based application for visualising acoustic speech data. It enables phoneticians, linguists, and speech researchers to upload datasets and generate publication-quality plots of vowel formants, segment durations, phoneme distributions, and other acoustic measures.

### 1.2 Design Philosophy

- **Flexibility over rigidity**: Accept diverse data formats rather than enforcing a single schema
- **Progressive disclosure**: Simple defaults with advanced options available on demand
- **Publication-ready output**: All exports suitable for academic papers (colour and greyscale)
- **Performance at scale**: Handle datasets of 50,000+ rows without degradation
- **Multi-layer composition**: Overlay multiple filtered views of the same dataset

### 1.3 Target Users

| User Type | Technical Level | Primary Goals |
|-----------|----------------|---------------|
| Phonetician/Researcher | Moderate | Generate publication figures, compare vowel realisations |
| Student | Low-Moderate | Explore acoustic data, learn formant relationships |
| Corpus Linguist | High | Batch analysis of large speech corpora |

### 1.4 Scope

**Implemented (v1.0):**
- CSV/TSV file upload and parsing
- 10-filter cascading filter system
- Multi-layer visualisation system (up to 10 layers)
- 6 plot types: F1/F2 scatter/trajectory, 3D F1/F2/F3, trajectory time series, trajectory F1/F2, duration, phoneme distribution
- Data table view
- Per-layer style overrides (colours, shapes, line types, textures)
- Reference vowel overlay with covariance ellipses
- High-resolution PNG export with comprehensive layout controls
- AI-assisted acoustic analysis (Gemini integration)
- Greyscale/B&W mode
- Synthetic data generation for demo/testing

**Not Yet Implemented (targeted for v1.1+):**
- Flexible data column mapping interface (see [Section 4.3](#43-flexible-data-mapping-interface-not-yet-implemented))
- Configuration profile saving/loading
- SVG export format
- Audio playback integration
- Statistical analysis panel
- Vowel normalisation (Lobanov, Nearey, etc.)
- Multi-file comparison
- User accounts / cloud storage

---

## 2. User Stories

### 2.1 Core Workflows

| ID | As a... | I want to... | So that... | Priority | Status |
|----|---------|--------------|------------|----------|--------|
| US-01 | Researcher | Upload my formant data CSV | I can visualise my vowel space | Must | Done |
| US-02 | Researcher | Map my column names to expected data types | I don't have to rename all my columns | Must | **Not done** |
| US-03 | Researcher | Save my column mapping configuration | I can reuse it for future uploads with the same format | Should | **Not done** |
| US-04 | Researcher | Filter data by phoneme, speaker, stress, etc. | I can focus on specific subsets | Must | Done |
| US-05 | Researcher | Colour points by one variable and shape by another | I can visualise interactions between factors | Must | Done |
| US-06 | Researcher | Show/hide individual points, means, and ellipses | I can create the exact visualisation I need | Must | Done |
| US-07 | Researcher | Hover over a point and see its metadata | I can identify outliers or interesting tokens | Must | Done |
| US-08 | Researcher | Export my plot as PNG | I can include it in publications | Must | Done (PNG only, SVG not yet) |
| US-09 | Researcher | Use the plot in greyscale | My figure works in B&W print | Should | Done |
| US-10 | Student | See sensible defaults without configuration | I can get started quickly | Should | Done (synthetic data on load) |
| US-11 | Researcher | Overlay multiple filtered views on one plot | I can compare conditions side-by-side | Should | Done (multi-layer system) |
| US-12 | Researcher | Customise colours/shapes per category per layer | Different layers can have distinct visual encodings | Should | Done |
| US-13 | Researcher | View trajectories over time | I can see dynamic formant movement | Should | Done |
| US-14 | Researcher | See 3D vowel space (F1/F2/F3) | I can analyse the full formant space | Should | Done |

### 2.2 Edge Case Workflows

| ID | As a... | I want to... | So that... | Priority | Status |
|----|---------|--------------|------------|----------|--------|
| US-15 | Researcher | Handle SAMPA notation (e.g., "6", "4") as categories | Numeric-looking phonemes aren't treated as numbers | Must | Done |
| US-16 | Researcher | Work with 50,000+ row datasets | I can analyse large corpora | Must | Done (canvas rendering) |
| US-17 | Researcher | See clear errors when my data is malformed | I can fix my source file | Should | Partial |
| US-18 | Researcher | Compare two subsets overlaid on one plot | I can see differences between conditions | Should | Done (multi-layer) |

---

## 3. System Architecture

### 3.1 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | React 19 + TypeScript | Component reusability, type safety |
| Build | Vite | Fast development builds, HMR |
| Rendering | Canvas 2D | High-performance point/trajectory rendering at any scale |
| Parsing | Custom CSV parser | Handles quoted fields, trajectory column detection |
| 3D Rendering | Custom orthographic projection | No dependency on Three.js; canvas-based 3D scatter |
| State | React hooks (useState, useMemo, useCallback) | Efficient recalculation of derived data |
| Styling | Tailwind CSS | Rapid UI development |
| AI | Google Gemini API (optional) | Automated acoustic phonetics insights |

### 3.2 Component Architecture

```
App.tsx
├── State: data[], layers[], activeLayerId, layerCounters
├── Logic: filterData(), updateStyleOverride(), globalReferences
│
├── Header.tsx
│   └── Token counter, AI Insights button, branding
│
├── Sidebar.tsx
│   ├── CSV file upload (drag & drop)
│   ├── Token count display
│   ├── Hierarchical filter cascade (10 filters)
│   └── Contrast variable filters
│
└── MainDisplay.tsx
    ├── Tab navigation (7 tabs)
    ├── Layer management panel
    ├── Context-sensitive configuration toolbar
    ├── StyleEditor.tsx (floating popup)
    ├── ExportDialog.tsx (modal)
    │
    ├── CanvasPlot.tsx          (F1/F2 scatter + trajectory, multi-layer)
    ├── Scatter3DPlot.tsx       (3D F1/F2/F3)
    ├── TrajectoryF1F2.tsx      (F1/F2 trajectory specialist)
    ├── TrajectoryTimeSeries.tsx (frequency over time)
    ├── DurationPlot.tsx        (box/bar plots)
    ├── PhonemeDistributionPlot.tsx (grouped/stacked bar charts)
    └── Data table view (inline)
```

### 3.3 Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌────────────┐
│ File Upload     │     │ CSV Parser       │     │ Per-Layer       │     │ Plot       │
│ (or synthetic   │ ──▶ │ parseSpeechCSV() │ ──▶ │ filterData()    │ ──▶ │ Rendering  │
│  data gen)      │     │                  │     │                 │     │            │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └────────────┘
                                                        │                       │
                                                        ▼                       ▼
                                                 ┌─────────────────┐     ┌────────────┐
                                                 │ layerData:      │     │ Export     │
                                                 │ Record<id,      │     │ Dialog     │
                                                 │  SpeechToken[]> │     │            │
                                                 └─────────────────┘     └────────────┘
```

### 3.4 Performance Architecture

- All plots rendered to Canvas 2D (no SVG DOM overhead)
- Coordinate lookup for hover detection (nearest-point search)
- Per-layer data computed via `useMemo` — only recalculated when layer filters change
- Reference vowel centroids computed once from background layer data via `useMemo`
- Zoom/pan via canvas transform (translate + scale) — no re-render needed

---

## 4. File Upload & Data Mapping

### 4.1 Current Implementation (Fixed Format)

The current CSV parser (`csvParser.ts`) expects a specific column structure:

#### 4.1.1 Expected Column Headers

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `file_id` | String | Yes | Speaker/file identifier |
| `word` | String | Yes | Word containing the segment |
| `syllable` | String | No | Syllable identifier |
| `syllable_mark` | String | No | Syllable quality marker |
| `canonical_stress` | String | No | Expected stress level |
| `lexical_stress` | String | No | Transcribed stress level |
| `canonical` | String | Yes | Target/expected phoneme |
| `produced` | String | No | Actual/realised phoneme |
| `alignment` | String | No | Alignment type (exact, substitution, etc.) |
| `type` | String | No | Segment type (vowel, consonant) — defaults to 'vowel' |
| `canonical_type` | String | No | Segment category (monophthong, diphthong) — defaults to 'vowel' |
| `voice_pitch` | String | No | Pitch register (high, low, etc.) |
| `xmin` | Number | No | Segment onset time (seconds) |
| `duration` | Number | No | Segment duration (seconds) |

#### 4.1.2 Trajectory Columns

Formant measurements at 11 time-points (0%, 10%, 20%, ..., 100%):

| Pattern | Example | Description |
|---------|---------|-------------|
| `f1_00` through `f1_100` | `f1_50` | Raw F1 values at each time-point |
| `f2_00` through `f2_100` | `f2_50` | Raw F2 values |
| `f3_00` through `f3_100` | `f3_50` | Raw F3 values |
| `f1_00_smooth` through `f1_100_smooth` | `f1_50_smooth` | Smoothed F1 values |
| `f2_00_smooth` through `f2_100_smooth` | `f2_50_smooth` | Smoothed F2 values |
| `f3_00_smooth` through `f3_100_smooth` | `f3_50_smooth` | Smoothed F3 values |

### 4.2 Synthetic Data Generator

When no file is uploaded, FRED generates 5,000 synthetic tokens on load for immediate exploration. The generator creates realistic vowel data with:

- 6 vowel targets: /i/, /u/, /ae/, /a/, /ai/ (diphthong), /ou/ (diphthong)
- Realistic F1/F2/F3 base values with natural variation
- Sinusoidal trajectory curves with Gaussian noise
- Random metadata (words, stress levels, alignments, pitch)
- Duration range: 0.1–0.4 seconds

### 4.3 Flexible Data Mapping Interface (NOT YET IMPLEMENTED)

This is a high-priority feature for v1.1. The goal is to accept any CSV/TSV with arbitrary column names and allow users to map them to FRED's internal data model.

#### 4.3.1 Auto-Detection Heuristics

Upon file upload, FRED should analyse column headers and sample data (first 1,000 rows) to infer column types.

**Formant Column Detection:**

| Pattern (case-insensitive) | Detected As | Confidence |
|---------------------------|-------------|------------|
| `f1`, `F1`, `f1_*`, `F1_*` | F1 formant | High |
| `f2`, `F2`, `f2_*`, `F2_*` | F2 formant | High |
| `f3`, `F3`, `f3_*`, `F3_*` | F3 formant | High |
| `*_20`, `*_25`, `*_33`, `*_50`, `*_midpt`, `*_mid` | Timepoint indicator | High |
| Column with 90%+ numeric values in range 200–1000 | Possible F1 | Low |
| Column with 90%+ numeric values in range 500–3000 | Possible F2 | Low |

<!-- NOTE: other measurable data: pitch traces (f0 with or without timepoint indicators), and spectral data for consonants (need to determine best case for this) -->

**Temporal Column Detection:**

| Pattern (case-insensitive) | Detected As |
|---------------------------|-------------|
| `xmin`, `start`, `start_time`, `onset` | Segment start time |
| `xmax`, `end`, `end_time`, `offset` | Segment end time |
| `duration`, `dur`, `seg_dur` | Segment duration |

**Categorical/Filter Column Detection:**

| Heuristic | Detected As | Confidence |
|-----------|-------------|------------|
| ≤30 unique values AND ≥50% non-numeric | Categorical filter | High |
| Header contains: `phone`, `phoneme`, `segment`, `vowel`, `consonant` | Phoneme filter | High |
| Header contains: `preceding` | Preceding Phoneme | Medium |
| Header contains: `following` | Following Phoneme | Medium |
| Header contains: `speaker`, `file_id`, `participant`, `subject` | Speaker identifier | High |
| Header contains: `stress`, `accent`, `prominence` | Prosodic filter | High |
| Header contains: `word`, `token`, `item` | Lexical identifier | Medium |
| Header contains: `canonical`, `target`, `expected`, `phoneme` | Target/canonical form | High |
| Header contains: `produced`, `actual`, `realised`, `realized` | Surface realisation | High |
| Header contains: `alignment`, `align_type` | Alignment status | High |

<!-- NOTE: Phoneme filter additional categorical filter possibilities: voicing (voiced, voiceless, devoiced, creaky, breathy, modal), stops (aspirated, unaspirated), taps, fricatives, affricates, nasals, and vowels: monophthongs, diphthongs, long/short, front/back/central, high/mid/low, rounded/unrounded. Researchers may use any of these fields. Also phonotactic fields like position in word, pre-pausal. The input functionality just has to see fields and offer filter functionality based on the data within each field. -->

**SAMPA/IPA Detection:**

| Check | Action |
|-------|--------|
| Column contains values: `6`, `@`, `3`, `{`, `}`, `I`, `U`, `E`, `O`, `A` | Flag as phonetic notation |
| Column has <50 unique values AND header suggests phoneme | Treat as categorical regardless of numeric content |
| Mixed alphanumeric single characters (e.g., `a`, `e`, `6`, `@`) | Flag for user confirmation |

<!-- NOTE: System must handle IPA phonetic notation via UTF-8 encoding for non-standard characters -->

#### 4.3.2 Data Mapping UI (Planned)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ DATA MAPPING CONFIGURATION                                              │
│                                                                         │
│ We detected 24 columns. Please verify or adjust the mappings below.     │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ FORMANT DATA                                                    [?] │ │
│ │                                                                     │ │
│ │ F1 columns (6 detected):                                           │ │
│ │   ☑ f1_20  ☑ f1_35  ☑ f1_50  ☑ f1_65  ☑ f1_80  ☑ f1_95           │ │
│ │   [+ Add column]                                                   │ │
│ │                                                                     │ │
│ │ F2 columns (6 detected):                                           │ │
│ │   ☑ f2_20  ☑ f2_35  ☑ f2_50  ☑ f2_65  ☑ f2_80  ☑ f2_95           │ │
│ │   [+ Add column]                                                   │ │
│ │                                                                     │ │
│ │ F3 columns (0 detected):                                           │ │
│ │   [+ Add column]                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ TEMPORAL DATA                                                   [?] │ │
│ │                                                                     │ │
│ │ Segment start:  [xmin         ▼]                                   │ │
│ │ Segment end:    [xmax         ▼]                                   │ │
│ │ Duration:       [— calculated —]  OR  [dur ▼]                      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ FILTERS & CATEGORIES                                            [?] │ │
│ │                                                                     │ │
│ │ Column            Type              Unique Values    Action         │ │
│ │ ─────────────────────────────────────────────────────────────────── │ │
│ │ canonical         Phoneme (target)  12              [Change ▼]     │ │
│ │ produced          Phoneme (actual)  18              [Change ▼]     │ │
│ │ file_id           Speaker ID        45              [Change ▼]     │ │
│ │ alignment         Alignment         4               [Change ▼]     │ │
│ │ stress            Prosodic          3               [Change ▼]     │ │
│ │ syllable_mark     ⚠ Ambiguous       3               [Change ▼]     │ │
│ │                                                                     │ │
│ │ [+ Add filter from unused columns]                                 │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ IGNORED COLUMNS (will not be loaded)                                │ │
│ │                                                                     │ │
│ │ ☐ notes  ☐ transcriber  ☐ date_processed                           │ │
│ │                                                                     │ │
│ │ [Move to filters]                                                  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│                          [Cancel]  [Save as Profile ▼]  [Apply & Load] │
└─────────────────────────────────────────────────────────────────────────┘
```

<!-- NOTE: Features for mapping UI:
- Users can configure any field as "ignore" to avoid cluttering filter space
- Users can provide friendly display labels for columns (e.g., "seg_dur" → "Phoneme Duration")
- Users can save/load mapping configurations as profiles
-->

#### 4.3.3 Column Type Options

When user clicks [Change ▼], available options:

| Type | Description |
|------|-------------|
| Formant (F1) | First formant values |
| Formant (F2) | Second formant values |
| Formant (F3) | Third formant values |
| Formant (F0/Pitch) | Fundamental frequency |
| Time (Start) | Segment onset |
| Time (End) | Segment offset |
| Duration | Segment length |
| Phoneme (Target) | Canonical/expected phoneme |
| Phoneme (Actual) | Produced/realised phoneme |
| Speaker ID | Participant identifier |
| Alignment | Alignment type (exact, substitution, etc.) |
| Stress/Prosodic | Stress or prosodic marking |
| Lexical | Word or syllable identifier |
| Generic Filter | Any categorical variable |
| Numeric Data | Other numeric measurement |
| Ignore | Do not load this column |

#### 4.3.4 Configuration Profiles (Planned)

Profiles stored in browser localStorage as JSON:

```json
{
  "profileName": "Praat-MFA-Export-Standard",
  "created": "2025-01-29T10:30:00Z",
  "lastUsed": "2025-01-29T14:22:00Z",
  "columnMappings": {
    "f1_columns": ["f1_20", "f1_35", "f1_50", "f1_65", "f1_80"],
    "f2_columns": ["f2_20", "f2_35", "f2_50", "f2_65", "f2_80"],
    "time_start": "xmin",
    "time_end": "xmax",
    "filters": {
      "canonical": { "type": "phoneme_target" },
      "produced": { "type": "phoneme_actual" },
      "file_id": { "type": "speaker_id" },
      "alignment": { "type": "alignment" }
    }
  },
  "matchCriteria": {
    "requiredColumns": ["canonical", "produced", "f1_50", "f2_50"],
    "columnOrderMatters": false
  }
}
```

**Profile Matching on Upload:**
1. **Exact match**: All column names match a profile → auto-apply
2. **Partial match (≥80%)**: Most columns match → suggest profile
3. **No match**: Proceed to manual mapping interface

---

## 5. Filtering System

### 5.1 Current Implementation

Filters apply with AND logic — a token must pass ALL active filters to be included. Each layer has its own independent `FilterState`, allowing different layers to show different subsets of the same data.

#### 5.1.1 Filter State Structure

```typescript
interface FilterState {
  mainType: 'vowel' | 'consonant' | 'all';
  vowelCategory: 'monophthong' | 'diphthong' | 'all';
  phonemes: string[];
  alignments: string[];
  produced: string[];
  words: string[];
  canonicalStress: string[];
  lexicalStress: string[];
  syllableMark: string[];
  voicePitch: string[];
}
```

### 5.2 Filter UI (Sidebar)

The sidebar provides a hierarchical filter cascade:

#### 5.2.1 Step 1: Segment Type
- Dropdown: "All Types", "Vowels", "Consonants"
- Default: "All Types"

#### 5.2.2 Step 2: Vowel Category (shown only when Type = Vowels)
- Toggle buttons: "all", "monophthong", "diphthong"
- Classification uses `isMonophthong()` helper from CSV parser

#### 5.2.3 Step 3: Phonemes
- Multi-select toggle buttons, dynamically populated from filtered data
- "Clear" button to deselect all
- When empty (none selected), all phonemes pass the filter

#### 5.2.4 Step 4: Words (with Search)
- Searchable text input with live filtering
- Shows max 100 words with count of hidden words
- Multi-select toggle buttons
- "Clear" button

#### 5.2.5 Step 5: Alignments
- Toggle buttons: "exact", "substitution", "insertion", "deletion"
- Not selected by default (all pass)

#### 5.2.6 Step 6: Allophones (Produced)
- Multi-select toggle buttons
- "Clear" button

#### 5.2.7 Contrast Variables
- **Expected Stress**: "Stressed" (1), "Unstressed" (0)
- **Transcribed Stress**: "Un" (0), "Prim" (1), "Sec" (2)
- **Syllable Mark**: Dynamic multi-select buttons
- **Voice Pitch**: Dynamic multi-select buttons

### 5.3 Token Count Display

The sidebar shows `{filtered} of {total} tokens ({percentage}%)` reflecting the active layer's current filter state.

### 5.4 Per-Layer Filtering

Each layer has its own `FilterState`. The active layer's filters are displayed in the sidebar. Switching layers changes which filters are shown and editable. This enables overlaying differently-filtered views of the same dataset.

### 5.5 Future: Cascading Filter Updates

<!-- Rather than strictly hierarchical relationships, filters should behave like Excel filtering: selecting "vowel" should dynamically restrict downstream filter options to only values that appear in vowel tokens. Any field value can be selected at any level in any order. -->

---

## 6. Multi-Layer System

### 6.1 Overview

FRED supports up to 10 simultaneous layers on the F1/F2 scatter/trajectory plot (CanvasPlot). Each layer has independent configuration, filters, and style overrides, enabling overlay comparisons of different data subsets or visual encodings.

### 6.2 Layer Structure

```typescript
interface Layer {
  id: string;              // Unique identifier ('bg' for background)
  name: string;            // Display name (e.g., "POINT 001", "TRAJ 002")
  visible: boolean;        // Toggle rendering on/off
  isBackground: boolean;   // True only for the background layer
  config: PlotConfig;      // All plot settings
  filters: FilterState;    // Data filters
  styleOverrides: StyleOverrides;  // Per-category colour/shape/texture/lineType
}
```

### 6.3 Background Layer

The first layer (`id: 'bg'`) is always the background layer and has special properties:
- Cannot be deleted or moved
- Controls the coordinate space: `f1Range`, `f2Range`, `invertX`, `invertY`
- Provides data for non-F1/F2 plots (3D, time series, duration, distribution)
- Reference vowel calculations use background layer data only

### 6.4 Layer Management UI

Located in the MainDisplay toolbar (F1/F2 tab only):

| Control | Description |
|---------|-------------|
| Layer list | Shows all layers with type badge (T/P), name, visibility icon |
| Active layer selection | Click to switch which layer's config/filters are in the sidebar |
| Add layer | "+" button with dropdown: Point layer or Trajectory layer (disabled at 10) |
| Remove layer | "×" button per layer (not available for background) |
| Reorder | Up/down arrows to change draw order |
| Rename | Double-click layer name to edit |
| Visibility toggle | Eye icon to show/hide layer |

### 6.5 Layer Naming

Layers are auto-named with sequential counters:
- Point layers: "POINT 001", "POINT 002", etc.
- Trajectory layers: "TRAJ 001", "TRAJ 002", etc.
- Counters persist (removing "POINT 002" doesn't reset the counter)

### 6.6 Per-Layer Style Overrides

```typescript
interface StyleOverrides {
  colors: Record<string, string>;    // category → hex colour
  shapes: Record<string, string>;    // category → shape name
  textures: Record<string, number>;  // category → texture index
  lineTypes: Record<string, string>; // category → line type name
}
```

Clicking a legend item opens the StyleEditor popup, which modifies only the clicked layer's overrides. This means the same category (e.g., phoneme "ae") can have different colours in different layers.

---

## 7. Shared Plot Components

### 7.1 Colour System

#### 7.1.1 Default Colour Palette

15 colours used for categorical encoding:

| Index | Hex | Approximate Name |
|-------|-----|-----------------|
| 1 | #ef4444 | Red |
| 2 | #3b82f6 | Blue |
| 3 | #10b981 | Emerald |
| 4 | #f59e0b | Amber |
| 5 | #8b5cf6 | Violet |
| 6 | #ec4899 | Pink |
| 7 | #06b6d4 | Cyan |
| 8 | #84cc16 | Lime |
| 9 | #64748b | Slate |
| 10 | #dc2626 | Dark Red |
| 11 | #2563eb | Dark Blue |
| 12 | #059669 | Dark Emerald |
| 13 | #d97706 | Dark Amber |
| 14 | #7c3aed | Dark Violet |
| 15 | #db2777 | Dark Pink |

#### 7.1.2 Greyscale Mode

B&W palette (4 greys): `#000000`, `#525252`, `#969696`, `#d4d4d4`

When enabled:
- All colours mapped to greyscale equivalents
- Shape and line-type differentiation become primary distinguishers
- Texture/pattern fills available for bar charts

### 7.2 Shape System

12 shapes, ordered by distinctiveness:

| Index | Shape | Description |
|-------|-------|-------------|
| 1 | `circle` | Filled circle (default) |
| 2 | `square` | Filled square |
| 3 | `triangle` | Filled triangle-up |
| 4 | `diamond` | Filled diamond |
| 5 | `hexagon` | Filled hexagon |
| 6 | `circle-open` | Circle outline |
| 7 | `square-open` | Square outline |
| 8 | `triangle-open` | Triangle outline |
| 9 | `diamond-open` | Diamond outline |
| 10 | `plus` | Plus sign (+) |
| 11 | `cross` | Cross (×) |
| 12 | `asterisk` | Asterisk (*) |

### 7.3 Line Type System

5 line styles for trajectory encoding:

| Name | Dash Pattern | Description |
|------|-------------|-------------|
| Solid | `''` | Continuous line |
| Dash | `'5, 5'` | Medium dashes |
| Dot | `'2, 6'` | Small dots |
| Long Dash | `'15, 5'` | Long dashes |
| Dot-Dash | `'2, 4, 10, 4'` | Alternating dot and dash |

### 7.4 Texture/Pattern System

9 fill patterns for bar charts and distribution plots:

| Index | Pattern | Description |
|-------|---------|-------------|
| 0 | Solid | Flat colour fill |
| 1 | Forward slash | `/` diagonal lines |
| 2 | Back slash | `\` diagonal lines |
| 3 | Cross hatch | `X` crossed diagonals |
| 4 | Dots | Dot pattern |
| 5 | Horizontal lines | `—` horizontal stripes |
| 6 | Vertical lines | `|` vertical stripes |
| 7 | Grid | `+` grid pattern |
| 8 | Circle outline | `○` circle outlines |

Generated procedurally via canvas pattern API with 12×12px repeating tiles.

### 7.5 Visual Encoding Variables

Any of these variables can be assigned to colour, shape, line type, or texture:

| Value | Label | Source Field |
|-------|-------|-------------|
| `none` | None | — |
| `phoneme` | Phoneme | `canonical` |
| `word` | Word | `word` |
| `produced` | Allophone | `produced` |
| `alignment` | Alignment | `alignment` |
| `canonical_stress` | Expected Stress | `canonical_stress` |
| `lexical_stress` | Transcr. Stress | `lexical_stress` |
| `syllable_mark` | Syllable Mark | `syllable_mark` |
| `voice_pitch` | Voice Pitch | `voice_pitch` |

### 7.6 Legend Component

#### 7.6.1 Legend Sections

The legend displays separate sections for each active encoding channel:
- **Colour section**: Colour swatches with category labels and counts
- **Shape section**: Shape icons with labels and counts (only when shape encodes a different variable than colour)
- **Line type section**: Line style previews with labels and counts

When colour and line type encode the same variable, the legend combines them (showing coloured lines with appropriate dash patterns).

#### 7.6.2 Multi-Layer Legend

In the F1/F2 CanvasPlot, the legend shows sections per visible layer with layer name headers when multiple layers are visible.

#### 7.6.3 Legend Interactivity

| Action | Behaviour |
|--------|-----------|
| Click any legend item | Opens StyleEditor popup for that category |
| StyleEditor: click colour | Changes that category's colour (in clicked layer only) |
| StyleEditor: click shape | Changes that category's shape |
| StyleEditor: click line type | Changes that category's line style |
| StyleEditor: click texture | Changes that category's fill pattern |

### 7.7 Hover Tooltip

Shown when hovering over a data point on any plot:

| Field | Always Shown |
|-------|-------------|
| File/Speaker ID | Yes |
| Word | Yes |
| Phoneme (canonical) | Yes |
| Allophone (produced) | Yes (if different from canonical) |
| Duration | Yes |
| F1 value | Yes (scatter/trajectory plots) |
| F2 value | Yes (scatter/trajectory plots) |

Position: Near cursor, constrained to canvas bounds.

### 7.8 Zoom and Pan

Implemented on all canvas-based plots:

| Control | Action |
|---------|--------|
| Scroll wheel | Zoom in/out (centred on cursor) |
| Click + drag | Pan |
| Shift + drag | Rotate (3D plot only) |

### 7.9 Reference Vowels

An overlay system for displaying population-level vowel targets. Computed from the background layer's data.

#### 7.9.1 Calculation

For each monophthong in the dataset (alignment = 'exact'):
1. Filter by optional pitch register
2. Require ≥5 tokens per vowel
3. Calculate mean F1/F2 at the selected time-point
4. Compute full covariance matrix (with F1-F2 correlation)
5. Derive eigenvalues for ellipse radii and rotation angle
6. Output: `ReferenceCentroid { canonical, f1, f2, sdX, sdY, angle }`

#### 7.9.2 Reference Vowel Controls

| Control | Range | Default |
|---------|-------|---------|
| Show/Hide toggle | On/Off | Off |
| Vowel selection | Multi-select from available monophthongs | All |
| Pitch filter | Filter by voice pitch register | None |
| Label opacity | 0.0–1.0 | 1.0 |
| Label size | Slider | 12 |
| Ellipse line opacity | 0.0–1.0 | 1.0 |
| Ellipse fill opacity | 0.0–1.0 | 0.15 |

---

## 8. Plot Types

### 8.1 F1/F2 Scatter & Trajectory Plot (CanvasPlot)

The primary visualisation. Supports both scatter and trajectory modes with multi-layer composition.

#### 8.1.1 Purpose

Visualise vowel tokens in two-dimensional acoustic space (F1 × F2), showing distribution, overlap, and separation between phoneme categories. Optionally display formant trajectories showing dynamic vowel movement.

#### 8.1.2 Axes

| Axis | Data | Default Orientation |
|------|------|---------------------|
| X | F2 (Hz) | Inverted (high values on left) — phonetic convention |
| Y | F1 (Hz) | Inverted (high values on bottom) — phonetic convention |

Both axis orientations are user-configurable via `invertX` / `invertY` toggles.

#### 8.1.3 Visual Modes

**Point Mode** (`plotType: 'point'`):
- Individual points at a selected time-point (0–100% of vowel duration)
- Standard deviation ellipses per group
- Centroids (group means) as points or text labels
- Configurable point size, opacity, centroid size

**Trajectory Mode** (`plotType: 'trajectory'`):
- Individual trajectory lines showing formant movement over time
- Mean trajectories per group with configurable width/opacity
- Directional arrows at trajectory endpoints
- Trajectory labels at midpoint of mean trajectories
- Onset/offset control (e.g., show only 20%–80% of the vowel)

#### 8.1.4 Point Mode Configuration

| Property | Range | Default |
|----------|-------|---------|
| Show points | On/Off | On |
| Point size | Slider | 3 |
| Point opacity | 0.0–1.0 | 0.7 |
| Show ellipses | On/Off | Off |
| Ellipse SD multiplier | 1.0–3.0 | 2.0 |
| Ellipse line opacity | 0.0–1.0 | 0.6 |
| Ellipse fill opacity | 0.0–1.0 | 0.08 |
| Show centroids | On/Off | Off |
| Centroid size | Slider | 6 |
| Centroid opacity | 0.0–1.0 | 1.0 |
| Label as centroid | On/Off | Off (shows shape; On shows text label) |
| Label size | Slider | 12 |
| Label type | Auto / Colour / Shape / Both | Auto |
| Time-point | 0–100% | 50% |

#### 8.1.5 Trajectory Mode Configuration

| Property | Range | Default |
|----------|-------|---------|
| Show individual lines | On/Off | On |
| Line opacity | 0.0–1.0 | 0.5 |
| Show mean trajectories | On/Off | Off |
| Mean line width | Slider | 3 |
| Mean line opacity | 0.0–1.0 | 1.0 |
| Show trajectory labels | On/Off | Off |
| Label size | Slider | 12 |
| Show arrows | On/Off | On |
| Trajectory onset | 0–100% | 0% |
| Trajectory offset | 0–100% | 100% |
| Use smoothing | On/Off | Off |

#### 8.1.6 Encoding Options

| Channel | Available Variables | Applies To |
|---------|---------------------|-----------|
| Colour | Any variable or "None" | Both modes |
| Shape | Any variable or "None" | Point mode |
| Line Type | Any variable or "None" | Trajectory mode |

#### 8.1.7 Range Controls

| Property | Default |
|----------|---------|
| F1 min/max | Auto-calculated from data |
| F2 min/max | Auto-calculated from data |
| Invert X (F2) | On (phonetic convention) |
| Invert Y (F1) | On (phonetic convention) |

Range controls always target the background layer.

#### 8.1.8 Multi-Layer Rendering

Layers are drawn in order (background first, then overlays). Each visible layer renders its own data with its own configuration. The background layer's coordinate space (ranges, axis inversion) applies to all layers.

---

### 8.2 3D F1/F2/F3 Scatter Plot (Scatter3DPlot)

#### 8.2.1 Purpose

Visualise vowel tokens in three-dimensional formant space, adding F3 to the standard F1×F2 view.

#### 8.2.2 Axes

| Axis | Data | Direction |
|------|------|-----------|
| X | F2 (Hz) | Horizontal |
| Y | F3 (Hz) | Vertical |
| Z | F1 (Hz) | Depth |

#### 8.2.3 Features

- Custom orthographic projection (no Three.js dependency)
- Wireframe bounding box with axis ticks and labels
- Points with depth-based size scaling (painter's algorithm)
- 3D wireframe ellipses rendered on 3 orthogonal planes
- Centroid labels positioned in 3D space

#### 8.2.4 Interactivity

| Control | Action |
|---------|--------|
| Drag | Pan camera |
| Shift + Drag | Rotate camera (alpha = Y-axis rotation, beta = elevation) |
| Scroll | Zoom in/out |
| Quick-view buttons | Snap to F1/F2 (top), F2/F3 (front), F1/F3 (side) views |

#### 8.2.5 Configuration

Same encoding options as F1/F2 point mode (colour, shape). Uses background layer ranges for F1, F2, and F3.

---

### 8.3 Trajectory F1/F2 Plot (TrajectoryF1F2)

#### 8.3.1 Purpose

Specialised F1/F2 trajectory plot focused on high-quality trajectory visualisation with reference vowel overlays. Single-layer (uses active layer data).

#### 8.3.2 Features

- Individual trajectory lines colour-coded by grouping variable
- Mean trajectories with white outline for contrast
- Directional arrows at endpoints
- Reference vowel ellipses (1.5σ extent) with rotation
- Reference labels at ellipse centres
- Hover detection at trajectory endpoints

#### 8.3.3 Configuration

Same trajectory controls as CanvasPlot trajectory mode, plus full reference vowel controls (see Section 7.9).

---

### 8.4 Trajectory Time Series Plot (TrajectoryTimeSeries)

#### 8.4.1 Purpose

Show formant frequency over normalised time (or absolute duration), displaying both F1 and F2 traces.

#### 8.4.2 Axes

| Axis | Data |
|------|------|
| X | Time (normalised 0–100% or absolute seconds) |
| Y | Frequency (Hz) |

#### 8.4.3 Features

- Dual-channel display: F1 and F2 as separate traces
- F1 drawn with solid lines; F2 drawn with dashed lines (when no line-type variable set)
- Mean trajectories for both F1 and F2 with white outline
- Time normalisation toggle
- Individual + mean trajectory visibility

#### 8.4.4 Configuration

| Property | Range | Default |
|----------|-------|---------|
| Time normalised | On/Off | On |
| Show individual lines | On/Off | On |
| Line opacity | 0.0–1.0 | 0.5 |
| Show mean trajectories | On/Off | Off |
| Mean line width | Slider | 3 |
| Mean line opacity | 0.0–1.0 | 1.0 |
| Frequency range (Y-axis) | Min/Max Hz | Auto |
| Trajectory onset/offset | 0–100% | 0%–100% |

---

### 8.5 Duration Plot (DurationPlot)

#### 8.5.1 Purpose

Visualise segment duration distributions across phoneme categories using box-and-whisker plots or bar charts.

#### 8.5.2 Axes

| Axis | Data |
|------|------|
| X | Groups (phoneme or other groupBy variable) |
| Y | Duration (seconds) |

#### 8.5.3 Display Modes

**Quartile Mode** (box plot):
- Box: Q1 to Q3 (interquartile range)
- Median line inside box
- Whiskers: min to max
- Optional mean marker (diamond symbol)
- Optional jittered individual points

**Bar Mode**:
- Bars at mean height
- Error bars (±1 SD)
- Optional mean marker
- Optional jittered individual points

#### 8.5.4 Features

- Colour encoding by variable
- Texture/pattern fill for additional encoding
- Count labels below each group
- Deterministic pseudo-random jitter (based on token ID)
- Hover tooltip on individual points

#### 8.5.5 Configuration

| Property | Range | Default |
|----------|-------|---------|
| Group by | Any variable | Phoneme |
| Show quartiles | On/Off | On |
| Show mean marker | On/Off | Off |
| Show individual points | On/Off | Off |
| Max duration (Y-axis) | Slider | Auto |
| Colour by | Any variable | None |
| Texture by | Any variable | None |

---

### 8.6 Phoneme Distribution Plot (PhonemeDistributionPlot)

#### 8.6.1 Purpose

Visualise counts or proportions of phoneme categories as grouped or stacked bar charts, with optional faceted (small multiples) layout.

#### 8.6.2 Axes

| Axis | Data |
|------|------|
| X | Groups (phoneme or other variable) |
| Y | Count or Percentage |

#### 8.6.3 Display Modes

**Combined Mode**: All groups on a single X-axis
**Faceted Mode** (small multiples): Grid layout with √N columns, one subplot per group

**Bar Modes**:
- **Grouped**: Bars side-by-side for sub-categories
- **Stacked**: Bars stacked vertically

**Value Modes**:
- **Count**: Absolute numbers
- **Percentage**: Proportion within group (optionally normalised to 100%)

#### 8.6.4 Features

- Three levels of grouping: primary (groupBy), secondary (colorBy), tertiary (textureBy)
- Texture/pattern overlays for print-friendly distinction
- Configurable sort order for groups and bars (alphabetical or by count, ascending or descending)
- Count labels above bars

#### 8.6.5 Configuration

| Property | Options | Default |
|----------|---------|---------|
| Group by | Any variable | Phoneme |
| Colour by | Any variable | None |
| Texture by | Any variable | None |
| Bar mode | Grouped / Stacked | Grouped |
| Value mode | Count / Percentage | Count |
| Normalise | On/Off | Off |
| Separate plots | On/Off | Off |
| Group order | Alphabetical / By count | Alphabetical |
| Group direction | Ascending / Descending | Ascending |
| Bar order | Alphabetical / By count | Alphabetical |
| Bar direction | Ascending / Descending | Ascending |
| Primary variable | Colour / Texture | Colour |
| Max count (Y-axis) | Slider | Auto |

---

### 8.7 Data Table View

Inline table displaying filtered data with sortable columns:

| Column | Data |
|--------|------|
| Word | Token word |
| Phoneme | Canonical phoneme |
| Produced | Realised allophone |
| Duration (s) | Segment duration |
| F1 (Avg) | Average F1 across trajectory |
| F2 (Avg) | Average F2 across trajectory |
| F3 (Avg) | Average F3 across trajectory |

---

## 9. Export Functionality

### 9.1 Current Implementation

Export is PNG only, accessed via the Export button in the MainDisplay toolbar. Opens a comprehensive modal dialog.

### 9.2 Export Dialog Layout

Left panel: configuration controls. Right panel: live preview.

#### 9.2.1 Graph Geometry

| Control | Range | Default |
|---------|-------|---------|
| Graph Scale (linked) | 0.1–3.0× | 1.0× |
| Graph Scale X (unlinked) | 0.1–3.0× | 1.0× |
| Graph Scale Y (unlinked) | 0.1–3.0× | 1.0× |
| Graph X offset | Number | 0 |
| Graph Y offset | Number | 0 |
| Scale link toggle | Link/Unlink | Linked |

#### 9.2.2 Canvas Dimensions

| Control | Options | Default |
|---------|---------|---------|
| Auto/Fixed toggle | Auto / Fixed | Auto |
| Width (fixed mode) | Number input | 2400 px |
| Height (fixed mode) | Number input | 1600 px |

#### 9.2.3 Global Font Scale

Slider: 0.5–3.0× (step 0.1). Proportionally scales all text in the export.

#### 9.2.4 Chart Title

| Control | Options | Default |
|---------|---------|---------|
| Show title | On/Off | Off |
| Title text | Text input | "" |
| Title size | 24–500px slider + input | 36 |
| Title X/Y offset | Number inputs | 0, 0 |

#### 9.2.5 Axis Labels

| Control | Range | Default |
|---------|-------|---------|
| Axes link toggle | Link/Unlink | Linked |
| X axis label size | 12–500px | 36 |
| Y axis label size | 12–500px | 36 |
| X/Y axis label offsets | Number inputs | 0 |
| Tick number size | 10–500px | 24 |
| X/Y tick offsets | Number inputs | 0 |
| Data label size | 8–500px | 14 |

#### 9.2.6 Legend Configuration

| Control | Options | Default |
|---------|---------|---------|
| Legend visibility | Visible / Hidden | Visible |
| Position | Right, Bottom, Inside Top-Right, Inside Top-Left, Custom | Right |
| Custom X/Y coordinates | Number inputs | — |
| Heading size | 16–500px | 24 |
| Item size | 12–500px | 18 |

**Per-layer legend controls:**
- Checkbox to include each layer in the legend
- Editable heading titles per encoding channel (colour, shape, line type) per layer

#### 9.2.7 Resolution

| Preset | Scale Factor |
|--------|-------------|
| 1× | Standard |
| 2× | High-DPI |
| 3× | Print quality |
| 4× | Ultra-high |

### 9.3 Export Output

- Format: PNG with alpha channel
- Filename: `fred-export.png` (auto-downloaded)
- Includes: plot area, axes with labels/ticks, optional title, optional legend

### 9.4 Future: SVG Export

SVG export is planned but not yet implemented. Would enable:
- Full vector output for publication editing
- Smaller file sizes for simple plots
- Editability in Illustrator/Inkscape

---

## 10. AI Integration

### 10.1 Current Implementation

FRED integrates with the Google Gemini API (`gemini-3-flash-preview`) for automated acoustic phonetics insights.

### 10.2 Workflow

1. User clicks "AI Insights" button in the header
2. FRED samples the first 50 tokens from the dataset
3. Calculates mean F1/F2 from trajectory data per token
4. Sends summary to Gemini with a phonetic analysis prompt
5. Gemini returns a 3-paragraph academic summary covering:
   - Overall vowel space distribution
   - Stress-related patterns (e.g., centralisation)
   - Outlier detection recommendations
6. Result displayed in a floating panel below the header

### 10.3 Requirements

- Requires `API_KEY` environment variable with valid Google Gemini API key
- Graceful fallback: displays error message if API is unavailable

### 10.4 Future Considerations

- Statistical analysis integration (means, SDs, ANOVA results)
- Per-layer analysis comparison
- Exportable analysis reports

---

## 11. Non-Functional Requirements

### 11.1 Performance Targets

| Metric | Target | Implementation |
|--------|--------|----------------|
| File parse time (<50k rows) | <3 seconds | Custom CSV parser |
| Filter update response | <500ms | useMemo-based recalculation |
| Initial plot render | <2 seconds | Canvas 2D rendering |
| Zoom/pan frame rate | ≥30 FPS | Canvas transform (no re-render) |
| Export generation | <5 seconds | Canvas-to-blob pipeline |

### 11.2 Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

Currently runs as a Vite dev server. Target: standalone local app runnable on any OS via local browser (see Section 14).

### 11.3 Data Privacy

- All processing client-side (no data uploaded to server, except optional AI analysis)
- AI integration sends only aggregated summaries (first 50 tokens), not raw data
- No analytics or tracking of user data content

---

## 12. Error Handling

### 12.1 File Upload Errors

| Error Condition | Detection | User Message | Recovery |
|-----------------|-----------|--------------|----------|
| Invalid format | Parse failure | "Unable to parse file. Please ensure it's a valid CSV/TSV." | Allow retry |
| No formant columns | Missing f1_*/f2_* columns | Data loads but formant plots empty | Upload different file |
| Encoding issues | Non-UTF8 characters | Garbled text in category labels | Re-save as UTF-8 |

### 12.2 Data Validation

| Condition | Handling |
|-----------|----------|
| Missing F1/F2 at time-point | Token excluded from that time-point rendering |
| NaN formant values | Filtered out during trajectory/point rendering |
| Missing `type` field | Defaults to 'vowel' |
| Missing `canonical_type` | Defaults to 'vowel' |

### 12.3 Runtime Errors

| Condition | Handling |
|-----------|----------|
| AI API unavailable | Fallback error message in insights panel |
| Canvas rendering failure | Plot area blank (no crash) |
| Export at very high resolution | May be slow; no progress indicator currently |

---

## 13. Testing Criteria

### 13.1 Core Functionality Tests

| Test ID | Scenario | Expected Outcome |
|---------|----------|------------------|
| CORE-01 | App loads with no file | Synthetic data displayed, all tabs functional |
| CORE-02 | Upload valid CSV | Data replaces synthetic, filters reset |
| CORE-03 | Switch between all 7 tabs | Each plot renders correctly |
| CORE-04 | Change colour/shape encoding | Plot and legend update |
| CORE-05 | Apply filters in sidebar | Token count updates, plot reflects filtered data |
| CORE-06 | Export PNG at 2× | Download triggers, image contains plot + legend |

### 13.2 Multi-Layer Tests

| Test ID | Scenario | Expected Outcome |
|---------|----------|------------------|
| LAYER-01 | Add point layer | New layer appears, sidebar shows its config |
| LAYER-02 | Add trajectory layer | Trajectory controls appear in sidebar |
| LAYER-03 | Hide layer via eye icon | Layer disappears from plot, legend entry removed |
| LAYER-04 | Delete non-background layer | Layer removed, active switches if needed |
| LAYER-05 | Set different filters on two layers | Each layer shows different data subset |
| LAYER-06 | Change style override on layer 1 | Only layer 1 affected, layer 2 unchanged |
| LAYER-07 | Reorder layers | Draw order changes on canvas |
| LAYER-08 | Attempt to add 11th layer | Add button disabled |

### 13.3 Per-Layer Style Tests

| Test ID | Scenario | Expected Outcome |
|---------|----------|------------------|
| STYLE-01 | Click legend item on layer 1 | StyleEditor opens for that category |
| STYLE-02 | Change colour for "ae" on layer 1 | Only layer 1's "ae" changes colour |
| STYLE-03 | Change same category on layer 2 | Layer 2 has independent colour |
| STYLE-04 | Switch to non-F1/F2 tab, edit style | Active layer's overrides updated |
| STYLE-05 | Switch back to F1/F2 | Per-layer styles preserved |

### 13.4 Export Tests

| Test ID | Scenario | Expected Outcome |
|---------|----------|------------------|
| EXPORT-01 | Open export dialog | Live preview renders |
| EXPORT-02 | Adjust graph scale | Preview updates in real-time |
| EXPORT-03 | Toggle legend off | Legend absent from preview and export |
| EXPORT-04 | Set custom canvas size | Export matches specified dimensions |
| EXPORT-05 | Export at 4× resolution | High-resolution PNG downloaded |

### 13.5 Edge Case Tests

| Test ID | Edge Case | Expected Handling |
|---------|-----------|-------------------|
| EDGE-01 | Single data point | Plot renders, no ellipse |
| EDGE-02 | All points identical values | Single point rendered |
| EDGE-03 | 100+ unique phonemes | Legend scrollable, performance acceptable |
| EDGE-04 | Unicode/IPA in phoneme labels | Correctly displayed |
| EDGE-05 | Very long category names | Truncated in legend |
| EDGE-06 | Empty filter result (0 tokens) | Plot empty, count shows 0 |

---

## 14. Future Considerations

### 14.1 High Priority (v1.1)

#### 14.1.1 Flexible File Parsing & Data Mapping

The most significant gap in the current implementation. Users should be able to upload any CSV/TSV and map columns to FRED's data model without renaming columns. See Section 4.3 for the full planned design.

Key sub-features:
- Auto-detection of column types based on headers and sample data
- Visual mapping interface (drag-and-drop or dropdown assignment)
- Column ignore/include toggling
- User-friendly display labels for columns (e.g., `seg_dur` → "Phoneme Duration")
- Save/load mapping profiles in localStorage
- Profile auto-matching on subsequent uploads

#### 14.1.2 Standalone Desktop Application

Rebuild FRED as a packaged GUI application that:
- Runs in a local browser on any operating system (Windows, macOS, Linux)
- No internet connection required (except optional AI features)
- Simple install/launch process
- Potential technologies: Electron, Tauri, or simple local HTTP server

#### 14.1.3 UI/UX Redesign

The current interface has usability issues:
- Controls are cluttered and not always intuitive
- Configuration options could benefit from progressive disclosure
- Better visual hierarchy and grouping needed
- Mobile/responsive design improvements

### 14.2 Medium Priority (v1.2)

| Feature | Description |
|---------|-------------|
| SVG Export | Vector export for publication editing |
| Statistical Analysis Panel | Means, SDs, ANOVA results in a dedicated tab |
| Vowel Normalisation | Lobanov, Nearey, and other normalisation methods |
| Keyboard Shortcuts | Common operations accessible via keyboard |
| Undo/Redo | Revert configuration changes |

### 14.3 Low Priority (v2.0)

| Feature | Description |
|---------|-------------|
| Audio Playback | Click a point to hear the corresponding audio token |
| Real-time Praat/ELAN Integration | Direct connection to acoustic analysis tools |
| Multi-file Comparison | Load and compare multiple CSV files |
| User Accounts & Cloud Storage | Save projects, share configurations |
| Collaborative Annotation | Multi-user annotation of vowel spaces |
| Custom Plot Type Builder | User-defined visualisation templates |

### 14.4 Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| Web Worker for large datasets | High | Currently all computation on main thread |
| IndexedDB for file caching | Low | Would speed repeat loads |
| Accessibility (ARIA labels, keyboard nav) | Medium | Currently minimal |
| Automated test suite | Medium | No tests currently exist |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Allophone | A phonetic realisation of a phoneme |
| Centroid | The mean position of a group of points |
| Diphthong | A vowel with a changing quality (glide between two targets) |
| F1, F2, F3 | First, second, third formant frequencies |
| Formant | A resonant frequency of the vocal tract |
| FRED | Formant Research for EDucation |
| Layer | An independent visual overlay with its own config, filters, and style |
| Monophthong | A vowel with a stable quality |
| Phoneme | An abstract unit of sound in a language |
| SAMPA | Speech Assessment Methods Phonetic Alphabet (ASCII-compatible) |
| Style Override | Per-layer customisation of colour, shape, texture, or line type for a category |
| Token | A single instance/observation in the dataset |
| Trajectory | The path of formant values through time during a vowel |

---

## Appendix B: Sample Data Format

Example of the expected input file structure:

```csv
file_id,word,syllable,syllable_mark,canonical_stress,lexical_stress,canonical,produced,alignment,type,canonical_type,voice_pitch,xmin,duration,f1_00,f1_10,f1_20,f1_30,f1_40,f1_50,f1_60,f1_70,f1_80,f1_90,f1_100,f2_00,f2_10,f2_20,f2_30,f2_40,f2_50,f2_60,f2_70,f2_80,f2_90,f2_100,f3_00,f3_10,f3_20,f3_30,f3_40,f3_50,f3_60,f3_70,f3_80,f3_90,f3_100
spk_001,kōrero,kō,2,1,1,o:,o:,exact,vowel,monophthong,mid,0.234,0.078,423,425,428,430,431,431,430,429,427,425,423,812,815,821,828,832,834,838,842,847,851,854,2400,2410,2420,2430,2435,2440,2438,2432,2425,2418,2410
```

---

## Appendix C: Key Type Definitions

### SpeechToken (primary data unit)

```typescript
interface SpeechToken {
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
  trajectory: TrajectoryPoint[];
}
```

### TrajectoryPoint

```typescript
interface TrajectoryPoint {
  time: number;          // 0, 10, 20, ... 100
  f1: number;            // Raw F1 (Hz)
  f2: number;            // Raw F2 (Hz)
  f3: number;            // Raw F3 (Hz)
  f1_smooth: number;     // Smoothed F1
  f2_smooth: number;     // Smoothed F2
  f3_smooth: number;     // Smoothed F3
}
```

### PlotConfig (66 properties)

Controls all visualisation settings per layer. Key property groups:
- **Coordinate system**: `f1Range`, `f2Range`, `f3Range`, `invertX`, `invertY`
- **Visual encoding**: `colorBy`, `shapeBy`, `lineTypeBy`, `textureBy`
- **Plot mode**: `plotType`, `timePoint`, `bwMode`, `useSmoothing`
- **Trajectory**: `showIndividualLines`, `showMeanTrajectories`, `showArrows`, `trajectoryOnset/Offset`, `meanTrajectoryWidth/Opacity`
- **Points**: `showPoints`, `pointSize`, `pointOpacity`
- **Ellipses**: `showEllipses`, `ellipseSD`, `ellipseLineWidth/Opacity`, `ellipseFillOpacity`
- **Centroids**: `showCentroids`, `centroidSize`, `labelAsCentroid`, `labelSize`, `meanLabelType`
- **Reference vowels**: `showReferenceVowels`, `selectedReferenceVowels`, `referencePitchFilter`, `refVowelLabelOpacity/Size`, `refVowelEllipseLineOpacity/FillOpacity`
- **Duration**: `showQuartiles`, `showMeanMarker`, `showDurationPoints`, `durationRange`
- **Distribution**: `distGroupOrder/Dir`, `distBarOrder/Dir`, `distBarMode`, `distValueMode`, `distNormalize`, `distPrimaryVar`, `separatePlots`, `countRange`

---

## Appendix D: Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2025-01-28 | Zoe | Initial draft (as "Speech Visualisation Suite") |
| 0.2.0 | 2025-01-29 | Zoe + Claude | Restructured; added data mapping, error handling, testing |
| 1.0.0 | 2026-03-05 | Zoe + Claude | Major rewrite: renamed to FRED; documented all implemented features (multi-layer system, 6 plot types, per-layer style overrides, trajectory arrows, reference vowels, export dialog, AI integration); updated data format to reflect actual CSV parser; removed completed nice-to-haves; reorganised future considerations by priority |

---

*End of Specification*
