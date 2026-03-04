
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import MainDisplay from './components/MainDisplay';
import Header from './components/Header';
import { generateSpeechData } from './services/dataGenerator';
import { parseSpeechCSV, isMonophthong } from './services/csvParser';
import { SpeechToken, PlotConfig, FilterState, ReferenceCentroid } from './types';

const INITIAL_CONFIG: PlotConfig = {
  invertX: true,
  invertY: true,
  colorBy: 'phoneme',
  shapeBy: 'none',
  lineTypeBy: 'none',
  textureBy: 'none',
  bwMode: false,
  timePoint: 50,
  
  // Data Source
  useSmoothing: false,

  // New categorical defaults
  groupBy: 'phoneme',
  
  // Base Plot Mode
  plotType: 'point',
  trajectoryOnset: 0,
  trajectoryOffset: 100,
  
  timeNormalized: true,
  showMeanTrajectories: true,
  showIndividualLines: true,
  trajectoryLineOpacity: 0.1, // Default low for dense data
  showTrajectoryLabels: false,
  meanTrajectoryLabelSize: 12, // Default size
  meanTrajectoryWidth: 3, // Default width
  meanTrajectoryOpacity: 1.0, // Default opacity
  showArrows: true,
  legendSource: 'background',
  showReferenceVowels: false,
  selectedReferenceVowels: [],
  referencePitchFilter: [], // Empty means all
  
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
  ellipseLineOpacity: 0.8,
  ellipseFillOpacity: 0.1,
  
  f1Range: [200, 1200],
  f2Range: [500, 3200],
  f3Range: [2000, 4000], // New range
  timeSeriesFrequencyRange: [0, 4000],
  durationRange: [0, 0], // Auto
  countRange: [0, 0] // Auto
};

const INITIAL_FILTERS: FilterState = {
  mainType: 'all', // Changed from 'vowel' to 'all' to prevent hiding data by default
  vowelCategory: 'all',
  phonemes: [],
  alignments: [],
  produced: [],
  words: [],
  canonicalStress: [],
  lexicalStress: [],
  syllableMark: [],
  voicePitch: [],
};

