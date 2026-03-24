
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Filter, Database, Upload, Search, Settings2 } from 'lucide-react';
import { PlotConfig, FilterState, SpeechToken, DatasetMeta, UNDEFINED_LABEL } from '../types';

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
  onReopenMappingDialog?: () => void;
}

/** Get the filter key for a column mapping */
const getFilterKey = (m: { role: string; fieldName?: string }): string | null => {
  if (m.role === 'speaker') return 'speaker';
  if (m.role === 'file_id') return 'file_id';
  if (m.role === 'duration') return 'duration';
  if (m.role === 'ignore' || m.role === 'formant') return null;
  if (m.fieldName) return m.fieldName; // handles 'field' and 'pitch'
  return null;
};

/** Get value from a token for a given filter key */
const getTokenValue = (t: SpeechToken, key: string): string => {
  if (key === 'speaker') return t.speaker;
  if (key === 'file_id') return t.file_id;
  if (key === 'duration') return t.duration.toString();
  return t.fields[key] ?? '';
};

/** Pretty label for a field key */
const prettyLabel = (key: string): string => {
  if (key === 'speaker') return 'Speaker';
  if (key === 'file_id') return 'File ID';
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const Sidebar: React.FC<SidebarProps> = ({
  filters, setFilters, data, tokenCount, totalCount, handleFileUpload, activeLayerName, datasetMeta, onToggleFieldVisibility, onReopenMappingDialog
}) => {
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
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

  // --- Build visible filter fields dynamically from datasetMeta ---
  const visibleFilterFields = useMemo(() => {
    if (!datasetMeta) return [];
    const fields: { key: string; label: string }[] = [];
    const seen = new Set<string>();

    for (const m of datasetMeta.columnMappings) {
      if (m.showInSidebar === false) continue;
      const key = getFilterKey(m);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      fields.push({ key, label: prettyLabel(key) });
    }

    return fields;
  }, [datasetMeta]);

  // --- Cross-filtered options: for each field, apply all OTHER active filters ---
  const fieldOptions = useMemo(() => {
    const result: Record<string, string[]> = {};

    // Pre-build filter entries from current filter state
    const filterRecord = filters.filters as Record<string, string[]>;
    const allFilterEntries: { key: string; set: Set<string> }[] = [];
    for (const [key, values] of Object.entries(filterRecord)) {
      if (values && values.length > 0) {
        allFilterEntries.push({ key, set: new Set(values) });
      }
    }

    // Check if any filter has empty array (= nothing passes for that field)
    const emptyFilterKeys = new Set(
      Object.entries(filterRecord).filter(([, v]) => v && v.length === 0).map(([k]) => k)
    );

    for (const { key } of visibleFilterFields) {
      // If some OTHER filter is empty, no data passes → no options
      const otherEmpty = [...emptyFilterKeys].some(k => k !== key);
      if (otherEmpty) { result[key] = []; continue; }

      // Apply all filters EXCEPT this field's own
      let subset = data;
      for (const entry of allFilterEntries) {
        if (entry.key === key) continue;
        subset = subset.filter(t => {
          const val = getTokenValue(t, entry.key);
          // Map empty values to UNDEFINED_LABEL for checking
          const effectiveVal = val === '' ? UNDEFINED_LABEL : val;
          return entry.set.has(effectiveVal);
        });
      }

      const values = subset.map(t => {
        const val = getTokenValue(t, key);
        return val === '' ? UNDEFINED_LABEL : val;
      });
      result[key] = Array.from(new Set<string>(values)).sort((a, b) => {
        // Sort UNDEFINED_LABEL to the end
        if (a === UNDEFINED_LABEL) return 1;
        if (b === UNDEFINED_LABEL) return -1;
        return a.localeCompare(b);
      });
    }

    return result;
  }, [data, visibleFilterFields, filters]);

  // --- Popover entries: all filterable fields in the dataset (exclude data fields) ---
  const popoverEntries = useMemo(() => {
    if (!datasetMeta) return [];
    const entries: { key: string; label: string; visible: boolean }[] = [];
    const seen = new Set<string>();

    for (const m of datasetMeta.columnMappings) {
      if (m.isDataField) continue; // Data fields don't appear as sidebar filter options
      const key = getFilterKey(m);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        label: prettyLabel(key),
        visible: m.showInSidebar !== false,
      });
    }

    return entries;
  }, [datasetMeta]);

  const toggleFieldInPopover = (entry: { key: string; visible: boolean }) => {
    onToggleFieldVisibility?.(entry.key, !entry.visible);
  };

  // --- Filter toggle helpers ---
  const toggleFilterValue = (key: string, val: string) => {
    setFilters(prev => {
      const current = prev.filters[key] || [];
      const next = current.includes(val) ? current.filter(v => v !== val) : [...current, val];
      return { ...prev, filters: { ...prev.filters, [key]: next } };
    });
  };

  // Full (non-cross-filtered) options for "All" — prevents permanent data loss
  const fullFieldOptions = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const { key } of visibleFilterFields) {
      const values = data.map(t => {
        const val = getTokenValue(t, key);
        return val === '' ? UNDEFINED_LABEL : val;
      });
      result[key] = Array.from(new Set<string>(values)).sort((a, b) => {
        if (a === UNDEFINED_LABEL) return 1;
        if (b === UNDEFINED_LABEL) return -1;
        return a.localeCompare(b);
      });
    }
    return result;
  }, [data, visibleFilterFields]);

  const selectAllForKey = (key: string) => {
    const options = fullFieldOptions[key] || [];
    setFilters(prev => ({ ...prev, filters: { ...prev.filters, [key]: options } }));
  };

  const clearAllForKey = (key: string) => {
    setFilters(prev => ({ ...prev, filters: { ...prev.filters, [key]: [] } }));
  };

  const hasData = data.length > 0;
  const hasAnyFilters = visibleFilterFields.length > 0;

  /** Threshold for showing search box in a filter section */
  const SEARCH_THRESHOLD = 50;

  /** Render a filter section for a given field key */
  const renderDynamicFilterSection = (key: string, label: string) => {
    const options = fieldOptions[key] || [];
    const selected = filters.filters[key] || [];
    const allSelected = options.length > 0 && options.every(o => selected.includes(o));
    const showSearch = options.length > SEARCH_THRESHOLD;
    const searchTerm = searchTerms[key] || '';

    const filteredOptions = showSearch && searchTerm
      ? options.filter(o => o.toLowerCase().includes(searchTerm.toLowerCase()))
      : options;

    return (
      <div key={key}>
        <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between items-center">
          <span>{label}{showSearch ? ` (${filteredOptions.length})` : ''}</span>
          <span className="flex gap-2">
            <button onClick={() => selectAllForKey(key)} className={`hover:underline ${allSelected ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>All</button>
            <button onClick={() => clearAllForKey(key)} className={`hover:underline ${selected.length === 0 ? 'text-sky-700 font-extrabold' : 'text-slate-400'}`}>Clear</button>
          </span>
        </label>

        {showSearch && (
          <div className="relative mb-1.5">
            <input
              type="text"
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 rounded focus:outline-none focus:border-sky-500"
              value={searchTerm}
              onChange={e => setSearchTerms(prev => ({ ...prev, [key]: e.target.value }))}
            />
            <Search size={10} className="absolute left-2 top-2 text-slate-400" />
          </div>
        )}

        <div className={`overflow-y-auto border border-slate-200 rounded p-1.5 flex flex-wrap gap-1 ${showSearch ? 'max-h-32' : 'max-h-24'}`}>
          {filteredOptions.length > 0 ? (
            filteredOptions.slice(0, 200).map(v => {
              const isUndef = v === UNDEFINED_LABEL;
              return (
                <button
                  key={v}
                  onClick={() => toggleFilterValue(key, v)}
                  className={`px-2 py-0.5 rounded text-[11px] border ${isUndef ? 'italic' : ''} ${selected.includes(v)
                    ? isUndef ? 'bg-stone-400 text-white border-stone-400' : 'bg-slate-600 text-white border-slate-600'
                    : isUndef ? 'bg-stone-100 border-stone-200 text-stone-500' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                >
                  {v}
                </button>
              );
            })
          ) : (
            <span className="text-[10px] text-slate-400 p-1">No values{searchTerm ? ' match' : ''}</span>
          )}
          {filteredOptions.length > 200 && (
            <div className="w-full text-center text-[9px] text-slate-400 pt-1 italic">
              + {filteredOptions.length - 200} more (search to find)
            </div>
          )}
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
            <>
              <div className="text-[10px] text-slate-500 font-bold uppercase flex justify-between items-center">
                <span>Tokens: {tokenCount.toLocaleString()} / {totalCount.toLocaleString()}</span>
                <span className="text-sky-700">{Math.round((tokenCount / totalCount) * 100 || 0)}%</span>
              </div>
              {onReopenMappingDialog && (
                <button
                  onClick={onReopenMappingDialog}
                  className="w-full mt-2 px-3 py-1.5 text-[10px] font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5"
                  title="Re-open column mapping dialog to adjust field configuration"
                >
                  <Settings2 size={12} />
                  Edit Column Mappings
                </button>
              )}
            </>
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
                      {popoverEntries.map(entry => (
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
              {visibleFilterFields.map(({ key, label }) => renderDynamicFilterSection(key, label))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
