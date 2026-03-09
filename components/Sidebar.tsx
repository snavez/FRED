
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Filter, Database, Upload, Search, Settings2 } from 'lucide-react';
import { PlotConfig, FilterState, SpeechToken, DatasetMeta, ColumnRole } from '../types';
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
  activeLayerName?: string;
  datasetMeta?: DatasetMeta | null;
  onToggleFieldVisibility?: (key: string, visible: boolean) => void;
}

/** Built-in filter fields and the column roles that enable them */
const BUILTIN_FILTER_FIELDS: { key: string, label: string, roles: ColumnRole[] }[] = [
  { key: 'file_id', label: 'File / Speaker', roles: ['file_id'] },
  { key: 'type', label: 'Type', roles: ['type', 'canonical_type'] },
  { key: 'vowelCategory', label: 'Vowel Category', roles: ['type', 'canonical_type'] },
  { key: 'canonical', label: 'Phonemes', roles: ['canonical'] },
  { key: 'word', label: 'Words', roles: ['word'] },
  { key: 'alignment', label: 'Alignments', roles: ['alignment'] },
  { key: 'produced', label: 'Allophones', roles: ['produced'] },
  { key: 'canonical_stress', label: 'Expected Stress', roles: ['canonical_stress'] },
  { key: 'lexical_stress', label: 'Transcribed Stress', roles: ['lexical_stress'] },
  { key: 'syllable_mark', label: 'Syllable Mark', roles: ['syllable_mark'] },
  { key: 'voice_pitch', label: 'Voice Pitch', roles: ['voice_pitch'] },
];