const App: React.FC = () => {
  const [data, setData] = useState<SpeechToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<PlotConfig>(INITIAL_CONFIG);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  
  // Overlay State
  const [trajectoryConfig, setTrajectoryConfig] = useState<PlotConfig>({
    ...INITIAL_CONFIG,
    plotType: 'trajectory',
    showPoints: false,
    showEllipses: false,
    showCentroids: false,
    showIndividualLines: true,
    trajectoryLineOpacity: 0.2,
    showArrows: true,
    colorBy: 'phoneme',
  });
  const [trajectoryFilters, setTrajectoryFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [activeLayer, setActiveLayer] = useState<'background' | 'overlay'>('background');

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const tokens = generateSpeechData(5000);
      setData(tokens);
      setIsLoading(false);
    };
    loadData();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseSpeechCSV(text);
      setData(parsed);
      setIsLoading(false);
      setFilters(INITIAL_FILTERS);
    };
    reader.readAsText(file);
  };

  const filterData = useCallback((sourceData: SpeechToken[], currentFilters: FilterState) => {
    return sourceData.filter(token => {
      // 1. Vowel/Consonant Type
      if (currentFilters.mainType !== 'all') {
        if (!token.canonical_type || token.canonical_type.toLowerCase() !== currentFilters.mainType) return false;
      }

      // 2. Vowel Category
      if (currentFilters.mainType === 'vowel' && currentFilters.vowelCategory !== 'all') {
        const isMono = isMonophthong(token.canonical);
        if (currentFilters.vowelCategory === 'monophthong' && !isMono) return false;
        if (currentFilters.vowelCategory === 'diphthong' && isMono) return false;
      }

      // 3. Phoneme Selection (Canonical)
      if (currentFilters.phonemes.length > 0 && !currentFilters.phonemes.includes(token.canonical)) return false;

      // 4. Alignment
      if (currentFilters.alignments.length > 0 && !currentFilters.alignments.includes(token.alignment)) return false;

      // 5. Allophones (Produced)
      if (currentFilters.produced.length > 0 && !currentFilters.produced.includes(token.produced)) return false;

      // 6. Word Selection
      if (currentFilters.words.length > 0 && !currentFilters.words.includes(token.word)) return false;

      // 7. Stress & Marks
      if (currentFilters.canonicalStress.length > 0 && !currentFilters.canonicalStress.includes(token.canonical_stress)) return false;
      if (currentFilters.lexicalStress.length > 0 && !currentFilters.lexicalStress.includes(token.lexical_stress)) return false;
      if (currentFilters.syllableMark.length > 0 && !currentFilters.syllableMark.includes(token.syllable_mark)) return false;

      // 8. Voice Pitch
      if (currentFilters.voicePitch.length > 0 && !currentFilters.voicePitch.includes(token.voice_pitch)) return false;

      return true;
    });
  }, []);

  const filteredData = useMemo(() => filterData(data, filters), [data, filters, filterData]);
  const overlayData = useMemo(() => filterData(data, trajectoryFilters), [data, trajectoryFilters, filterData]);

  // Calculate Global Reference Centroids (for Ref Vowels)
  const globalReferences = useMemo(() => {
    // Only use 'exact' alignments for reference vowels to ensure they represent the canonical target
    // Respect the Pitch Filter for References
    // Robust check for referencePitchFilter in case of stale state
    const pitchFilter = config.referencePitchFilter || []; 
    
    const monophthongs = data.filter(t => 
      t.type === 'vowel' && 
      isMonophthong(t.canonical) && 
      t.alignment === 'exact' &&
      (pitchFilter.length === 0 || pitchFilter.includes(t.voice_pitch))
    );
    
    const groups: Record<string, SpeechToken[]> = {};
    monophthongs.forEach(t => {
      if (!groups[t.canonical]) groups[t.canonical] = [];
      groups[t.canonical].push(t);
    });

    const refs: ReferenceCentroid[] = [];
    Object.entries(groups).forEach(([key, tokens]) => {
      if (tokens.length < 5) return;
      // Calculate based on 50% point
      // Fallback for f1_smooth/f2_smooth in case data is stale
      const pts = tokens.map(t => t.trajectory.find(p => p.time === 50)).filter(Boolean).map(p => ({
        f1: config.useSmoothing ? (p!.f1_smooth ?? p!.f1) : p!.f1,
        f2: config.useSmoothing ? (p!.f2_smooth ?? p!.f2) : p!.f2
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
        canonical: key,
        f1: meanF1,
        f2: meanF2,
        sdX: Math.sqrt(l1),
        sdY: Math.sqrt(l2),
        angle
      });
    });
    return refs.sort((a,b) => a.canonical.localeCompare(b.canonical));
  }, [data, config.useSmoothing, config.referencePitchFilter]); 

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden text-slate-900">
      <Sidebar 
        config={activeLayer === 'background' ? config : trajectoryConfig} 
        setConfig={activeLayer === 'background' ? setConfig : setTrajectoryConfig} 
        filters={activeLayer === 'background' ? filters : trajectoryFilters}
        setFilters={activeLayer === 'background' ? setFilters : setTrajectoryFilters}
        data={data}
        tokenCount={activeLayer === 'background' ? filteredData.length : overlayData.length}
        totalCount={data.length}
        handleFileUpload={handleFileUpload}
        activeLayer={activeLayer}
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        <Header 
          tokenCount={activeLayer === 'background' ? filteredData.length : overlayData.length} 
          isLoading={isLoading} 
          data={activeLayer === 'background' ? filteredData : overlayData}
        />
        
        <main className="flex-1 p-4 overflow-hidden">
          {isLoading ? (
            <div className="h-full w-full flex flex-col items-center justify-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              <p className="text-slate-500 font-medium">Processing Acoustic Tokens...</p>
            </div>
          ) : (
            <MainDisplay 
              data={filteredData} 
              config={config} 
              setConfig={setConfig} 
              overlayData={overlayData}
              overlayConfig={trajectoryConfig}
              setOverlayConfig={setTrajectoryConfig}
              activeLayer={activeLayer}
              setActiveLayer={setActiveLayer}
              globalReferences={globalReferences}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
