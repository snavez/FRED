import React, { useMemo, useState } from 'react';
import { SpeechToken, PlotConfig, DatasetMeta } from '../types';
import { getLabel } from '../utils/getLabel';
import {
  runAnalysis, twoWayAnova, runContingencyAnalysis, sigStars, formatP,
  type AnalysisResult, type AnalysisError,
  type TwoWayAnovaResult, type ContingencyTableResult,
  type CellStats, type GroupStats,
} from '../services/statistics';

// ─────────────────────────────────────────────────────────────────
// Export Utilities
// ─────────────────────────────────────────────────────────────────

type TableRow = string[];

/** Copy tab-separated text to clipboard */
const copyToClipboard = (headers: string[], rows: TableRow[]) => {
  const text = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
  navigator.clipboard.writeText(text);
};

/** Generate LaTeX tabular string */
const toLatex = (headers: string[], rows: TableRow[]): string => {
  const cols = headers.length;
  const align = headers.map((_, i) => i === 0 ? 'l' : 'r').join('');
  const escTex = (s: string) => s.replace(/[&%$#_{}~^\\]/g, c => `\\${c}`).replace(/η²/g, '$\\eta^2$').replace(/χ²/g, '$\\chi^2$');
  const lines = [
    `\\begin{tabular}{${align}}`,
    '\\hline',
    headers.map(h => escTex(h)).join(' & ') + ' \\\\',
    '\\hline',
    ...rows.map(r => r.map(c => escTex(c)).join(' & ') + ' \\\\'),
    '\\hline',
    '\\end{tabular}',
  ];
  return lines.join('\n');
};

/** Download a string as a file */
const downloadFile = (content: string, filename: string, mime = 'text/csv') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Download CSV */
const downloadCsv = (headers: string[], rows: TableRow[], filename: string) => {
  const esc = (s: string) => s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  downloadFile(csv, filename);
};

/** Export buttons component */
const ExportButtons: React.FC<{ headers: string[]; rows: TableRow[]; filename: string; className?: string }> = ({ headers, rows, filename, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(headers, rows);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLatex = () => {
    const tex = toLatex(headers, rows);
    navigator.clipboard.writeText(tex);
  };

  const handleCsv = () => downloadCsv(headers, rows, filename);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button onClick={handleCopy} className="px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Copy tab-separated (paste into Excel)">
        {copied ? '\u2713 Copied' : 'Copy'}
      </button>
      <button onClick={handleLatex} className="px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Copy LaTeX tabular to clipboard">
        LaTeX
      </button>
      <button onClick={handleCsv} className="px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Download as CSV">
        CSV
      </button>
    </div>
  );
};

interface TablePanelProps {
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
  availableTimePoints: number[];
  variableOptions: { label: string; value: string }[];
  numericVariableOptions: { label: string; value: string }[];
}

/** Pretty label for a field key — mirrors MainDisplay's prettyLabel */
const prettyLabel = (key: string, meta?: DatasetMeta | null): string => {
  if (key === 'speaker') return 'Speaker';
  if (key === 'file_id') return 'File ID';
  if (key === 'duration') return 'Duration';
  if (meta) {
    for (const m of meta.columnMappings) {
      if ((m.role === 'field' || m.role === 'pitch') && (m.fieldName === key || m.csvHeader === key))
        return m.fieldName || m.csvHeader;
    }
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const FORMANT_VARS = new Set(['f1', 'f2', 'f3', 'f1_smooth', 'f2_smooth', 'f3_smooth']);

/** Find nearest available time point in a token's trajectory */
const findNearestTimePoint = (trajectory: { time: number }[], target: number): number | undefined => {
  if (trajectory.length === 0) return undefined;
  let nearest = trajectory[0].time;
  let minDist = Math.abs(nearest - target);
  for (const p of trajectory) {
    const d = Math.abs(p.time - target);
    if (d < minDist) { minDist = d; nearest = p.time; }
  }
  return nearest;
};

// ─────────────────────────────────────────────────────────────────
// Browse View
// ─────────────────────────────────────────────────────────────────

const BrowseView: React.FC<{
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
  availableTimePoints: number[];
}> = ({ data, config, datasetMeta, availableTimePoints }) => {
  const timePoint = config.tableFormantTime ?? 50;
  const expandAll = config.tableExpandTimePoints;
  const hasMultipleTimePoints = availableTimePoints.length > 1;
  const hasSmooth = datasetMeta?.columnMappings.some(m => m.role === 'formant' && m.isSmooth);
  const hasFormants = datasetMeta?.columnMappings.some(m => m.role === 'formant');

  // Build dynamic field columns from datasetMeta
  const fieldCols = useMemo(() => {
    const cols: { key: string; label: string; accessor: (t: SpeechToken) => string }[] = [];
    if (!datasetMeta) return cols;
    const seen = new Set<string>();
    for (const m of datasetMeta.columnMappings) {
      if (m.role === 'speaker' && !seen.has('speaker')) {
        seen.add('speaker');
        cols.push({ key: 'speaker', label: 'Speaker', accessor: t => t.speaker });
      } else if (m.role === 'file_id' && !seen.has('file_id')) {
        seen.add('file_id');
        cols.push({ key: 'file_id', label: 'File ID', accessor: t => t.file_id });
      } else if (m.role === 'field' && m.fieldName && !seen.has(m.fieldName)) {
        const fn = m.fieldName;
        seen.add(fn);
        cols.push({ key: fn, label: prettyLabel(fn, datasetMeta), accessor: t => t.fields[fn] ?? '' });
      }
    }
    return cols;
  }, [datasetMeta]);

  // Build formant column definitions
  const formantCols = useMemo(() => {
    if (!hasFormants) return [];
    type FormantCol = { key: string; label: string; accessor: (t: SpeechToken) => string };
    const cols: FormantCol[] = [];

    if (expandAll && hasMultipleTimePoints) {
      // Expanded: one column set per time point
      for (const tp of availableTimePoints) {
        for (const f of ['f1', 'f2', 'f3'] as const) {
          cols.push({
            key: `${f}_${tp}`,
            label: `${f.toUpperCase()} (${tp}%)`,
            accessor: (t: SpeechToken) => {
              const nearest = findNearestTimePoint(t.trajectory, tp);
              if (nearest === undefined) return '';
              const p = t.trajectory.find(pt => pt.time === nearest);
              return p ? Math.round(p[f]).toString() : '';
            }
          });
        }
        if (hasSmooth) {
          for (const f of ['f1_smooth', 'f2_smooth', 'f3_smooth'] as const) {
            const base = f.replace('_smooth', '').toUpperCase();
            cols.push({
              key: `${f}_${tp}`,
              label: `${base} sm (${tp}%)`,
              accessor: (t: SpeechToken) => {
                const nearest = findNearestTimePoint(t.trajectory, tp);
                if (nearest === undefined) return '';
                const p = t.trajectory.find(pt => pt.time === nearest);
                return p ? Math.round(p[f]).toString() : '';
              }
            });
          }
        }
      }
    } else {
      // Collapsed: single time point (selected or only one available)
      const tp = hasMultipleTimePoints ? timePoint : availableTimePoints[0] ?? 50;
      for (const f of ['f1', 'f2', 'f3'] as const) {
        cols.push({
          key: f,
          label: f.toUpperCase(),
          accessor: (t: SpeechToken) => {
            const nearest = findNearestTimePoint(t.trajectory, tp);
            if (nearest === undefined) return '';
            const p = t.trajectory.find(pt => pt.time === nearest);
            return p ? Math.round(p[f]).toString() : '';
          }
        });
      }
      if (hasSmooth) {
        for (const f of ['f1_smooth', 'f2_smooth', 'f3_smooth'] as const) {
          const base = f.replace('_smooth', '').toUpperCase();
          cols.push({
            key: f,
            label: `${base} (smooth)`,
            accessor: (t: SpeechToken) => {
              const nearest = findNearestTimePoint(t.trajectory, tp);
              if (nearest === undefined) return '';
              const p = t.trajectory.find(pt => pt.time === nearest);
              return p ? Math.round(p[f]).toString() : '';
            }
          });
        }
      }
    }
    return cols;
  }, [hasFormants, hasSmooth, expandAll, hasMultipleTimePoints, timePoint, availableTimePoints]);

  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-slate-400 text-sm italic">No data loaded</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-slate-50/90 backdrop-blur border-b border-slate-200 z-10">
          <tr>
            {fieldCols.map(col => (
              <th key={col.key} className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter">{col.label}</th>
            ))}
            <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">Duration (s)</th>
            {formantCols.map(col => (
              <th key={col.key} className="px-4 py-3 font-bold text-slate-500 uppercase tracking-tighter text-right">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.slice(0, 1000).map(token => (
            <tr key={token.id} className="hover:bg-sky-50/40 transition-colors">
              {fieldCols.map(col => (
                <td key={col.key} className="px-4 py-2 text-slate-700 font-medium">{col.accessor(token)}</td>
              ))}
              <td className="px-4 py-2 text-slate-600 text-right font-mono">{token.duration.toFixed(3)}</td>
              {formantCols.map(col => (
                <td key={col.key} className="px-4 py-2 text-slate-600 text-right font-mono">{col.accessor(token)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 1000 && (
        <div className="p-4 text-center text-slate-400 italic text-xs">
          Showing first 1,000 of {data.length.toLocaleString()} tokens.
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Summary View — Multi-Measure with Combined/Separate Layouts
// ─────────────────────────────────────────────────────────────────

interface GroupRow { name: string; n: number; mean: number; sd: number; median: number; iqr: number; min: number; max: number }
interface MeasureStats { measureField: string; measureLabel: string; groups: GroupRow[]; totalN: number }

/** Compute stats for one measure across groups */
const computeMeasureStats = (
  data: SpeechToken[], groupByField: string, measureField: string,
  formantTime: number, datasetMeta: DatasetMeta | null,
): MeasureStats | null => {
  const grouped = new Map<string, number[]>();
  for (const token of data) {
    const groupVal = getLabel(token, groupByField);
    if (!groupVal) continue;
    const numVal = getNumericValue(token, measureField, formantTime);
    if (isNaN(numVal)) continue;
    if (!grouped.has(groupVal)) grouped.set(groupVal, []);
    grouped.get(groupVal)!.push(numVal);
  }

  const groups: GroupRow[] = [];
  for (const [name, values] of grouped) {
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;
    const sum = values.reduce((s, v) => s + v, 0);
    const m = sum / n;
    const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (n > 1 ? n - 1 : 1);
    const mid = Math.floor(n / 2);
    const med = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    groups.push({ name, n, mean: m, sd: Math.sqrt(v), median: med, iqr: q3 - q1, min: sorted[0], max: sorted[n - 1] });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  if (groups.length === 0) return null;

  return {
    measureField,
    measureLabel: prettyLabel(measureField, datasetMeta),
    groups,
    totalN: groups.reduce((s, r) => s + r.n, 0),
  };
};

const SummaryView: React.FC<{
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
  availableTimePoints: number[];
}> = ({ data, config, datasetMeta }) => {
  const groupByField = config.tableSummaryGroupBy || 'none';
  const measures = config.tableSummaryMeasures || ['duration'];
  const layout = config.tableSummaryLayout || 'separate';
  const formantTime = config.tableFormantTime ?? 50;
  const groupLabel = prettyLabel(groupByField, datasetMeta);

  // Compute stats for all measures
  const allMeasureStats = useMemo<MeasureStats[] | null>(() => {
    if (groupByField === 'none' || data.length === 0) return null;
    const results: MeasureStats[] = [];
    for (const mf of measures) {
      const ms = computeMeasureStats(data, groupByField, mf, formantTime, datasetMeta);
      if (ms) results.push(ms);
    }
    return results.length > 0 ? results : null;
  }, [data, groupByField, measures, formantTime, datasetMeta]);

  // Prompt state
  if (groupByField === 'none') {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
        Select a Group By variable and Measures in the config bar above.
      </div>
    );
  }

  if (!allMeasureStats || allMeasureStats.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
        No data available for summary.
      </div>
    );
  }

  // Single measure or separate layout → full-stats tables
  if (allMeasureStats.length === 1 || layout === 'separate') {
    return (
      <div className="h-full overflow-auto p-6 space-y-6">
        {allMeasureStats.map(ms => {
          const headers = [groupLabel, 'n', 'Mean', 'SD', 'Median', 'IQR', 'Min', 'Max'];
          const rows: TableRow[] = ms.groups.map(g => [g.name, g.n.toString(), g.mean.toFixed(3), g.sd.toFixed(3), g.median.toFixed(3), g.iqr.toFixed(3), g.min.toFixed(3), g.max.toFixed(3)]);
          return (
            <div key={ms.measureField}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {ms.measureLabel} by {groupLabel}
                </h3>
                <ExportButtons headers={headers} rows={rows} filename={`summary_${ms.measureLabel}_by_${groupLabel}.csv`} />
              </div>
              <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={TH}>{groupLabel}</th>
                    <th className={`${TH} text-right`}>n</th>
                    <th className={`${TH} text-right`}>Mean</th>
                    <th className={`${TH} text-right`}>SD</th>
                    <th className={`${TH} text-right`}>Median</th>
                    <th className={`${TH} text-right`}>IQR</th>
                    <th className={`${TH} text-right`}>Min</th>
                    <th className={`${TH} text-right`}>Max</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ms.groups.map(g => (
                    <tr key={g.name} className="hover:bg-sky-50/40 transition-colors">
                      <td className={TD_LEFT}>{g.name}</td>
                      <td className={`${TD} text-right`}>{g.n}</td>
                      <td className={`${TD} text-right`}>{g.mean.toFixed(3)}</td>
                      <td className={`${TD} text-right`}>{g.sd.toFixed(3)}</td>
                      <td className={`${TD} text-right`}>{g.median.toFixed(3)}</td>
                      <td className={`${TD} text-right`}>{g.iqr.toFixed(3)}</td>
                      <td className={`${TD} text-right`}>{g.min.toFixed(3)}</td>
                      <td className={`${TD} text-right`}>{g.max.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td className={`${TD_LEFT} font-bold`}>Total</td>
                    <td className={`${TD} text-right font-bold`}>{ms.totalN}</td>
                    <td className={TD} colSpan={6}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  // Combined layout → one wide table with Mean+SD per measure
  // Build a unified group list (union of all group names across measures)
  const groupNames = Array.from(new Set(allMeasureStats.flatMap(ms => ms.groups.map(g => g.name)))).sort();
  // Build lookup: measureField → { groupName → GroupRow }
  const lookups = allMeasureStats.map(ms => {
    const map = new Map<string, GroupRow>();
    for (const g of ms.groups) map.set(g.name, g);
    return { measureLabel: ms.measureLabel, measureField: ms.measureField, map };
  });

  // Export data for combined table
  const combinedHeaders = [groupLabel, 'n', ...allMeasureStats.flatMap(ms => [`${ms.measureLabel} Mean`, `${ms.measureLabel} SD`])];
  const combinedRows: TableRow[] = groupNames.map(name => {
    const first = lookups[0].map.get(name);
    const n = first?.n ?? 0;
    return [
      name,
      n.toString(),
      ...lookups.flatMap(lk => {
        const g = lk.map.get(name);
        return g ? [g.mean.toFixed(3), g.sd.toFixed(3)] : ['—', '—'];
      }),
    ];
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          Summary by {groupLabel}
        </h3>
        <ExportButtons headers={combinedHeaders} rows={combinedRows} filename={`summary_combined_by_${groupLabel}.csv`} />
      </div>
      <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 border-b border-slate-200">
          {/* Row 1: Measure group headers */}
          <tr>
            <th className={TH} rowSpan={2}>{groupLabel}</th>
            <th className={`${TH} text-right`} rowSpan={2}>n</th>
            {allMeasureStats.map(ms => (
              <th key={ms.measureField} className={`${TH} text-center border-l border-slate-200`} colSpan={2}>
                {ms.measureLabel}
              </th>
            ))}
          </tr>
          {/* Row 2: Mean / SD sub-headers */}
          <tr>
            {allMeasureStats.map(ms => (
              <React.Fragment key={ms.measureField}>
                <th className={`${TH} text-right border-l border-slate-200`}>Mean</th>
                <th className={`${TH} text-right`}>SD</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {groupNames.map(name => {
            const first = lookups[0].map.get(name);
            return (
              <tr key={name} className="hover:bg-sky-50/40 transition-colors">
                <td className={TD_LEFT}>{name}</td>
                <td className={`${TD} text-right`}>{first?.n ?? '—'}</td>
                {lookups.map(lk => {
                  const g = lk.map.get(name);
                  return (
                    <React.Fragment key={lk.measureField}>
                      <td className={`${TD} text-right border-l border-slate-100`}>{g ? g.mean.toFixed(3) : '—'}</td>
                      <td className={`${TD} text-right`}>{g ? g.sd.toFixed(3) : '—'}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-slate-50 border-t border-slate-200">
          <tr>
            <td className={`${TD_LEFT} font-bold`}>Total</td>
            <td className={`${TD} text-right font-bold`}>{allMeasureStats[0]?.totalN ?? 0}</td>
            <td className={TD} colSpan={allMeasureStats.length * 2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Analysis View
// ─────────────────────────────────────────────────────────────────

/** Extract a numeric value from a token for a given field key */
const getNumericValue = (t: SpeechToken, field: string, formantTime: number): number => {
  if (field === 'duration') return t.duration;
  if (field === 'xmin') return t.xmin;
  if (FORMANT_VARS.has(field)) {
    if (!t.trajectory || t.trajectory.length === 0) return NaN;
    const nearest = findNearestTimePoint(t.trajectory, formantTime);
    if (nearest === undefined) return NaN;
    const point = t.trajectory.find(p => p.time === nearest);
    if (!point) return NaN;
    return (point as any)[field] ?? NaN;
  }
  const raw = t.fields[field];
  return raw !== undefined ? parseFloat(raw) : NaN;
};

const TH = 'px-3 py-2 font-bold text-slate-500 uppercase tracking-tighter text-[11px]';
const TD = 'px-3 py-1.5 text-slate-700 text-[12px] font-mono';
const TD_LEFT = 'px-3 py-1.5 text-slate-700 text-[12px] font-medium';

// ── Shared: Test Result Card ──
const TestResultCard: React.FC<{ testResult: { testName: string; statistic: number; statisticName: string; df: number | [number, number]; pValue: number; effectSize: { name: string; value: number; magnitude: string }; reasoning: string }; alpha: number }> = ({ testResult, alpha }) => (
  <div className="bg-sky-50 border border-sky-200 rounded-lg p-5">
    <div className="flex items-center gap-3 mb-3">
      <h3 className="text-sm font-bold text-sky-900">{testResult.testName}</h3>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${testResult.pValue < alpha ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        {testResult.pValue < alpha ? 'Significant' : 'Not significant'}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12px] text-slate-700">
      <div><span className="text-slate-500 font-medium">Statistic:</span> {testResult.statisticName} = {testResult.statistic.toFixed(3)}</div>
      <div><span className="text-slate-500 font-medium">df:</span> {Array.isArray(testResult.df) ? `${testResult.df[0]}, ${testResult.df[1]}` : isNaN(testResult.df) ? '\u2014' : testResult.df.toFixed(1)}</div>
      <div><span className="text-slate-500 font-medium">p-value:</span> <span className="font-mono">{formatP(testResult.pValue)}</span> <span className="font-bold text-slate-500">{sigStars(testResult.pValue)}</span></div>
      <div><span className="text-slate-500 font-medium">Effect size:</span> {testResult.effectSize.name} = {testResult.effectSize.value.toFixed(3)} <span className="text-slate-400">({testResult.effectSize.magnitude})</span></div>
    </div>
    <div className="mt-3 text-[11px] text-slate-500 italic border-t border-sky-200 pt-2">{testResult.reasoning}</div>
  </div>
);

// ── Shared: Post-Hoc Table ──
const PostHocTable: React.FC<{ postHoc: { pair: [string, string]; meanDiff: number; statistic: number; pValue: number; significant: boolean }[]; filename: string }> = ({ postHoc, filename }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Post-Hoc Pairwise Comparisons</h3>
      <ExportButtons headers={['Pair', 'Mean Diff', 'Statistic', 'p-value', 'Sig']} rows={postHoc.map(ph => [`${ph.pair[0]} vs ${ph.pair[1]}`, ph.meanDiff.toFixed(3), ph.statistic.toFixed(3), formatP(ph.pValue), sigStars(ph.pValue)])} filename={filename} />
    </div>
    <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr>
          <th className={TH}>Pair</th>
          <th className={`${TH} text-right`}>Mean Diff</th>
          <th className={`${TH} text-right`}>Statistic</th>
          <th className={`${TH} text-right`}>p-value</th>
          <th className={`${TH} text-center`}>Sig</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {postHoc.map((ph, i) => (
          <tr key={i} className={ph.significant ? 'bg-emerald-50/40' : ''}>
            <td className={TD_LEFT}>{ph.pair[0]} vs {ph.pair[1]}</td>
            <td className={`${TD} text-right`}>{ph.meanDiff.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{ph.statistic.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{formatP(ph.pValue)} {sigStars(ph.pValue)}</td>
            <td className={`${TD} text-center`}>{ph.significant ? <span className="text-emerald-600 font-bold">{sigStars(ph.pValue)}</span> : <span className="text-slate-400">ns</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ── One-Way Analysis Results (reused by multi-DV) ──
const OneWayResults: React.FC<{ result: AnalysisResult; dvLabel: string; alpha: number }> = ({ result, dvLabel, alpha }) => {
  const [showDiag, setShowDiag] = useState(true);
  const { groupStats, normalityTests, varianceTest, testResult, postHoc } = result;
  return (
    <div className="space-y-5">
      <GroupStatsTable stats={groupStats} dvLabel={dvLabel} />
      <div>
        <button className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-700 transition-colors" onClick={() => setShowDiag(d => !d)}>
          <span className="text-[10px]">{showDiag ? '\u25BC' : '\u25B6'}</span> Diagnostics
        </button>
        {showDiag && (
          <div className="space-y-3">
            <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 border-b border-slate-200"><tr><th className={TH}>Group</th><th className={`${TH} text-right`}>n</th><th className={`${TH} text-right`}>Shapiro-Wilk W</th><th className={`${TH} text-right`}>p-value</th><th className={`${TH} text-center`}>Normal?</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {normalityTests.map(nt => (
                  <tr key={nt.group}><td className={TD_LEFT}>{nt.group}</td><td className={`${TD} text-right`}>{groupStats.find(g => g.name === nt.group)?.n ?? ''}</td><td className={`${TD} text-right`}>{nt.W.toFixed(4)}</td><td className={`${TD} text-right`}>{formatP(nt.pValue)}</td><td className={`${TD} text-center`}><span className={nt.isNormal ? 'text-emerald-600' : 'text-red-500'}>{nt.isNormal ? '\u2713' : '\u2717'}</span></td></tr>
                ))}
              </tbody>
            </table>
            {varianceTest && (
              <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                <span className="font-bold text-slate-500 uppercase text-[10px] mr-2">Levene{"'"}s Test:</span>
                F({varianceTest.df1}, {varianceTest.df2}) = {varianceTest.F.toFixed(3)}, p = {formatP(varianceTest.pValue)}
                <span className="ml-2">{varianceTest.isEqual ? <span className="text-emerald-600">{'\u2713'} Equal variances</span> : <span className="text-red-500">{'\u2717'} Unequal variances</span>}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <TestResultCard testResult={testResult} alpha={alpha} />
      {postHoc && postHoc.length > 0 && <PostHocTable postHoc={postHoc} filename={`posthoc_${dvLabel}.csv`} />}
    </div>
  );
};

// ── Two-Way ANOVA Results ──
const TwoWayResults: React.FC<{ result: TwoWayAnovaResult; dvLabel: string; factorALabel: string; factorBLabel: string; alpha: number }> = (props) => {
  const { dvLabel, factorALabel, factorBLabel, alpha } = props;
  const r = props.result;
  const [showDiag, setShowDiag] = useState(false);
  const effects = r.effects;
  const normalityTest = r.normalityTest;
  const varianceTest = r.varianceTest;
  const postHocA = r.postHocA;
  const postHocB = r.postHocB;
  const simpleEffectsA = r.simpleEffectsA;
  const simpleEffectsB = r.simpleEffectsB;
  const N = r.N;
  const warnings = r.warnings;

  // Build cell means table
  const cells = r.cellStats as CellStats[];
  const levelsA: string[] = [...new Set(cells.map(c => c.factorA))];
  const levelsB: string[] = [...new Set(cells.map(c => c.factorB))];
  const cellLookup = new Map<string, CellStats>(cells.map(c => [c.factorA + '|' + c.factorB, c]));
  const margAMap = new Map<string, GroupStats>(r.marginalStatsA.map(s => [s.name, s]));
  const margBMap = new Map<string, GroupStats>(r.marginalStatsB.map(s => [s.name, s]));

  // ANOVA table export
  const anovaHeaders = ['Source', 'SS', 'df', 'MS', 'F', 'p', 'partial η²', 'Sig'];
  const anovaRows: TableRow[] = effects.map(e => [
    e.source === 'Factor A' ? factorALabel : e.source === 'Factor B' ? factorBLabel : e.source === 'A × B' ? `${factorALabel} × ${factorBLabel}` : e.source,
    e.ss.toFixed(3), e.df.toString(), isNaN(e.ms) ? '' : e.ms.toFixed(3),
    isNaN(e.F) ? '' : e.F.toFixed(3), isNaN(e.pValue) ? '' : formatP(e.pValue),
    isNaN(e.partialEtaSq) ? '' : e.partialEtaSq.toFixed(3), isNaN(e.pValue) ? '' : sigStars(e.pValue),
  ]);

  return (
    <div className="space-y-5">
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {/* Cell Means Table */}
      <div>
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Cell Means — {dvLabel}</h3>
        <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className={TH}>{factorALabel} \ {factorBLabel}</th>
              {levelsB.map(lb => <th key={lb} className={`${TH} text-right`}>{lb}</th>)}
              <th className={`${TH} text-right border-l border-slate-300`}>Marginal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {levelsA.map(la => (
              <tr key={la}>
                <td className={TD_LEFT}>{la}</td>
                {levelsB.map(lb => {
                  const c = cellLookup.get(`${la}|${lb}`);
                  return <td key={lb} className={`${TD} text-right`}>{c ? `${c.mean.toFixed(2)} (${c.sd.toFixed(2)}) n=${c.n}` : '—'}</td>;
                })}
                <td className={`${TD} text-right border-l border-slate-200 font-medium`}>{margAMap.get(la)?.mean.toFixed(2) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200">
            <tr>
              <td className={`${TD_LEFT} font-bold`}>Marginal</td>
              {levelsB.map(lb => <td key={lb} className={`${TD} text-right font-medium`}>{margBMap.get(lb)?.mean.toFixed(2) ?? '—'}</td>)}
              <td className={`${TD} text-right border-l border-slate-300 font-bold`}>N={N}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ANOVA Table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ANOVA Table (Type III SS)</h3>
          <ExportButtons headers={anovaHeaders} rows={anovaRows} filename={`anova_${dvLabel}.csv`} />
        </div>
        <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className={TH}>Source</th>
              <th className={`${TH} text-right`}>SS</th>
              <th className={`${TH} text-right`}>df</th>
              <th className={`${TH} text-right`}>MS</th>
              <th className={`${TH} text-right`}>F</th>
              <th className={`${TH} text-right`}>p</th>
              <th className={`${TH} text-right`}>partial {'\u03B7\u00B2'}</th>
              <th className={`${TH} text-center`}>Sig</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {effects.map((e, i) => {
              const label = e.source === 'Factor A' ? factorALabel : e.source === 'Factor B' ? factorBLabel : e.source === 'A × B' ? `${factorALabel} × ${factorBLabel}` : e.source;
              const isSig = !isNaN(e.pValue) && e.pValue < alpha;
              return (
                <tr key={i} className={isSig ? 'bg-emerald-50/40' : ''}>
                  <td className={TD_LEFT}>{label}</td>
                  <td className={`${TD} text-right`}>{e.ss.toFixed(3)}</td>
                  <td className={`${TD} text-right`}>{e.df}</td>
                  <td className={`${TD} text-right`}>{isNaN(e.ms) ? '' : e.ms.toFixed(3)}</td>
                  <td className={`${TD} text-right`}>{isNaN(e.F) ? '' : e.F.toFixed(3)}</td>
                  <td className={`${TD} text-right`}>{isNaN(e.pValue) ? '' : `${formatP(e.pValue)} ${sigStars(e.pValue)}`}</td>
                  <td className={`${TD} text-right`}>{isNaN(e.partialEtaSq) ? '' : `${e.partialEtaSq.toFixed(3)} (${e.magnitude})`}</td>
                  <td className={`${TD} text-center`}>{isNaN(e.pValue) ? '' : isSig ? <span className="text-emerald-600 font-bold">{sigStars(e.pValue)}</span> : <span className="text-slate-400">ns</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Diagnostics */}
      <div>
        <button className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-700 transition-colors" onClick={() => setShowDiag(d => !d)}>
          <span className="text-[10px]">{showDiag ? '\u25BC' : '\u25B6'}</span> Diagnostics
        </button>
        {showDiag && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
              <span className="font-bold text-slate-500 uppercase text-[10px] mr-2">Shapiro-Wilk (residuals):</span>
              W = {normalityTest.W.toFixed(4)}, p = {formatP(normalityTest.pValue)}
              <span className="ml-2">{normalityTest.isNormal ? <span className="text-emerald-600">{'\u2713'} Normal</span> : <span className="text-red-500">{'\u2717'} Non-normal</span>}</span>
            </div>
            <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
              <span className="font-bold text-slate-500 uppercase text-[10px] mr-2">Levene{"'"}s Test:</span>
              F({varianceTest.df1}, {varianceTest.df2}) = {varianceTest.F.toFixed(3)}, p = {formatP(varianceTest.pValue)}
              <span className="ml-2">{varianceTest.isEqual ? <span className="text-emerald-600">{'\u2713'} Equal variances</span> : <span className="text-red-500">{'\u2717'} Unequal variances</span>}</span>
            </div>
          </div>
        )}
      </div>

      {/* Post-hoc for main effects */}
      {postHocA && postHocA.length > 0 && <PostHocTable postHoc={postHocA} filename={`posthoc_${factorALabel}.csv`} />}
      {postHocB && postHocB.length > 0 && <PostHocTable postHoc={postHocB} filename={`posthoc_${factorBLabel}.csv`} />}

      {/* Simple Effects (when interaction is significant) */}
      {simpleEffectsA && simpleEffectsA.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Simple Effects: {factorALabel} at each level of {factorBLabel}</h3>
          <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr><th className={TH}>{factorBLabel} Level</th><th className={TH}>Test</th><th className={`${TH} text-right`}>Statistic</th><th className={`${TH} text-right`}>p</th><th className={`${TH} text-right`}>Effect Size</th><th className={`${TH} text-center`}>Sig</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {simpleEffectsA.map(se => (
                <tr key={se.level} className={se.pValue < alpha ? 'bg-emerald-50/40' : ''}>
                  <td className={TD_LEFT}>{se.level}</td>
                  <td className={TD_LEFT}>{se.testName}</td>
                  <td className={`${TD} text-right`}>{isNaN(se.statistic) ? '—' : `${se.statisticName}=${se.statistic.toFixed(3)}`}</td>
                  <td className={`${TD} text-right`}>{isNaN(se.pValue) ? '—' : `${formatP(se.pValue)} ${sigStars(se.pValue)}`}</td>
                  <td className={`${TD} text-right`}>{se.effectSize.name ? `${se.effectSize.name}=${se.effectSize.value.toFixed(3)}` : '—'}</td>
                  <td className={`${TD} text-center`}>{!isNaN(se.pValue) && se.pValue < alpha ? <span className="text-emerald-600 font-bold">{sigStars(se.pValue)}</span> : <span className="text-slate-400">ns</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {simpleEffectsB && simpleEffectsB.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Simple Effects: {factorBLabel} at each level of {factorALabel}</h3>
          <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr><th className={TH}>{factorALabel} Level</th><th className={TH}>Test</th><th className={`${TH} text-right`}>Statistic</th><th className={`${TH} text-right`}>p</th><th className={`${TH} text-right`}>Effect Size</th><th className={`${TH} text-center`}>Sig</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {simpleEffectsB.map(se => (
                <tr key={se.level} className={se.pValue < alpha ? 'bg-emerald-50/40' : ''}>
                  <td className={TD_LEFT}>{se.level}</td>
                  <td className={TD_LEFT}>{se.testName}</td>
                  <td className={`${TD} text-right`}>{isNaN(se.statistic) ? '—' : `${se.statisticName}=${se.statistic.toFixed(3)}`}</td>
                  <td className={`${TD} text-right`}>{isNaN(se.pValue) ? '—' : `${formatP(se.pValue)} ${sigStars(se.pValue)}`}</td>
                  <td className={`${TD} text-right`}>{se.effectSize.name ? `${se.effectSize.name}=${se.effectSize.value.toFixed(3)}` : '—'}</td>
                  <td className={`${TD} text-center`}>{!isNaN(se.pValue) && se.pValue < alpha ? <span className="text-emerald-600 font-bold">{sigStars(se.pValue)}</span> : <span className="text-slate-400">ns</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Categorical Analysis View ──
const CategoricalAnalysisView: React.FC<{
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
}> = ({ data, config, datasetMeta }) => {
  const [showExpected, setShowExpected] = useState(false);
  const var1 = config.tableAnalysisCatVar1 || 'none';
  const var2 = config.tableAnalysisCatVar2 || 'none';
  const alpha = config.tableAlpha ?? 0.05;
  const var1Label = prettyLabel(var1, datasetMeta);
  const var2Label = prettyLabel(var2, datasetMeta);

  const result = useMemo<ContingencyTableResult | AnalysisError | null>(() => {
    if (var1 === 'none' || var2 === 'none' || data.length === 0) return null;
    const v1: string[] = [], v2: string[] = [];
    for (const t of data) {
      const a = getLabel(t, var1), b = getLabel(t, var2);
      if (a && b) { v1.push(a); v2.push(b); }
    }
    if (v1.length < 4) return { error: 'Need at least 4 observations with valid values for both variables.' };
    return runContingencyAnalysis(v1, v2, alpha);
  }, [data, var1, var2, alpha]);

  if (var1 === 'none' || var2 === 'none') {
    return <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">Select Row Variable and Column Variable in the config bar above.</div>;
  }
  if (!result) return <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">No data available.</div>;
  if ('error' in result && !('testResult' in result)) return <div className="h-full overflow-auto p-6"><div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">{(result as AnalysisError).error}</div></div>;

  const ct = result as ContingencyTableResult;

  // Export data
  const obsHeaders = [var1Label, ...ct.colLabels, 'Total'];
  const obsRows: TableRow[] = ct.observed.map((row, i) => [ct.rowLabels[i], ...row.map(String), ct.rowTotals[i].toString()]);
  obsRows.push(['Total', ...ct.colTotals.map(String), ct.grandTotal.toString()]);

  return (
    <div className="h-full overflow-auto p-6 space-y-5">
      {ct.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs">{ct.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
      )}

      {/* Observed Counts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Observed Counts: {var1Label} × {var2Label}</h3>
          <ExportButtons headers={obsHeaders} rows={obsRows} filename={`contingency_${var1Label}_${var2Label}.csv`} />
        </div>
        <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr><th className={TH}>{var1Label} \ {var2Label}</th>{ct.colLabels.map(c => <th key={c} className={`${TH} text-right`}>{c}</th>)}<th className={`${TH} text-right border-l border-slate-300`}>Total</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ct.observed.map((row, i) => (
              <tr key={i}><td className={TD_LEFT}>{ct.rowLabels[i]}</td>{row.map((v, j) => <td key={j} className={`${TD} text-right`}>{v}</td>)}<td className={`${TD} text-right border-l border-slate-200 font-medium`}>{ct.rowTotals[i]}</td></tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200">
            <tr><td className={`${TD_LEFT} font-bold`}>Total</td>{ct.colTotals.map((v, j) => <td key={j} className={`${TD} text-right font-medium`}>{v}</td>)}<td className={`${TD} text-right border-l border-slate-300 font-bold`}>{ct.grandTotal}</td></tr>
          </tfoot>
        </table>
      </div>

      {/* Expected Counts (collapsible) */}
      <div>
        <button className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-700 transition-colors" onClick={() => setShowExpected(e => !e)}>
          <span className="text-[10px]">{showExpected ? '\u25BC' : '\u25B6'}</span> Expected Counts
        </button>
        {showExpected && (
          <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr><th className={TH}>{var1Label} \ {var2Label}</th>{ct.colLabels.map(c => <th key={c} className={`${TH} text-right`}>{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ct.expected.map((row, i) => (
                <tr key={i}><td className={TD_LEFT}>{ct.rowLabels[i]}</td>{row.map((v, j) => <td key={j} className={`${TD} text-right ${v < 5 ? 'text-amber-600 font-bold' : ''}`}>{v.toFixed(1)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Standardized Residuals */}
      <div>
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Adjusted Standardized Residuals</h3>
        <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr><th className={TH}>{var1Label} \ {var2Label}</th>{ct.colLabels.map(c => <th key={c} className={`${TH} text-right`}>{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ct.standardizedResiduals.map((row, i) => (
              <tr key={i}><td className={TD_LEFT}>{ct.rowLabels[i]}</td>{row.map((v, j) => {
                const abs = Math.abs(v);
                const cls = abs > 3 ? 'text-red-600 font-bold' : abs > 2 ? 'text-amber-600 font-bold' : '';
                return <td key={j} className={`${TD} text-right ${cls}`}>{v.toFixed(2)}{abs > 2 ? ' *' : ''}</td>;
              })}</tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-slate-400 mt-1 italic">* |residual| &gt; 2 indicates significantly more/fewer observations than expected</div>
      </div>

      {/* Test Result */}
      <TestResultCard testResult={ct.testResult} alpha={alpha} />
    </div>
  );
};

// ── Continuous Analysis View (multi-DV with one-way/two-way routing) ──
const ContinuousAnalysisView: React.FC<{
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
}> = ({ data, config, datasetMeta }) => {
  const measures = config.tableAnalysisMeasures || ['duration'];
  const groupByField = config.tableAnalysisGroupBy || 'none';
  const groupBy2Field = config.tableAnalysisGroupBy2 || 'none';
  const formantTime = config.tableAnalysisFormantTime ?? 50;
  const alpha = config.tableAlpha ?? 0.05;
  const isTwoWay = groupBy2Field !== 'none';
  const factorALabel = prettyLabel(groupByField, datasetMeta);
  const factorBLabel = prettyLabel(groupBy2Field, datasetMeta);

  // Collapsible sections for multi-DV
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Compute results for all measures
  const results = useMemo(() => {
    if (groupByField === 'none' || data.length === 0) return null;
    return measures.map(dvField => {
      const dvLabel = prettyLabel(dvField, datasetMeta);
      if (isTwoWay) {
        // Two-way: build { value, factorA, factorB }[] data
        const twoWayData: { value: number; factorA: string; factorB: string }[] = [];
        for (const token of data) {
          const a = getLabel(token, groupByField);
          const b = getLabel(token, groupBy2Field);
          if (!a || !b) continue;
          const v = getNumericValue(token, dvField, formantTime);
          if (!isNaN(v)) twoWayData.push({ value: v, factorA: a, factorB: b });
        }
        if (twoWayData.length < 6) return { dvField, dvLabel, result: { error: 'Need at least 6 observations.' } as AnalysisError, isTwoWay: true };
        const anovaResult = twoWayAnova(twoWayData, alpha);
        return { dvField, dvLabel, result: anovaResult, isTwoWay: true };
      } else {
        // One-way: existing logic
        const grouped = new Map<string, number[]>();
        for (const token of data) {
          const groupVal = getLabel(token, groupByField);
          if (!groupVal) continue;
          const v = getNumericValue(token, dvField, formantTime);
          if (isNaN(v)) continue;
          if (!grouped.has(groupVal)) grouped.set(groupVal, []);
          grouped.get(groupVal)!.push(v);
        }
        if (grouped.size < 2) return { dvField, dvLabel, result: { error: `Need at least 2 groups. Found ${grouped.size}.` } as AnalysisError, isTwoWay: false };
        return { dvField, dvLabel, result: runAnalysis(grouped, alpha), isTwoWay: false };
      }
    });
  }, [data, measures, groupByField, groupBy2Field, formantTime, alpha, datasetMeta, isTwoWay]);

  if (groupByField === 'none') {
    return <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">Select Measures and Factor A in the config bar above to run analysis.</div>;
  }
  if (!results) return <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">No data available for analysis.</div>;

  const multiDV = measures.length > 1;

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {results.map(({ dvField, dvLabel, result, isTwoWay: is2w }) => {
        const isCollapsed = collapsed[dvField] ?? false;
        const isError = 'error' in result && !('testResult' in result) && !('effects' in result);

        return (
          <div key={dvField} className={multiDV ? 'border border-slate-200 rounded-lg p-4' : ''}>
            {multiDV && (
              <button
                className="flex items-center gap-2 text-[12px] font-bold text-slate-700 mb-3 hover:text-sky-700 transition-colors w-full text-left"
                onClick={() => setCollapsed(c => ({ ...c, [dvField]: !c[dvField] }))}
              >
                <span className="text-[10px]">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                {dvLabel}
                {!isError && !isCollapsed && (
                  <span className="text-slate-400 font-normal ml-2">
                    {is2w ? 'Two-Way ANOVA' : 'One-Way Analysis'}
                  </span>
                )}
              </button>
            )}
            {!isCollapsed && (
              isError
                ? <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">{(result as AnalysisError).error}</div>
                : is2w
                  ? <TwoWayResults result={result as TwoWayAnovaResult} dvLabel={dvLabel} factorALabel={factorALabel} factorBLabel={factorBLabel} alpha={alpha} />
                  : <OneWayResults result={result as AnalysisResult} dvLabel={dvLabel} alpha={alpha} />
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Main Analysis Router ──
const AnalysisView: React.FC<{
  data: SpeechToken[];
  config: PlotConfig;
  datasetMeta: DatasetMeta | null;
  availableTimePoints: number[];
  variableOptions: { label: string; value: string }[];
  numericVariableOptions: { label: string; value: string }[];
}> = ({ data, config, datasetMeta }) => {
  const analysisType = config.tableAnalysisType || 'continuous';

  if (analysisType === 'categorical') {
    return <CategoricalAnalysisView data={data} config={config} datasetMeta={datasetMeta} />;
  }
  return <ContinuousAnalysisView data={data} config={config} datasetMeta={datasetMeta} />;
};

/** Reusable group stats table */
const GroupStatsTable: React.FC<{ stats: { name: string; n: number; mean: number; sd: number; median: number; iqr: number; min: number; max: number }[]; dvLabel: string }> = ({ stats, dvLabel }) => {
  const headers = ['Group', 'n', 'Mean', 'SD', 'Median', 'IQR', 'Min', 'Max'];
  const rows: TableRow[] = stats.map(g => [g.name, g.n.toString(), g.mean.toFixed(3), g.sd.toFixed(3), g.median.toFixed(3), g.iqr.toFixed(3), g.min.toFixed(3), g.max.toFixed(3)]);
  return (
  <div>
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
        Group Summary — {dvLabel}
      </h3>
      <ExportButtons headers={headers} rows={rows} filename={`group_summary_${dvLabel}.csv`} />
    </div>
    <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr>
          <th className={TH}>Group</th>
          <th className={`${TH} text-right`}>n</th>
          <th className={`${TH} text-right`}>Mean</th>
          <th className={`${TH} text-right`}>SD</th>
          <th className={`${TH} text-right`}>Median</th>
          <th className={`${TH} text-right`}>IQR</th>
          <th className={`${TH} text-right`}>Min</th>
          <th className={`${TH} text-right`}>Max</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {stats.map(g => (
          <tr key={g.name}>
            <td className={TD_LEFT}>{g.name}</td>
            <td className={`${TD} text-right`}>{g.n}</td>
            <td className={`${TD} text-right`}>{g.mean.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{g.sd.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{g.median.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{g.iqr.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{g.min.toFixed(3)}</td>
            <td className={`${TD} text-right`}>{g.max.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Main TablePanel
// ─────────────────────────────────────────────────────────────────

const TablePanel: React.FC<TablePanelProps> = ({
  data, config, datasetMeta, availableTimePoints, variableOptions, numericVariableOptions
}) => {
  const mode = config.tableMode || 'browse';

  if (mode === 'summary') {
    return <SummaryView data={data} config={config} datasetMeta={datasetMeta} availableTimePoints={availableTimePoints} />;
  }
  if (mode === 'analysis') {
    return (
      <AnalysisView
        data={data}
        config={config}
        datasetMeta={datasetMeta}
        availableTimePoints={availableTimePoints}
        variableOptions={variableOptions}
        numericVariableOptions={numericVariableOptions}
      />
    );
  }
  return (
    <BrowseView
      data={data}
      config={config}
      datasetMeta={datasetMeta}
      availableTimePoints={availableTimePoints}
    />
  );
};

export default TablePanel;
