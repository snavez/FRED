
import React, { useState, useMemo } from 'react';
import { ColumnMapping, ColumnRole } from '../types';
import { X, Upload, FileText, RefreshCw } from 'lucide-react';

interface DataMappingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mappings: ColumnMapping[]) => void;
  headers: string[];
  sampleData: string[][];
  detectedMappings: ColumnMapping[];
  fileName: string;
  isEditMode?: boolean;
}

// Speaker ID & File ID are assigned via the quick-assign dropdowns at the top,
// so they are NOT listed here — the per-row dropdown only shows these roles.
const ROLE_OPTIONS: { value: ColumnRole, label: string }[] = [
  { value: 'formant', label: 'Formant Value' },
  { value: 'duration', label: 'Duration Value' },
  { value: 'pitch', label: 'Pitch Value' },
  { value: 'field', label: 'Custom Field' },
  { value: 'ignore', label: 'Ignore' },
];

const DataMappingDialog: React.FC<DataMappingDialogProps> = ({
  isOpen, onClose, onConfirm, headers, sampleData, detectedMappings, fileName, isEditMode
}) => {
  const [mappings, setMappings] = useState<ColumnMapping[]>(detectedMappings);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sidebarHelpRect, setSidebarHelpRect] = useState<DOMRect | null>(null);
  const [speakerHelpRect, setSpeakerHelpRect] = useState<DOMRect | null>(null);
  const [fileIdHelpRect, setFileIdHelpRect] = useState<DOMRect | null>(null);

  // Reset mappings when dialog opens with new data
  React.useEffect(() => {
    setMappings(detectedMappings);
    setValidationError(null);
  }, [detectedMappings]);

  const updateMapping = (idx: number, updates: Partial<ColumnMapping>) => {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, ...updates } : m));
    setValidationError(null);
  };

  // Quick-assign helper for Speaker/File ID dropdowns
  // Allows the same column to be assigned to both roles (separate mappings)
  const assignSpecialRole = (role: 'speaker' | 'file_id', csvHeader: string) => {
    const otherRole = role === 'speaker' ? 'file_id' : 'speaker';
    setMappings(prev => {
      // Remove previous mapping for this role
      let next = prev.filter(m => m.role !== role);
      // If the chosen column already exists as a non-special mapping, keep it but
      // also insert a new mapping for the special role pointing to the same column
      const existing = next.find(m => m.csvHeader === csvHeader && m.role !== otherRole);
      if (existing) {
        // Repurpose it to this role
        next = next.map(m => {
          if (m === existing) return { ...m, role, showInSidebar: true, isDataField: false, fieldName: undefined };
          return m;
        });
      } else if (!next.find(m => m.csvHeader === csvHeader && m.role === otherRole)) {
        // Column not in mappings at all (shouldn't happen), add it
        next.push({ csvHeader, role, showInSidebar: true, isDataField: false });
      } else {
        // Column is already used by the other special role — insert a duplicate mapping
        const otherIdx = next.findIndex(m => m.csvHeader === csvHeader && m.role === otherRole);
        next.splice(otherIdx + 1, 0, { csvHeader, role, showInSidebar: true, isDataField: false });
      }
      return next;
    });
    setValidationError(null);
  };

  // Currently assigned speaker/file_id columns
  const speakerCol = mappings.find(m => m.role === 'speaker')?.csvHeader || '';
  const fileIdCol = mappings.find(m => m.role === 'file_id')?.csvHeader || '';

  // Available columns for speaker/file_id selection (non-formant, non-ignore)
  const availableForSpecial = useMemo(() =>
    headers.filter(h => {
      const m = mappings.find(mm => mm.csvHeader === h);
      return m && m.role !== 'formant';
    }), [headers, mappings]);

  const summary = useMemo(() => {
    const formantMappings = mappings.filter(m => m.role === 'formant');
    const timePoints = new Set(formantMappings.map(m => m.timePoint).filter(t => t !== undefined));
    const fieldCount = mappings.filter(m => m.role === 'field').length;
    const assignedCount = mappings.filter(m => m.role !== 'ignore').length;
    return {
      totalCols: headers.length,
      assignedCount,
      timePointCount: timePoints.size,
      fieldCount,
      rows: sampleData.length
    };
  }, [mappings, headers]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[940px] max-h-[85vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText size={20} className="text-sky-700" />
              Data Mapping
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isEditMode
                ? `Reviewing column mappings for ${fileName}`
                : `${fileName} — ${summary.totalCols} columns, ${summary.rows} sample rows — ${summary.assignedCount} mapped, ${summary.timePointCount} time points, ${summary.fieldCount} fields`
              }
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Quick-assign: Speaker & File ID */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600 whitespace-nowrap cursor-help border-b border-dashed border-slate-300"
                onMouseEnter={e => setSpeakerHelpRect(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setSpeakerHelpRect(null)}
              >Speaker ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={speakerCol}
                onChange={e => {
                  if (e.target.value === '') {
                    setMappings(prev => {
                      const speakerMapping = prev.find(m => m.role === 'speaker');
                      if (!speakerMapping) return prev;
                      const hasDuplicate = prev.some(m => m.csvHeader === speakerMapping.csvHeader && m.role !== 'speaker');
                      if (hasDuplicate) return prev.filter(m => m.role !== 'speaker');
                      return prev.map(m => m.role === 'speaker' ? { ...m, role: 'field' as ColumnRole, fieldName: m.csvHeader, showInSidebar: true, isDataField: false } : m);
                    });
                  } else {
                    assignSpecialRole('speaker', e.target.value);
                  }
                }}
              >
                <option value="">None</option>
                {availableForSpecial.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600 whitespace-nowrap cursor-help border-b border-dashed border-slate-300"
                onMouseEnter={e => setFileIdHelpRect(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setFileIdHelpRect(null)}
              >File ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={fileIdCol}
                onChange={e => {
                  if (e.target.value === '') {
                    setMappings(prev => {
                      const fileIdMapping = prev.find(m => m.role === 'file_id');
                      if (!fileIdMapping) return prev;
                      const hasDuplicate = prev.some(m => m.csvHeader === fileIdMapping.csvHeader && m.role !== 'file_id');
                      if (hasDuplicate) return prev.filter(m => m.role !== 'file_id');
                      return prev.map(m => m.role === 'file_id' ? { ...m, role: 'field' as ColumnRole, fieldName: m.csvHeader, showInSidebar: true, isDataField: false } : m);
                    });
                  } else {
                    assignSpecialRole('file_id', e.target.value);
                  }
                }}
              >
                <option value="">None</option>
                {availableForSpecial.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            Both can be None, or point at the same CSV column. Hover over the labels above for more info.
          </p>
        </div>

        {/* Filter vs Data explanation */}
        <div className="mx-5 mt-3 mb-1 p-3 bg-amber-50/60 border border-amber-100 rounded-lg shrink-0">
          <p className="text-[11px] text-amber-900 leading-relaxed">
            <span className="font-bold">Filter fields</span> contain categorical labels for filtering your data (e.g. phoneme, stress, gender, speaker). They can appear in the sidebar for interactive filtering.
            <br />
            <span className="font-bold">Data fields</span> contain values to be plotted (e.g. formant measurements, duration). Data fields are not available as sidebar filters.
          </p>
          <p className="text-[11px] text-amber-800/70 mt-1 italic">
            Toggle any field between filter and data below. Sidebar visibility can also be changed after import.
          </p>
        </div>

        {/* Scrollable table */}
        <div className="flex-1 overflow-y-auto p-5 pt-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-slate-200">
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-36">CSV Column</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-40">Sample Values</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2 w-36">Map To</th>
                <th className="text-left text-[11px] font-bold text-slate-400 uppercase py-2">Field Name</th>
                <th className="text-center text-[11px] font-bold text-slate-400 uppercase py-2 w-24">Type</th>
                <th className="text-center text-[11px] font-bold text-slate-400 uppercase py-2 w-16">
                  <span
                    className="cursor-help border-b border-dashed border-slate-300"
                    onMouseEnter={e => setSidebarHelpRect(e.currentTarget.getBoundingClientRect())}
                    onMouseLeave={() => setSidebarHelpRect(null)}
                  >Sidebar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, idx) => {
                const colIdx = headers.indexOf(m.csvHeader);
                const samples = sampleData.map(row => row[colIdx] || '').filter(v => v !== '').slice(0, 4);
                const isIgnored = m.role === 'ignore';
                const isData = m.isDataField === true;

                return (
                  <tr key={`${m.csvHeader}_${idx}`} className={`border-b border-slate-100 ${isIgnored ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-2">
                      <span className="font-mono text-xs font-bold text-slate-700">{m.csvHeader}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {samples.map((s, i) => (
                          <span key={i} className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 truncate max-w-[70px]">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      {(m.role === 'speaker' || m.role === 'file_id') ? (
                        <span className="text-xs text-slate-500 italic">
                          {m.role === 'speaker' ? 'Speaker ID' : 'File ID'}
                          <span className="text-[10px] text-slate-400 ml-1">↑ set above</span>
                        </span>
                      ) : (
                      <select
                        className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white"
                        value={m.role}
                        onChange={e => {
                          const role = e.target.value as ColumnRole;
                          const updates: Partial<ColumnMapping> = { role };

                          // Set isDataField + showInSidebar defaults based on role
                          if (role === 'formant' || role === 'duration' || role === 'pitch') {
                            updates.isDataField = true;
                            updates.showInSidebar = false;
                          } else if (role === 'ignore') {
                            updates.isDataField = undefined;
                            updates.showInSidebar = false;
                          } else {
                            updates.isDataField = false;
                            updates.showInSidebar = true;
                          }

                          if (role === 'field' || role === 'pitch') {
                            updates.fieldName = m.fieldName || m.csvHeader;
                          }
                          if (role === 'formant') {
                            updates.formant = m.formant || 'f1';
                            updates.timePoint = m.timePoint ?? 50;
                            updates.isSmooth = m.isSmooth || false;
                          }
                          updateMapping(idx, updates);
                        }}
                      >
                        {ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {m.role === 'formant' && (
                        <div className="flex items-center gap-2">
                          <select
                            className="text-xs p-1 border border-slate-200 rounded w-14"
                            value={m.formant || 'f1'}
                            onChange={e => updateMapping(idx, { formant: e.target.value as 'f1' | 'f2' | 'f3' })}
                          >
                            <option value="f1">F1</option>
                            <option value="f2">F2</option>
                            <option value="f3">F3</option>
                          </select>
                          <span className="text-[11px] text-slate-400">@</span>
                          <input
                            type="number"
                            className="text-xs p-1 border border-slate-200 rounded w-14"
                            value={m.timePoint ?? 50}
                            onChange={e => updateMapping(idx, { timePoint: parseInt(e.target.value) || 0 })}
                            min={0}
                            max={100}
                          />
                          <span className="text-[11px] text-slate-400">%</span>
                          {m.formantLabel && (
                            <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">{m.formantLabel}</span>
                          )}
                        </div>
                      )}
                      {(m.role === 'field' || m.role === 'pitch') && (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            className="text-xs p-1 border border-slate-200 rounded w-36"
                            value={m.fieldName ?? m.csvHeader}
                            onChange={e => updateMapping(idx, { fieldName: e.target.value })}
                            placeholder="Display name"
                          />
                        </div>
                      )}
                      {(m.role === 'speaker' || m.role === 'file_id' || m.role === 'duration') && (
                        <span className="text-[11px] text-slate-400 italic">auto-detected</span>
                      )}
                    </td>
                    {/* Type: Filter / Data toggle */}
                    <td className="py-2 text-center">
                      {!isIgnored && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateMapping(idx, { isDataField: false, showInSidebar: true })}
                            className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${!isData ? 'bg-sky-100 border-sky-300 text-sky-700 font-bold' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                            title="Filter field: categorical labels for filtering data"
                          >
                            Filter
                          </button>
                          <button
                            onClick={() => updateMapping(idx, { isDataField: true, showInSidebar: false })}
                            className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${isData ? 'bg-amber-100 border-amber-300 text-amber-700 font-bold' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                            title="Data field: numeric values to be plotted"
                          >
                            Data
                          </button>
                        </div>
                      )}
                    </td>
                    {/* Sidebar checkbox — visible for any non-ignored Filter field */}
                    <td className="py-2 text-center">
                      {!isIgnored && !isData && (
                        <input
                          type="checkbox"
                          checked={m.showInSidebar === true}
                          onChange={e => updateMapping(idx, { showInSidebar: e.target.checked })}
                          className="rounded text-sky-700"
                          title="Show as filter in sidebar"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            {validationError && (
              <span className="text-xs text-red-600 font-medium">{validationError}</span>
            )}
          </div>
          <button
            onClick={() => {
              const emptyField = mappings.filter(m => m.role === 'field' && !m.fieldName?.trim());
              if (emptyField.length > 0) {
                setValidationError(`${emptyField.length} field(s) have empty names`);
                return;
              }
              onConfirm(mappings);
            }}
            className="px-6 py-2 text-xs font-bold text-white bg-slate-600 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            {isEditMode ? <RefreshCw size={14} /> : <Upload size={14} />}
            {isEditMode ? 'Apply Changes' : 'Import Data'}
          </button>
        </div>

        {/* Fixed-position tooltips */}
        {sidebarHelpRect && (
          <div
            className="fixed w-48 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: sidebarHelpRect.bottom + 4, left: sidebarHelpRect.left + sidebarHelpRect.width / 2 - 96 }}
          >
            Tick to show this field as a filter in the sidebar. Can be changed after import.
          </div>
        )}
        {speakerHelpRect && (
          <div
            className="fixed w-56 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: speakerHelpRect.bottom + 4, left: speakerHelpRect.left + speakerHelpRect.width / 2 - 112 }}
          >
            Used for speaker normalisation (Lobanov, Nearey). If no Speaker ID is specified, normalisation functionality will not be accessible.
          </div>
        )}
        {fileIdHelpRect && (
          <div
            className="fixed w-56 bg-slate-800 text-white text-[11px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: fileIdHelpRect.bottom + 4, left: fileIdHelpRect.left + fileIdHelpRect.width / 2 - 112 }}
          >
            The audio filename helps you identify and trace individual tokens back to their source recording. Useful for tracking down outliers.
          </div>
        )}
      </div>
    </div>
  );
};

export default DataMappingDialog;
