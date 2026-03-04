
import React, { useMemo, useState } from 'react';
import { Filter, Layers, Database, Upload, Search } from 'lucide-react';
import { PlotConfig, FilterState, SpeechToken } from '../types';
import { isMonophthong } from '../services/csvParser';

interface SidebarProps {
  config: PlotConfig;
  setConfig: React.Dispatch<React.SetStateAction<PlotConfig>>;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  data: SpeechToken[];
  tokenCount: number;
  totalCount: number;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeLayer?: 'background' | 'overlay';
}

const Sidebar: React.FC<SidebarProps> = ({ 
  filters, setFilters, data, tokenCount, totalCount, handleFileUpload, activeLayer
}) => {
  const [wordSearch, setWordSearch] = useState('');
  const updateFilters = (update: Partial<FilterState>) => setFilters(prev => ({ ...prev, ...update }));

  // Dynamic Options based on current filter state
  const phonemeOptions = useMemo(() => {
    let baseSet = data;
    if (filters.mainType !== 'all') {
      baseSet = baseSet.filter(t => t.canonical_type.toLowerCase() === filters.mainType);
    }
    if (filters.mainType === 'vowel' && filters.vowelCategory !== 'all') {
      baseSet = baseSet.filter(t => {
        const mono = isMonophthong(t.canonical);
        return filters.vowelCategory === 'monophthong' ? mono : !mono;
      });
    }
    return Array.from(new Set(baseSet.map(t => t.canonical))).sort();
  }, [data, filters.mainType, filters.vowelCategory]);

  const alignmentOptions = ['exact', 'substitution', 'insertion', 'deletion'];

  const producedOptions = useMemo(() => {
    let baseSet = data;
    if (filters.phonemes.length > 0) {
      baseSet = baseSet.filter(t => filters.phonemes.includes(t.canonical));
    }
    return Array.from(new Set(baseSet.map(t => t.produced))).sort();
  }, [data, filters.phonemes]);

  const wordOptions = useMemo(() => {
    let baseSet = data;
    // Apply higher level filters to restrict word list to relevant subset
    if (filters.mainType !== 'all') {
      baseSet = baseSet.filter(t => t.canonical_type.toLowerCase() === filters.mainType);
    }
    if (filters.mainType === 'vowel' && filters.vowelCategory !== 'all') {
      baseSet = baseSet.filter(t => {
        const mono = isMonophthong(t.canonical);
        return filters.vowelCategory === 'monophthong' ? mono : !mono;
      });
    }
    if (filters.phonemes.length > 0) {
      baseSet = baseSet.filter(t => filters.phonemes.includes(t.canonical));
    }
    
    return Array.from(new Set(baseSet.map(t => t.word))).sort();
  }, [data, filters.mainType, filters.vowelCategory, filters.phonemes]);

  const syllableMarkOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.syllable_mark))).sort();
  }, [data]);

  const voicePitchOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.voice_pitch))).filter(Boolean).sort();
  }, [data]);

  const toggleListFilter = (key: keyof FilterState, val: string) => {
    const current = filters[key] as string[];
    updateFilters({ [key]: current.includes(val) ? current.filter(v => v !== val) : [...current, val] });
  };

  const filteredWordOptions = useMemo(() => {
      if (!wordSearch) return wordOptions;
      return wordOptions.filter(w => w.toLowerCase().includes(wordSearch.toLowerCase()));
  }, [wordOptions, wordSearch]);

  return (
    <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
      {activeLayer === 'overlay' && (
        <div className="bg-indigo-50 border-b border-indigo-100 p-2 text-center sticky top-0 z-10">
            <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Editing Overlay Filters</span>
        </div>
      )}
      <div className="p-5 space-y-6">
        
        {/* Global Dataset Controls */}
        <section>
           <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <Database size={14} className="mr-2" /> Dataset info
          </h2>
          <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors mb-3">
            <div className="flex items-center space-x-2">
              <Upload size={14} className="text-slate-400" />
              <p className="text-[11px] text-slate-500 font-medium">Load CSV</p>
            </div>
            <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
          </label>
          <div className="text-[10px] text-slate-500 font-bold uppercase flex justify-between items-center">
            <span>Tokens: {tokenCount.toLocaleString()} / {totalCount.toLocaleString()}</span>
            <span className="text-indigo-600">{Math.round((tokenCount / totalCount) * 100 || 0)}%</span>
          </div>
        </section>

        {/* Hierarchical Filtering */}
        <section className="pt-2 border-t border-slate-100">
          <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <Filter size={14} className="mr-2" /> Hierarchical Selection
          </h2>
          
          <div className="space-y-4">
             {/* 1. Main Type */}
             <div>
               <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">1. Type</label>
               <select 
                className="w-full text-xs p-2 border border-slate-200 rounded"
                value={filters.mainType}
                onChange={e => updateFilters({ mainType: e.target.value as any, phonemes: [], produced: [], words: [] })}
               >
                 <option value="all">All Types</option>
                 <option value="vowel">Vowels</option>
                 <option value="consonant">Consonants</option>
               </select>
             </div>

             {/* 2. Vowel Category */}
             {filters.mainType === 'vowel' && (
               <div>
                 <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">2. Category</label>
                 <div className="flex bg-slate-50 p-1 rounded">
                   {['all', 'monophthong', 'diphthong'].map(cat => (
                     <button
                      key={cat}
                      onClick={() => updateFilters({ vowelCategory: cat as any, phonemes: [], produced: [], words: [] })}
                      className={`flex-1 py-1 text-[10px] capitalize rounded ${filters.vowelCategory === cat ? 'bg-white shadow-sm font-bold text-indigo-600' : 'text-slate-500'}`}
                     >
                       {cat}
                     </button>
                   ))}
                 </div>
               </div>
             )}

             {/* 3. Phonemes */}
             <div>
               <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between">
                 <span>3. Phonemes</span>
                 <button onClick={() => updateFilters({ phonemes: [] })} className="text-indigo-600 hover:underline">Clear</button>
               </label>
               <div className="max-h-24 overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1">
                 {phonemeOptions.map(ph => (
                   <button
                    key={ph}
                    onClick={() => toggleListFilter('phonemes', ph)}
                    className={`px-2 py-0.5 rounded text-[11px] border ${filters.phonemes.includes(ph) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                   >
                     {ph}
                   </button>
                 ))}
               </div>
             </div>
             
             {/* 4. Words (With Search) */}
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between">
                   <span>4. Words ({filteredWordOptions.length})</span>
                   <button onClick={() => updateFilters({ words: [] })} className="text-indigo-600 hover:underline">Clear</button>
                </label>
                
                <div className="relative mb-1.5">
                    <input 
                      type="text" 
                      placeholder="Search words..."
                      className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
                      value={wordSearch}
                      onChange={e => setWordSearch(e.target.value)}
                    />
                    <Search size={10} className="absolute left-2 top-2 text-slate-400" />
                </div>

                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1">
                 {filteredWordOptions.length > 0 ? (
                    filteredWordOptions.slice(0, 100).map(word => (
                        <button
                            key={word}
                            onClick={() => toggleListFilter('words', word)}
                            className={`px-2 py-0.5 rounded text-[11px] border ${filters.words.includes(word) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                        >
                            {word}
                        </button>
                    ))
                 ) : (
                    <span className="text-[10px] text-slate-400 p-1">No words match</span>
                 )}
                 {filteredWordOptions.length > 100 && (
                     <div className="w-full text-center text-[9px] text-slate-400 pt-1 italic">
                        + {filteredWordOptions.length - 100} more (search to find)
                     </div>
                 )}
               </div>
             </div>

             {/* 5. Alignments (Deselected by default) */}
             <div>
               <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">5. Alignments</label>
               <div className="flex flex-wrap gap-1.5">
                 {alignmentOptions.map(a => (
                   <button
                    key={a}
                    onClick={() => toggleListFilter('alignments', a)}
                    className={`px-2 py-0.5 rounded text-[11px] border ${filters.alignments.includes(a) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                   >
                     {a}
                   </button>
                 ))}
               </div>
             </div>

             {/* 6. Allophones (Produced) */}
             <div>
               <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between">
                 <span>6. Allophones (Produced)</span>
                 <button onClick={() => updateFilters({ produced: [] })} className="text-indigo-600 hover:underline">Clear</button>
               </label>
               <div className="max-h-24 overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1">
                 {producedOptions.map(pr => (
                   <button
                    key={pr}
                    onClick={() => toggleListFilter('produced', pr)}
                    className={`px-2 py-0.5 rounded text-[11px] border ${filters.produced.includes(pr) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                   >
                     {pr}
                   </button>
                 ))}
               </div>
             </div>
          </div>
        </section>

        {/* Additional Filters */}
        <section className="pt-2 border-t border-slate-100">
          <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <Layers size={14} className="mr-2" /> Contrast variables
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Expected Stress</label>
              <div className="flex gap-1.5">
                {['0', '1'].map(v => (
                  <button key={v} onClick={() => toggleListFilter('canonicalStress', v)} 
                    className={`flex-1 py-1 rounded text-[11px] border ${filters.canonicalStress.includes(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-500'}`}>
                    {v === '1' ? 'Stressed' : 'Unstressed'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Transcribed Stress</label>
              <div className="flex gap-1">
                {['0', '1', '2'].map(v => (
                  <button key={v} onClick={() => toggleListFilter('lexicalStress', v)} 
                    className={`flex-1 py-1 rounded text-[11px] border ${filters.lexicalStress.includes(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-500'}`}>
                    {v === '0' ? 'Un' : v === '1' ? 'Prim' : 'Sec'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                <span>Syllable Mark</span>
                <button onClick={() => updateFilters({ syllableMark: [] })} className="text-indigo-600 hover:underline">Clear</button>
              </label>
              <div className="flex flex-wrap gap-1">
                {syllableMarkOptions.map(v => (
                  <button key={v} onClick={() => toggleListFilter('syllableMark', v)} 
                    className={`min-w-[30px] px-2 py-1 rounded text-[11px] border ${filters.syllableMark.includes(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-500'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                <span>Voice Pitch</span>
                <button onClick={() => updateFilters({ voicePitch: [] })} className="text-indigo-600 hover:underline">Clear</button>
              </label>
              <div className="flex flex-wrap gap-1">
                {voicePitchOptions.map(v => (
                  <button key={v} onClick={() => toggleListFilter('voicePitch', v)} 
                    className={`px-2 py-1 rounded text-[11px] border ${filters.voicePitch.includes(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-500'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};

export default Sidebar;