const Sidebar: React.FC<SidebarProps> = ({
  filters, setFilters, data, tokenCount, totalCount, handleFileUpload, activeLayerName, datasetMeta, onToggleFieldVisibility
}) => {
  const [wordSearch, setWordSearch] = useState('');
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const fieldSettingsRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showFieldSettings) return;
    const handleClick = (e: MouseEvent) => {
      if (fieldSettingsRef.current && !fieldSettingsRef.current.contains(e.target as Node)) {
        setShowFieldSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFieldSettings]);

  const updateFilters = (update: Partial<FilterState>) => setFilters(prev => ({ ...prev, ...update }));

  // --- Field visibility helpers ---
  const isFieldVisible = (key: string): boolean => {
    if (!datasetMeta) return false;
    const field = BUILTIN_FILTER_FIELDS.find(f => f.key === key);
    if (field) {
      return field.roles.some(r => {
        const mapping = datasetMeta.columnMappings.find(m => m.role === r);
        return mapping ? mapping.showInSidebar !== false : false;
      });
    }
    const mapping = datasetMeta.columnMappings.find(m => m.role === 'custom' && m.customFieldName === key);
    return mapping ? mapping.showInSidebar !== false : false;
  };

  // Visibility flags
  const showFileId = isFieldVisible('file_id');
  const showType = isFieldVisible('type');
  const showVowelCat = isFieldVisible('vowelCategory');
  const showPhonemes = isFieldVisible('canonical');
  const showWords = isFieldVisible('word');
  const showAlignments = isFieldVisible('alignment');
  const showProduced = isFieldVisible('produced');
  const showCanStress = isFieldVisible('canonical_stress');
  const showLexStress = isFieldVisible('lexical_stress');
  const showSylMark = isFieldVisible('syllable_mark');
  const showVoicePitch = isFieldVisible('voice_pitch');

  // --- Popover entries: all fields available in the dataset ---
  const popoverEntries = useMemo(() => {
    if (!datasetMeta) return [];
    const entries: { key: string, label: string, visible: boolean, section: 'builtin' | 'custom' }[] = [];

    BUILTIN_FILTER_FIELDS.forEach(f => {
      if (f.roles.some(r => datasetMeta.columnMappings.some(m => m.role === r))) {
        entries.push({
          key: f.key,
          label: f.label,
          section: 'builtin',
          visible: f.roles.some(r => {
            const mapping = datasetMeta.columnMappings.find(m => m.role === r);
            return mapping ? mapping.showInSidebar !== false : false;
          })
        });
      }
    });

    datasetMeta.customColumns.forEach(col => {
      const mapping = datasetMeta.columnMappings.find(m => m.role === 'custom' && m.customFieldName === col);
      entries.push({
        key: col,
        label: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        section: 'custom',
        visible: mapping ? mapping.showInSidebar !== false : true
      });
    });

    return entries;
  }, [datasetMeta]);

  const toggleFieldInPopover = (entry: { key: string, visible: boolean }) => {
    if (!datasetMeta) return;
    const field = BUILTIN_FILTER_FIELDS.find(f => f.key === entry.key);
    if (field) {
      field.roles.forEach(r => {
        if (datasetMeta.columnMappings.some(m => m.role === r)) {
          onToggleFieldVisibility?.(r, !entry.visible);
        }
      });
    } else {
      onToggleFieldVisibility?.(entry.key, !entry.visible);
    }
  };

  // --- Dynamic filter options (narrowed by higher-level selections) ---

  // Type options: always from full data
  const typeOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.canonical_type?.toLowerCase()).filter(Boolean))).sort();
  }, [data]);

  // Pre-filter data by selected types (used to narrow downstream options)
  const typeFilteredData = useMemo(() => {
    if (filters.types.length === 0 || filters.types.length >= typeOptions.length) return data;
    const typeSet = new Set(filters.types);
    return data.filter(t => typeSet.has(t.canonical_type?.toLowerCase()));
  }, [data, filters.types, typeOptions.length]);

  // Vowel category options: narrowed by type selection
  const vowelCategoryOptions = useMemo(() => {
    const cats: string[] = [];
    const vowels = typeFilteredData.filter(t => t.canonical_type?.toLowerCase() === 'vowel');
    if (vowels.some(t => isMonophthong(t.canonical))) cats.push('monophthong');
    if (vowels.some(t => !isMonophthong(t.canonical))) cats.push('diphthong');
    return cats;
  }, [typeFilteredData]);

  // Further filter by vowel category (for phonemes/words/produced)
  const categoryFilteredData = useMemo(() => {
    if (filters.vowelCategories.length === 0 || filters.vowelCategories.length >= vowelCategoryOptions.length) return typeFilteredData;
    const catSet = new Set(filters.vowelCategories);
    return typeFilteredData.filter(t => {
      if (t.canonical_type?.toLowerCase() !== 'vowel') return true; // non-vowels unaffected
      const cat = isMonophthong(t.canonical) ? 'monophthong' : 'diphthong';
      return catSet.has(cat);
    });
  }, [typeFilteredData, filters.vowelCategories, vowelCategoryOptions.length]);

  // Phoneme options: narrowed by type + category
  const phonemeOptions = useMemo(() => {
    return Array.from(new Set(categoryFilteredData.map(t => t.canonical).filter(Boolean))).sort();
  }, [categoryFilteredData]);

  // Further filter by phonemes (for words/produced)
  const phonemeFilteredData = useMemo(() => {
    if (filters.phonemes.length === 0 || filters.phonemes.length >= phonemeOptions.length) return categoryFilteredData;
    const phonemeSet = new Set(filters.phonemes);
    return categoryFilteredData.filter(t => phonemeSet.has(t.canonical));
  }, [categoryFilteredData, filters.phonemes, phonemeOptions.length]);

  // Word options: narrowed by type + category + phonemes
  const wordOptions = useMemo(() => {
    return Array.from(new Set(phonemeFilteredData.map(t => t.word).filter(Boolean))).sort();
  }, [phonemeFilteredData]);

  // Produced options: narrowed by type + category + phonemes
  const producedOptions = useMemo(() => {
    return Array.from(new Set(phonemeFilteredData.map(t => t.produced).filter(Boolean))).sort();
  }, [phonemeFilteredData]);

  // Independent options (from full data)
  const fileIdOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.file_id).filter(Boolean))).sort();
  }, [data]);

  const alignmentOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.alignment).filter(Boolean))).sort();
  }, [data]);

  const syllableMarkOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.syllable_mark).filter(Boolean))).sort();
  }, [data]);

  const voicePitchOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.voice_pitch).filter(Boolean))).sort();
  }, [data]);

  const canonicalStressOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.canonical_stress).filter(Boolean))).sort();
  }, [data]);

  const lexicalStressOptions = useMemo(() => {
    return Array.from(new Set(data.map(t => t.lexical_stress).filter(Boolean))).sort();
  }, [data]);

  const toggleListFilter = (key: keyof FilterState, val: string) => {
    const current = filters[key] as string[];
    updateFilters({ [key]: current.includes(val) ? current.filter(v => v !== val) : [...current, val] });
  };

  const filteredWordOptions = useMemo(() => {
      if (!wordSearch) return wordOptions;
      return wordOptions.filter(w => w.toLowerCase().includes(wordSearch.toLowerCase()));
  }, [wordOptions, wordSearch]);

  // Custom field visibility
  const visibleCustomColumns = useMemo(() => {
    if (!datasetMeta) return [];
    return datasetMeta.customColumns.filter(col => {
      const mapping = datasetMeta.columnMappings.find(m => m.role === 'custom' && m.customFieldName === col);
      return mapping ? mapping.showInSidebar !== false : true;
    });
  }, [datasetMeta]);

  const hasData = data.length > 0;
  const hasAnyFilters = showFileId || showType || showVowelCat || showPhonemes || showWords || showAlignments || showProduced || showCanStress || showLexStress || showSylMark || showVoicePitch || visibleCustomColumns.length > 0;

  /** Reusable button-toggle filter section */
  const renderFilterSection = (
    label: string,
    options: string[],
    selected: string[],
    filterKey: keyof FilterState,
    displayFn?: (v: string) => string,
    maxHeight?: string
  ) => {
    const allSelected = options.length > 0 && options.every(o => selected.includes(o));
    return (
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between items-center">
          <span>{label}</span>
          <span className="flex gap-2">
            <button onClick={() => updateFilters({ [filterKey]: options })} className={`hover:underline ${allSelected ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>All</button>
            <button onClick={() => updateFilters({ [filterKey]: [] })} className={`hover:underline ${selected.length === 0 ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>Clear</button>
          </span>
        </label>
        <div className={`overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1 ${maxHeight || 'max-h-24'}`}>
          {options.map(v => (
            <button
              key={v}
              onClick={() => toggleListFilter(filterKey, v)}
              className={`px-2 py-0.5 rounded text-[11px] border ${selected.includes(v) ? 'bg-slate-600 text-white border-slate-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
            >
              {displayFn ? displayFn(v) : v}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
      {activeLayerName && (
        <div className="bg-sky-50 border-b border-sky-100 p-2 text-center sticky top-0 z-10">
            <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider">Editing: {activeLayerName}</span>
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
              <p className="text-[11px] text-slate-500 font-medium">Load CSV / TSV</p>
            </div>
            <input type="file" className="hidden" accept=".csv,.tsv,.txt" onChange={handleFileUpload} />
          </label>
          {hasData && (
            <div className="text-[10px] text-slate-500 font-bold uppercase flex justify-between items-center">
              <span>Tokens: {tokenCount.toLocaleString()} / {totalCount.toLocaleString()}</span>
              <span className="text-sky-700">{Math.round((tokenCount / totalCount) * 100 || 0)}%</span>
            </div>
          )}
        </section>

        {/* --- ALL FILTER SECTIONS: only shown when data is loaded --- */}
        {hasData && hasAnyFilters && (
          <section className="pt-2 border-t border-slate-100">
            {/* Filters header with unified gear icon */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Filter size={14} className="mr-2" /> Filters
              </h2>
              {popoverEntries.length > 0 && (
                <div className="relative" ref={fieldSettingsRef}>
                  <button
                    onClick={() => setShowFieldSettings(!showFieldSettings)}
                    className={`p-1 rounded transition-colors ${showFieldSettings ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    title="Configure visible filters"
                  >
                    <Settings2 size={14} />
                  </button>
                  {showFieldSettings && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 w-56 py-2 max-h-80 overflow-y-auto">
                      <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100 mb-1">Show in sidebar</div>
                      {popoverEntries.some(e => e.section === 'builtin') && (
                        <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-bold text-slate-400 uppercase">Filters</div>
                      )}
                      {popoverEntries.filter(e => e.section === 'builtin').map(entry => (
                        <label key={entry.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={entry.visible}
                            onChange={() => toggleFieldInPopover(entry)}
                            className="rounded text-sky-700"
                          />
                          <span className="text-xs text-slate-700">{entry.label}</span>
                        </label>
                      ))}
                      {popoverEntries.some(e => e.section === 'custom') && (
                        <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold text-slate-400 uppercase border-t border-slate-100 mt-1">Custom</div>
                      )}
                      {popoverEntries.filter(e => e.section === 'custom').map(entry => (
                        <label key={entry.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={entry.visible}
                            onChange={() => toggleFieldInPopover(entry)}
                            className="rounded text-sky-700"
                          />
                          <span className="text-xs text-slate-700">{entry.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {/* File / Speaker */}
              {showFileId && renderFilterSection('File / Speaker', fileIdOptions, filters.fileIds, 'fileIds')}

              {/* Type */}
              {showType && renderFilterSection('Type', typeOptions, filters.types, 'types')}

              {/* Vowel Category */}
              {showVowelCat && vowelCategoryOptions.length > 0 && renderFilterSection(
                'Vowel Category', vowelCategoryOptions, filters.vowelCategories, 'vowelCategories',
                v => v.charAt(0).toUpperCase() + v.slice(1)
              )}

              {/* Phonemes */}
              {showPhonemes && renderFilterSection('Phonemes', phonemeOptions, filters.phonemes, 'phonemes')}

              {/* Words (with search) */}
              {showWords && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between items-center">
                    <span>Words ({filteredWordOptions.length})</span>
                    <span className="flex gap-2">
                      <button onClick={() => updateFilters({ words: wordOptions })} className={`hover:underline ${wordOptions.length > 0 && wordOptions.every(o => filters.words.includes(o)) ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>All</button>
                      <button onClick={() => updateFilters({ words: [] })} className={`hover:underline ${filters.words.length === 0 ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>Clear</button>
                    </span>
                  </label>

                  <div className="relative mb-1.5">
                    <input
                      type="text"
                      placeholder="Search words..."
                      className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 rounded focus:outline-none focus:border-sky-500"
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
                          className={`px-2 py-0.5 rounded text-[11px] border ${filters.words.includes(word) ? 'bg-slate-600 text-white border-slate-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
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
              )}

              {/* Alignments */}
              {showAlignments && renderFilterSection('Alignments', alignmentOptions, filters.alignments, 'alignments')}

              {/* Allophones */}
              {showProduced && renderFilterSection('Allophones (Produced)', producedOptions, filters.produced, 'produced')}

              {/* Expected Stress */}
              {showCanStress && renderFilterSection(
                'Expected Stress', canonicalStressOptions, filters.canonicalStress, 'canonicalStress',
                v => v === '1' ? 'Stressed' : v === '0' ? 'Unstressed' : v
              )}

              {/* Transcribed Stress */}
              {showLexStress && renderFilterSection(
                'Transcribed Stress', lexicalStressOptions, filters.lexicalStress, 'lexicalStress',
                v => v === '0' ? 'Unstressed' : v === '1' ? 'Primary' : v === '2' ? 'Secondary' : v
              )}

              {/* Syllable Mark */}
              {showSylMark && renderFilterSection('Syllable Mark', syllableMarkOptions, filters.syllableMark, 'syllableMark')}

              {/* Voice Pitch */}
              {showVoicePitch && renderFilterSection('Voice Pitch', voicePitchOptions, filters.voicePitch, 'voicePitch')}

              {/* Custom Fields */}
              {visibleCustomColumns.map(col => {
                const rawVals: string[] = data.map(t => t.customFields?.[col] ?? '').filter(v => v !== '');
                const uniqueVals = Array.from(new Set(rawVals)).sort();
                const selected = filters.customFilters?.[col] || [];
                const allSelected = uniqueVals.length > 0 && uniqueVals.every(o => selected.includes(o));
                const toggleCustom = (val: string) => {
                  const next = selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val];
                  setFilters(prev => ({
                    ...prev,
                    customFilters: { ...(prev.customFilters || {}), [col]: next }
                  }));
                };
                const label = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <div key={col}>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between items-center">
                      <span>{label}</span>
                      <span className="flex gap-2">
                        <button onClick={() => setFilters(prev => ({ ...prev, customFilters: { ...(prev.customFilters || {}), [col]: uniqueVals } }))} className={`hover:underline ${allSelected ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>All</button>
                        <button onClick={() => setFilters(prev => ({ ...prev, customFilters: { ...(prev.customFilters || {}), [col]: [] } }))} className={`hover:underline ${selected.length === 0 ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>Clear</button>
                      </span>
                    </label>
                    <div className="max-h-24 overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1">
                      {uniqueVals.map(v => (
                        <button
                          key={v}
                          onClick={() => toggleCustom(v)}
                          className={`px-2 py-0.5 rounded text-[11px] border ${selected.includes(v) ? 'bg-slate-600 text-white border-slate-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
