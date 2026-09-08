
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Filter, Database, Upload, Search, Settings2, RotateCcw } from 'lucide-react';
import { PlotConfig, FilterState, NumericRange, SpeechToken, DatasetMeta, UNDEFINED_LABEL } from '../types';
import { filterMode, listFilterFields, listSidebarFields, NumericFilterField } from '../utils/filterFields';
import { isOpenRange } from '../utils/numericFields';
import { crossFilterOptions } from '../utils/crossFilter';
import { bandRatioBandsLabel } from '../utils/spectralMoments';
import { getLabel } from '../utils/getLabel';

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
  /** Switch a numeric field between a list of its values and a pair of bounds. */
  onSetFilterMode?: (key: string, mode: 'list' | 'range') => void;
  onReopenMappingDialog?: () => void;
  /** Select every value again, in every field — the way back from a filtered view. */
  onResetFilters?: () => void;
}

/**
 * One bound on a numeric field.
 *
 * The typed text lives here until it is committed, on Enter or on leaving the box. A
 * filter change re-reads every token and re-renders every section, which is far too much
 * to do per keystroke — and a half-typed "0." is not a bound anyway. The box is plain
 * text rather than a number input for the same reason: a number input reports a
 * mid-typed "0." as empty, so the decimal point is swallowed as you type it.
 */
