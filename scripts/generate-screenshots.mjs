/**
 * Generate the user-manual screenshots (docs/images/*.png) by driving the FRED
 * dev server with the system Edge browser via puppeteer-core (no browser download).
 *
 * Prerequisites:
 *   - dev server running:  npm run dev  (port 5173)
 *   - a wide-format vowel dataset in the repo root:
 *       acoustic_data_1000REDUCED_FAST_IPA.csv
 *   - a consonant spectral dataset (set CONSONANT_CSV below): %-timepoint moments plus
 *     a `_t0…_tN` track and `_k0…_kN` coefficients, so every spectral mode has data.
 *
 * Usage:  node scripts/generate-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://localhost:5173';
/** Consonant dataset with tracks + coefficients (override if yours lives elsewhere). */
const CONSONANT_CSV = process.env.FRED_CONSONANT_CSV
  ?? 'D:/Coding/FormantStudio/testdata/formant_dataConsNEW2.csv';
const OUT = resolve('docs/images');
const PORT = 9223;
mkdirSync(OUT, { recursive: true });

/**
 * Hand-made screenshots, curated in docs/images by a human — this script must never
 * overwrite them. Remove a name from this list to let the script generate it again.
 * (distributionsA/B are captured manually and have no generator here at all.)
 */
const CURATED = new Set([
  '3d-view', 'data-summaries', 'export-dialog', 'f1f2-ellipses', 'layers-panel', 'time-series',
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Edge detaches from the process puppeteer spawns, so launch it ourselves with a
// remote-debugging port and connect to it instead.
const edgeProc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:/TEMP/claude/fred-shot-profile',
  'about:blank',
], { detached: false, stdio: 'ignore' });

