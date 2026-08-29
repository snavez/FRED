/** Building and saving CSV text — shared by every data export FRED offers. */

/** Quote a cell when it holds a comma, quote or newline; double any inner quotes. */
export const csvCell = (v: string): string =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** Join rows of already-stringified cells into CSV text, quoting as needed. */
export const buildCsv = (headers: string[], rows: string[][]): string =>
  [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';

/** Hand a generated file to the browser as a download. */
export const downloadTextFile = (name: string, text: string, type = 'text/csv'): void => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