const RangeBound: React.FC<{
  value?: number;
  placeholder: string;
  title: string;
  onCommit: (raw: string) => void;
}> = ({ value, placeholder, title, onCommit }) => {
  const committed = value === undefined ? '' : String(value);
  const [text, setText] = useState(committed);
  useEffect(() => { setText(committed); }, [committed]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="w-full min-w-0 px-1.5 py-1 text-[11px] border border-slate-200 rounded focus:outline-none focus:border-sky-500"
      placeholder={placeholder}
      title={title}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={e => {
        if (e.key === 'Enter') onCommit(text);
        if (e.key === 'Escape') setText(committed);
      }}
    />
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  filters, setFilters, data, tokenCount, totalCount, handleFileUpload, activeLayerName, datasetMeta, onToggleFieldVisibility, onSetFilterMode, onReopenMappingDialog, onResetFilters
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

  // --- Label fields listed in the sidebar (shared rule with the encoding menus) ---
  const visibleFilterFields = useMemo(() => listFilterFields(datasetMeta), [datasetMeta]);
  // --- Every listed field in column order, each with the control it gets ---
  const sidebarFields = useMemo(() => listSidebarFields(datasetMeta), [datasetMeta]);
  /** Keys of listed fields that hold numbers, so a value list can offer bounds instead. */
  const numericKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of datasetMeta?.columnMappings || []) {
      if (m.numeric && filterMode(m) === 'list') keys.add(m.fieldName || m.csvHeader);
    }
    return keys;
  }, [datasetMeta]);

  // --- Cross-filtered options: what each field still offers, given every other filter ---
  const fieldOptions = useMemo(
    () => crossFilterOptions(data, visibleFilterFields.map(f => f.key), filters),
    [data, visibleFilterFields, filters],
  );

  // --- Popover entries: every filterable field, listed or not. Numeric fields come last
  // and are usually many, so the popover offers a search once the list gets long. ---
  const popoverEntries = useMemo(
    () => listSidebarFields(datasetMeta, 'all').map(e => ({ ...e.field, numeric: e.mode === 'range' })),
    [datasetMeta],
  );
  const [fieldSearch, setFieldSearch] = useState('');
  const shownPopoverEntries = useMemo(() => {
    const term = fieldSearch.trim().toLowerCase();
    return term ? popoverEntries.filter(e => e.label.toLowerCase().includes(term)) : popoverEntries;
  }, [popoverEntries, fieldSearch]);

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
        const val = getLabel(t, key);
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

  /** Set one bound on a numeric field; an empty box clears that bound. */
  const setRangeBound = (key: string, bound: 'min' | 'max', raw: string) => {
    setFilters(prev => {
      const ranges = { ...(prev.ranges || {}) };
      const next: NumericRange = { ...(ranges[key] || {}) };
      const parsed = parseFloat(raw);
      if (raw.trim() === '' || isNaN(parsed)) delete next[bound];
      else next[bound] = parsed;
      ranges[key] = next;
      return { ...prev, ranges };
    });
  };

  const setIncludeMissing = (key: string, include: boolean) => {
    setFilters(prev => ({
      ...prev,
      ranges: { ...(prev.ranges || {}), [key]: { ...((prev.ranges || {})[key] || {}), includeMissing: include } },
    }));
  };

  const clearRange = (key: string) => {
    setFilters(prev => ({ ...prev, ranges: { ...(prev.ranges || {}), [key]: {} } }));
  };

  const hasData = data.length > 0;
  const hasAnyFilters = sidebarFields.length > 0;

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
            {onSetFilterMode && numericKeys.has(key) && (
              <button
                onClick={() => onSetFilterMode(key, 'range')}
                className="hover:underline text-slate-400"
                title="Filter this field by a minimum and maximum instead of picking values"
              >Range</button>
            )}
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

  /** Render a min/max section for a numeric field. Blank bound = open on that side. */
  const renderNumericFilterSection = ({ key, label, stats }: NumericFilterField) => {
    const range = filters.ranges?.[key] || {};
    const bounded = !isOpenRange(range);
    const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

    return (
      <div key={key}>
        <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between items-center">
          <span>{label} <span className="font-medium normal-case text-slate-400">({round(stats.min)}–{round(stats.max)})</span></span>
          <span className="flex gap-2">
            {onSetFilterMode && (
              <button
                onClick={() => onSetFilterMode(key, 'list')}
                className="hover:underline text-slate-400"
                title="Pick values from a list instead of setting bounds"
              >List</button>
            )}
            <button
              onClick={() => clearRange(key)}
              className={`hover:underline ${bounded ? 'text-slate-400' : 'text-sky-700 font-extrabold'}`}
              title="Remove the bounds on this field"
            >Any</button>
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          <RangeBound
            value={range.min}
            placeholder="min"
            title={`Keep tokens at or above this value, applied on Enter or when you leave the box (observed minimum ${stats.min})`}
            onCommit={raw => setRangeBound(key, 'min', raw)}
          />
          <span className="text-[10px] text-slate-400 shrink-0">to</span>
          <RangeBound
            value={range.max}
            placeholder="max"
            title={`Keep tokens at or below this value, applied on Enter or when you leave the box (observed maximum ${stats.max})`}
            onCommit={raw => setRangeBound(key, 'max', raw)}
          />
        </div>
        {bounded && stats.count < totalCount && (
          <label className="flex items-center gap-1.5 mt-1 cursor-pointer" title={`${(totalCount - stats.count).toLocaleString()} tokens carry no value here`}>
            <input
              type="checkbox"
              className="rounded text-sky-700"
              checked={range.includeMissing !== false}
              onChange={e => setIncludeMissing(key, e.target.checked)}
            />
            <span className="text-[10px] text-slate-500">Keep the {(totalCount - stats.count).toLocaleString()} unmeasured</span>
          </label>
        )}
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
            <input type="file" className="hidden" multiple accept=".csv,.tsv,.txt,.json" onChange={handleFileUpload} />
          </label>
          {hasData && (
            <>
              <div className="text-[10px] text-slate-500 font-bold uppercase flex justify-between items-center">
                <span>Tokens: {tokenCount.toLocaleString()} / {totalCount.toLocaleString()}</span>
                <span className="text-sky-700">{Math.round((tokenCount / totalCount) * 100 || 0)}%</span>
              </div>
              {datasetMeta?.provenance?.bandRatio && (
                <div
                  className="mt-2 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-600 leading-snug cursor-help"
                  title={`Band energy ratio = 10·log10(P_high / P_low), high band ${datasetMeta.provenance.bandRatio.high[0]}–${datasetMeta.provenance.bandRatio.high[1]} Hz over low band ${datasetMeta.provenance.bandRatio.low[0]}–${datasetMeta.provenance.bandRatio.low[1]} Hz. Read from ${datasetMeta.provenance.sourceFile}. Ratios measured over different bands are not comparable.`}
                >
                  <span className="font-bold uppercase text-slate-400">Band ratio</span>{' '}
                  {bandRatioBandsLabel(datasetMeta.provenance.bandRatio)} Hz ({datasetMeta.provenance.bandRatio.units})
                </div>
              )}
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
            {/* Filters header: reset, then the field-visibility gear */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Filter size={14} className="mr-2" /> Filters
              </h2>
              <div className="flex items-center gap-1 ml-auto">
                {onResetFilters && (
                  <button
                    onClick={onResetFilters}
                    disabled={tokenCount === totalCount}
                    className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-1 rounded border transition-colors ${
                      tokenCount === totalCount
                        ? 'border-slate-100 text-slate-300 cursor-default'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                    title={tokenCount === totalCount
                      ? 'Every token is already showing'
                      : `Show all ${totalCount.toLocaleString()} tokens again — selects every value in every field`}
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
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
                      {popoverEntries.length > 12 && (
                        <div className="px-2 pb-1.5">
                          <input
                            type="text"
                            placeholder="Search fields..."
                            className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded focus:outline-none focus:border-sky-500"
                            value={fieldSearch}
                            onChange={e => setFieldSearch(e.target.value)}
                          />
                        </div>
                      )}
                      {shownPopoverEntries.map(entry => (
                        <label key={entry.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={entry.visible}
                            onChange={() => toggleFieldInPopover(entry)}
                            className="rounded text-sky-700"
                          />
                          <span className="text-xs text-slate-700">{entry.label}</span>
                          {entry.numeric && <span className="ml-auto text-[9px] font-bold text-slate-400" title="Numeric — filtered by a minimum and maximum">min/max</span>}
                        </label>
                      ))}
                      {shownPopoverEntries.length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-slate-400 italic">No fields match</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>

            <div className="space-y-4">
              {sidebarFields.map(entry => entry.mode === 'range'
                ? renderNumericFilterSection(entry.field)
                : renderDynamicFilterSection(entry.field.key, entry.field.label))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
