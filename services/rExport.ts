/**
 * Export the current Statistics selection as an R analysis: a data CSV plus an
 * lme4 script fitting the mixed-effects models FRED cannot fit natively
 * (random slopes, crossed effects at any scale, Satterthwaite inference).
 */

import { SpeechToken, DatasetMeta } from '../types';
import { getLabel } from '../utils/getLabel';
import { csvCell, downloadTextFile } from '../utils/csv';

/** R-safe column name: mirrors what make.names() produces for common cases. */
export const rName = (name: string): string => {
  let out = name.replace(/[^A-Za-z0-9._]/g, '.');
  if (/^[0-9.]/.test(out)) out = 'X' + out;
  return out;
};

export interface RExportSpec {
  data: SpeechToken[];
  datasetMeta: DatasetMeta | null;
  measures: { field: string; label: string; value: (t: SpeechToken) => number }[];
  factorA: string;
  factorB: string | null;
  wordField: string | null;
}

/** Build the CSV text: one row per token with measures, factors, speaker, word. */
export const buildRCsv = (spec: RExportSpec): string => {
  const headers: string[] = [
    ...spec.measures.map(m => rName(m.label)),
    rName(spec.factorA),
    ...(spec.factorB ? [rName(spec.factorB)] : []),
    'speaker',
    ...(spec.wordField ? ['word'] : []),
  ];
  const lines = [headers.join(',')];
  for (const t of spec.data) {
    const a = getLabel(t, spec.factorA);
    if (!a) continue;
    const b = spec.factorB ? getLabel(t, spec.factorB) : null;
    if (spec.factorB && !b) continue;
    const cells: string[] = [];
    let anyValue = false;
    for (const m of spec.measures) {
      const v = m.value(t);
      cells.push(isNaN(v) ? 'NA' : String(v));
      if (!isNaN(v)) anyValue = true;
    }
    if (!anyValue) continue;
    cells.push(csvCell(a));
    if (b) cells.push(csvCell(b));
    cells.push(csvCell(t.speaker || 'NA'));
    if (spec.wordField) cells.push(csvCell(getLabel(t, spec.wordField) || 'NA'));
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
};

/** Build the R script fitting lmer models for every selected measure. */
export const buildRScript = (spec: RExportSpec): string => {
  const fA = rName(spec.factorA);
  const fB = spec.factorB ? rName(spec.factorB) : null;
  const hasWord = !!spec.wordField;
  const ranef = hasWord ? '(1|speaker) + (1|word)' : '(1|speaker)';
  const fixed = fB ? `${fA} * ${fB}` : fA;
  const fixedNull = fB ? `${fB}` : '1';

  const perMeasure = spec.measures.map(m => {
    const dv = rName(m.label);
    return `
## ── ${m.label} ───────────────────────────────────────────────
m_full <- lmer(${dv} ~ ${fixed} + ${ranef}, data = d, REML = FALSE)
m_null <- lmer(${dv} ~ ${fixedNull} + ${ranef}, data = d, REML = FALSE)
cat("\\n=== ${m.label}: likelihood-ratio test for ${fA} ===\\n")
print(anova(m_null, m_full))

# REML fit for the estimates (with Satterthwaite p-values via lmerTest)
m_reml <- lmer(${dv} ~ ${fixed} + ${ranef}, data = d, REML = TRUE)
cat("\\n=== ${m.label}: model summary ===\\n")
print(summary(m_reml))

# Random slopes are often warranted when ${fA} varies within speakers
# ("keep it maximal", Barr et al. 2013). Try, and simplify if it does not
# converge:
# m_slope <- lmer(${dv} ~ ${fixed} + (1 + ${fA}|speaker)${hasWord ? ' + (1|word)' : ''}, data = d, REML = TRUE)

# Pairwise comparisons between ${fA} levels:
# library(emmeans); emmeans(m_reml, pairwise ~ ${fA})
`;
  }).join('\n');

  return `# FRED export — mixed-effects analysis
# Generated ${''}by FRED. Data file: fred_data.csv (same folder).
#
# Requires:  install.packages(c("lme4", "lmerTest"))
# lmerTest wraps lme4 and adds Satterthwaite degrees of freedom to summary().

library(lmerTest)   # loads lme4 too

d <- read.csv("fred_data.csv", stringsAsFactors = TRUE)
str(d)
${perMeasure}
# Notes
# - The likelihood-ratio tests above compare ML fits with and without ${fA}.
# - FRED's own mixed model fits random intercepts only; this script is the
#   place for random slopes and larger models.
`;
};

/** Trigger browser downloads for the CSV and the script. */
export const downloadRExport = (spec: RExportSpec): void => {
  downloadTextFile('fred_data.csv', buildRCsv(spec), 'text/csv');
  downloadTextFile('fred_analysis.R', buildRScript(spec), 'text/plain');
};
