
import React, { useState, useMemo } from 'react';
import { ColumnMapping, ColumnRole } from '../types';
import { X, Upload, FileText } from 'lucide-react';

interface DataMappingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mappings: ColumnMapping[]) => void;
  headers: string[];
  sampleData: string[][];
  detectedMappings: ColumnMapping[];
  fileName: string;
}

const ROLE_OPTIONS: { value: ColumnRole, label: string }[] = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'speaker', label: 'Speaker ID' },
  { value: 'file_id', label: 'File ID' },
  { value: 'xmin', label: 'Onset (xmin)' },
  { value: 'duration', label: 'Duration' },
  { value: 'formant', label: 'Formant Value' },
  { value: 'field', label: 'Field' },
];

const DataMappingDialog: React.FC<DataMappingDialogProps> = ({
  isOpen, onClose, onConfirm, headers, sampleData, detectedMappings, fileName
}) => {
  const [mappings, setMappings] = useState<ColumnMapping[]>(detectedMappings);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sidebarHelpRect, setSidebarHelpRect] = useState<DOMRect | null>(null);

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
  const assignSpecialRole = (role: 'speaker' | 'file_id', csvHeader: string) => {
    setMappings(prev => prev.map(m => {
      // Clear the role from any previous column
      if (m.role === role) {
        return { ...m, role: 'field' as ColumnRole, fieldName: m.csvHeader, showInSidebar: true };
      }
      // Assign to the chosen column
      if (m.csvHeader === csvHeader) {
        return { ...m, role, showInSidebar: true, fieldName: undefined };
      }
      return m;
    }));
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
      <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText size={20} className="text-sky-700" />
              Data Mapping
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {fileName} — {summary.totalCols} columns, {summary.rows} sample rows — {summary.assignedCount} mapped, {summary.timePointCount} time points, {summary.fieldCount} fields
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Quick-assign: Speaker & File ID */}
        <div className="px-5 pt-4 pb-2 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-600 whitespace-nowrap">Speaker ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={speakerCol}
                onChange={e => {
                  if (e.target.value === '') {
                    // Clear speaker assignment
                    setMappings(prev => prev.map(m =>
                      m.role === 'speaker' ? { ...m, role: 'field' as ColumnRole, fieldName: m.csvHeader, showInSidebar: true } : m
                    ));
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
              <span className="text-[9px] text-slate-400 italic">for normalization</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-600 whitespace-nowrap">File ID:</label>
              <select
                className="text-xs p-1.5 border border-slate-200 rounded bg-white min-w-[160px]"
                value={fileIdCol}
                onChange={e => {
                  if (e.target.value === '') {
                    setMappings(prev => prev.map(m =>
                      m.role === 'file_id' ? { ...m, role: 'field' as ColumnRole, fieldName: m.csvHeader, showInSidebar: true } : m
                    ));
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
              <span className="text-[9px] text-slate-400 italic">for data provenance</span>
            </div>
          </div>
        </div>

        {/* Scrollable table */}
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-slate-200">
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase py-2 w-36">CSV Column</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase py-2 w-48">Sample Values</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase py-2 w-40">Map To</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase py-2">Details</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase py-2 w-16">
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

                return (
                  <tr key={m.csvHeader} className={`border-b border-slate-100 ${isIgnored ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-2">
                      <span className="font-mono text-xs font-bold text-slate-700">{m.csvHeader}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {samples.map((s, i) => (
                          <span key={i} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 truncate max-w-[80px]">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white"
                        value={m.role}
                        onChange={e => {
                          const role = e.target.value as ColumnRole;
                          const updates: Partial<ColumnMapping> = { role };
                          if (role === 'field') {
                            updates.fieldName = m.fieldName || m.csvHeader;
                            updates.showInSidebar = true;
                          }
                          if (role === 'formant') {
                            updates.formant = m.formant || 'f1';
                            updates.timePoint = m.timePoint ?? 50;
                            updates.isSmooth = m.isSmooth || false;
                          }
                          if (role === 'speaker' || role === 'file_id') {
                            // Clear any other column with this role
                            setMappings(prev => prev.map((pm, pi) => {
                              if (pi === idx) return { ...pm, ...updates, showInSidebar: true };
                              if (pm.role === role) return { ...pm, role: 'field' as ColumnRole, fieldName: pm.csvHeader, showInSidebar: true };
                              return pm;
                            }));
                            return;
                          }
                          if (role !== 'ignore' && role !== 'formant') {
                            updates.showInSidebar = true;
                          }
                          updateMapping(idx, updates);
                        }}
                      >
                        {ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
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
                          <span className="text-[10px] text-slate-400">@</span>
                          <input
                            type="number"
                            className="text-xs p-1 border border-slate-200 rounded w-14"
                            value={m.timePoint ?? 50}
                            onChange={e => updateMapping(idx, { timePoint: parseInt(e.target.value) || 0 })}
                            min={0}
                            max={100}
                          />
                          <span className="text-[10px] text-slate-400">%</span>
                          {m.formantLabel && (
                            <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">{m.formantLabel}</span>
                          )}
                        </div>
                      )}
                      {m.role === 'field' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            className="text-xs p-1 border border-slate-200 rounded w-40"
                            value={m.fieldName ?? m.csvHeader}
                            onChange={e => updateMapping(idx, { fieldName: e.target.value })}
                            placeholder="Display name"
                          />
                        </div>
                      )}
                      {(m.role === 'speaker' || m.role === 'file_id' || m.role === 'xmin' || m.role === 'duration') && (
                        <span className="text-[10px] text-slate-400 italic">auto-detected</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {(m.role === 'field' || m.role === 'speaker' || m.role === 'file_id') && (
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
            <Upload size={14} />
            Import Data
          </button>
        </div>

        {/* Fixed-position tooltip for Sidebar help */}
        {sidebarHelpRect && (
          <div
            className="fixed w-48 bg-slate-800 text-white text-[10px] font-normal normal-case tracking-normal p-2 rounded-lg shadow-lg z-[200] leading-relaxed pointer-events-none"
            style={{ top: sidebarHelpRect.bottom + 4, left: sidebarHelpRect.left + sidebarHelpRect.width / 2 - 96 }}
          >
            Tick to show this field as a filter in the sidebar. Can be changed after import.
          </div>
        )}
      </div>
    </div>
  );
};

export default DataMappingDialog;
