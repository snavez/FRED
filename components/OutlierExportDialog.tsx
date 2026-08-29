import React, { useMemo, useState } from 'react';
import { X, Download, AlertTriangle } from 'lucide-react';
import { DatasetMeta } from '../types';
import { listPointFields } from '../utils/filterFields';
import { buildCsv, downloadTextFile } from '../utils/csv';
import {
  AxisNames, EllipseOutlier, buildOutlierRows, outlierFileName, outlierSdLevels,
} from '../utils/outliers';

interface OutlierExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  outliers: EllipseOutlier[];
  /** Tokens tested — those plotted in a group large enough to have an ellipse. */
  checked: number;
  /** Groups too small to draw an ellipse around, so their tokens went unjudged. */
  skipped: { key: string; count: number }[];
  sd: number;
  axes: AxisNames;
  multiLayer: boolean;
  datasetMeta: DatasetMeta | null;
  /** Fields already chosen for point info — the natural default for identifying tokens. */
  pointInfoFields: string[];
}

const PREVIEW_ROWS = 8;

/**
 * Export the tokens lying outside the ellipse currently drawn, as a CSV to work through
 * — typically to re-check formant tracking token by token.
 *
 * The export is only useful if each row can be traced back to a recording, so the token
 * fields are chosen here: the point-info fields when they are set, otherwise whatever
 * the user picks before downloading.
 */
const OutlierExportDialog: React.FC<OutlierExportDialogProps> = ({
  isOpen, onClose, outliers, checked, skipped, sd, axes, multiLayer, datasetMeta, pointInfoFields,
}) => {
  const available = useMemo(() => listPointFields(datasetMeta), [datasetMeta]);
  const [selected, setSelected] = useState<string[] | null>(null);

  // Point-info fields are the starting selection; the user can change it here without
  // disturbing what the tooltips show. With none configured, the file id at least gets
  // them back to the recording — the point of the export.
  const configured = pointInfoFields.filter(k => available.some(f => f.key === k));
  const fallback = available.filter(f => f.key === 'file_id').map(f => f.key);
  const chosen = selected ?? (configured.length > 0 ? configured : fallback);
  const fields = available.filter(f => chosen.includes(f.key));

  if (!isOpen) return null;

  const toggle = (key: string) => {
    const next = chosen.includes(key) ? chosen.filter(k => k !== key) : [...chosen, key];
    setSelected(next);
  };

  const { headers, rows } = buildOutlierRows({ outliers, fields, axes, multiLayer });
  // Visible layers can be set to different ellipses; say so rather than quoting one.
  const levels = outlierSdLevels(outliers);
  const ellipseLabel = levels.length > 1 ? `${levels.join(' / ')} SD ellipses` : `${sd} SD ellipse`;
  const skippedTokens = skipped.reduce((a, g) => a + g.count, 0);

  const download = () => {
    downloadTextFile(outlierFileName(sd), buildCsv(headers, rows));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">Export outliers</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {outliers.length === 0
                ? `No tokens fall outside the ${sd} SD ellipse.`
                : `${outliers.length} of ${checked} plotted tokens fall outside the ${ellipseLabel} of their group.`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Token fields</span>
              <span className="text-[11px] text-slate-400">
                {fields.length > 0 ? 'Included in every row' : 'Choose what you need to find these tokens again'}
              </span>
            </div>
            {available.length === 0 ? (
              <p className="text-xs text-slate-500 italic">This dataset has no label columns to identify tokens by.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {available.map(f => {
                  const on = chosen.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => toggle(f.key)}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${on
                        ? 'bg-sky-100 border-sky-300 text-sky-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            )}
            {fields.length === 0 && available.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-700">
                <AlertTriangle size={12} />
                <span>Pick at least one field, or the rows cannot be traced back to a recording.</span>
              </div>
            )}
          </div>

          {skippedTokens > 0 && (
            <p className="text-[11px] text-slate-500">
              {skippedTokens} token{skippedTokens === 1 ? '' : 's'} in {skipped.length} group
              {skipped.length === 1 ? '' : 's'} could not be judged — a group needs at least 3 points
              before an ellipse is drawn around it.
            </p>
          )}

          {outliers.length > 0 && (
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Preview · first {Math.min(PREVIEW_ROWS, rows.length)} of {rows.length} rows
              </span>
              <div className="mt-2 overflow-x-auto border border-slate-200 rounded">
                <table className="text-[11px] w-full">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>{headers.map(h => <th key={h} className="text-left font-bold px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {r.map((c, j) => <td key={j} className="px-2 py-1 whitespace-nowrap text-slate-700">{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-400">
            {outlierFileName(sd)} · sorted by distance from the group mean
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold text-slate-600 rounded border border-slate-200 hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={download}
              disabled={rows.length === 0 || fields.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded bg-sky-700 hover:bg-sky-800 disabled:bg-slate-300"
            >
              <Download size={13} />
              Download CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OutlierExportDialog;