let browser = null;
for (let i = 0; i < 40 && !browser; i++) {
  await sleep(500);
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${PORT}`,
      defaultViewport: { width: 1600, height: 950, deviceScaleFactor: 1.25 },
    });
  } catch { /* not ready yet */ }
}
if (!browser) { edgeProc.kill(); throw new Error('Could not connect to Edge DevTools'); }

const page = await browser.newPage();
page.setDefaultTimeout(30000);

const shot = async name => {
  if (CURATED.has(name)) { console.log(`  – ${name}.png (curated by hand, kept)`); return; }
  await sleep(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
};

/** Click the first button whose trimmed text matches the regex. */
const clickButton = async re =>
  page.evaluate(src => {
    const rx = new RegExp(src);
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => rx.test(x.textContent.trim()));
    if (!b) throw new Error(`button not found: ${src}`);
    b.click();
  }, re.source);

/** Set a React-controlled <select> found by its preceding label text. */
const setSelectByLabel = async (labelRe, optionLabelRe) =>
  page.evaluate(([lsrc, osrc]) => {
    const lrx = new RegExp(lsrc), orx = new RegExp(osrc);
    const label = Array.from(document.querySelectorAll('label'))
      .find(l => lrx.test(l.textContent.trim()));
    if (!label) throw new Error(`label not found: ${lsrc}`);
    // The X and Y axis selects share a parent, so prefer the select FOLLOWING the label.
    let sel = label.nextElementSibling;
    while (sel && sel.tagName !== 'SELECT') sel = sel.nextElementSibling;
    if (!sel) sel = label.parentElement.querySelector('select');
    if (!sel) throw new Error(`select not found for: ${lsrc}`);
    const opt = Array.from(sel.options).find(o => orx.test(o.textContent.trim()));
    if (!opt) throw new Error(`option not found: ${osrc} in ${lsrc}`);
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [labelRe.source, optionLabelRe.source]);

/** Tick a React-controlled checkbox found by its sibling label text. */
const tickCheckbox = async labelRe =>
  page.evaluate(src => {
    const rx = new RegExp(src);
    const lab = Array.from(document.querySelectorAll('label'))
      .find(l => rx.test(l.textContent.trim()) && l.querySelector('input[type=checkbox]'));
    if (!lab) throw new Error(`checkbox label not found: ${src}`);
    const cb = lab.querySelector('input[type=checkbox]');
    if (!cb.checked) cb.click();
  }, labelRe.source);

const untickCheckbox = async labelRe =>
  page.evaluate(src => {
    const rx = new RegExp(src);
    const lab = Array.from(document.querySelectorAll('label'))
      .find(l => rx.test(l.textContent.trim()) && l.querySelector('input[type=checkbox]'));
    const cb = lab?.querySelector('input[type=checkbox]');
    if (cb?.checked) cb.click();
  }, labelRe.source);

const upload = async file => {
  const input = await page.$('input[type=file][accept*="csv"], input[type=file]');
  await input.uploadFile(resolve(file));
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Import Data'));
  await sleep(600);
};

console.log('Loading FRED…');
await page.goto(URL, { waitUntil: 'networkidle2' });
await sleep(800);

// ── Vowel dataset ──────────────────────────────────────────────────────────
console.log('Vowel dataset…');
await upload('acoustic_data_1000REDUCED_FAST_IPA.csv');
await shot('mapping-dialog');
await clickButton(/^Import Data$/);
await page.waitForSelector('canvas');
await sleep(1200);

await setSelectByLabel(/^Colour:$/, /^canonical$/);
await sleep(600);
await shot('f1f2-overview');

await clickButton(/^Layers \(/);
await sleep(300);
await shot('layers-panel');
await clickButton(/^Layers \(/);

await tickCheckbox(/Ellip/);
await sleep(500);
await shot('f1f2-ellipses');
await untickCheckbox(/Ellip/);

await clickButton(/^3D F1\/F2\/F3$/);
await sleep(1200);
await shot('3d-view');

await clickButton(/^Time Series$/);
await sleep(900);
await shot('time-series');

await clickButton(/^Data Summaries$/);
await sleep(900);
await shot('data-summaries');

// Distributions shots (distributionsA/B) are captured by hand — no generator here.

await clickButton(/^Table$/);
await sleep(700);
await shot('table-view');

await clickButton(/^F1\/F2$/);
await sleep(700);
await clickButton(/^Export$/);
await sleep(900);
await shot('export-dialog');
await page.keyboard.press('Escape');
await sleep(400);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(x => /^(Close|Cancel)$/.test(x.textContent.trim()));
  if (b) b.click();
});
await sleep(400);

// ── Consonant / spectral dataset ───────────────────────────────────────────
// Uses the richer export: %-timepoints + an 11-sample track + 4 DCT coefficients.
console.log('Consonant dataset…');
await upload(CONSONANT_CSV);
await clickButton(/Spectral COG track/);        // expand a roll-up group
await sleep(300);
await page.evaluate(() => {                     // bring the groups into view
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => /Spectral COG at timepoints/.test(b.textContent));
  if (btn) btn.scrollIntoView({ block: 'start' });
});
await sleep(400);
await shot('spectral-mapping');
await clickButton(/^Import Data$/);
await page.waitForSelector('canvas');
await sleep(900);

await clickButton(/^Spectral$/);
await sleep(700);
await setSelectByLabel(/^Colour:$/, /^allophone$/);
await sleep(600);
await shot('spectral-scatter');

// k0 × k1 shape space — switch the data set, then pick coefficient orders per axis
await setSelectByLabel(/^Data:$/, /^Coefficients$/);
await sleep(600);
await shot('spectral-k0-k1');

// trajectories sweep the track
await setSelectByLabel(/^Data:$/, /^Track$/);
await setSelectByLabel(/^Mode:$/, /^Trajectory$/);
await sleep(700);
await shot('spectral-trajectory');

// mean contours with ±1 SD bands, then the same in real milliseconds
await setSelectByLabel(/^Mode:$/, /^Points$/);
await setSelectByLabel(/^Plot:$/, /Mean contours/);
await sleep(700);
await shot('spectral-contours');
await setSelectByLabel(/^Mode:$/, /Absolute/);
await sleep(700);
await shot('spectral-contours-absolute');

// box plot of the k1 slope coefficient, then all coefficients as small multiples
await setSelectByLabel(/^Plot:$/, /Distribution/);
await sleep(500);
await setSelectByLabel(/^Measure:$/, /COG k1/);
await sleep(600);
await shot('spectral-box-k1');
await tickCheckbox(/All coefficients/);
await sleep(700);
await shot('spectral-coeff-facets');
await untickCheckbox(/All coefficients/);

await setSelectByLabel(/^Measure:$/, /COG @50%/);
await setSelectByLabel(/^Mode:$/, /^Violin$/);
await sleep(600);
await shot('spectral-violin');

await browser.close();
edgeProc.kill();
console.log('Done → docs/images/');
