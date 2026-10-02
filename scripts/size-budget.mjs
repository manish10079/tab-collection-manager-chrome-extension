// Bundle-size budget: fails when the built panel grows past what we agreed to ship.
//
// This lives outside `scripts/build.mjs` on purpose — `npm run dev` rebuilds on every source change,
// and a budget failure inside the build would be noise while iterating. CI runs it right after a
// clean build, and it is worth running locally (`npm run check:size`) before changing a budget.
//
// The metrics are the two things a user actually parses, gzipped (JS and CSS), plus the whole
// packaged extension raw. `dist/` is mostly font files, so a stray new asset shows up in the total
// even when the bundles are unchanged.
//
// Baselines measured at plan v1.15.0 (2026-10-02), with the budgets below already in place. Sizes
// are printed as binary multiples (1024), and Vite's own reporter lists the same files in decimal
// kB — the numbers differ by ~2.5%, not by a real change.
//   assets/*.js   293 kB raw / 89.7 kB gzip  (budget 100 kB gzip → 10% headroom)
//   assets/*.css  149 kB raw / 31.1 kB gzip  (budget 36 kB gzip → 14% headroom)
//   dist total    1.12 MB raw (32 woff2 faces, the bundled worker, the manifest and the icons)
//                 (budget 1.25 MB → 10% headroom)
// Raising a number is a deliberate act: change it here, say why in the commit, and note it in
// `react-migration-plan.md`'s changelog.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');

/**
 * Ceilings, in bytes, with the headroom that keeps a small dependency bump from failing the build.
 *
 * @type {Record<string, number>}
 */
const BUDGETS = {
  'bundle JS (gzip)': 100 * 1024,
  'bundle CSS (gzip)': 36 * 1024,
  'packaged dist (raw)': 1.25 * 1024 * 1024,
};

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Every file under `directory`, as absolute paths.
 *
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else found.push(full);
  }
  return found;
}

/**
 * Raw and gzipped byte counts for files matching `extension`.
 *
 * @param {string[]} files
 * @param {string} extension
 * @returns {Promise<{raw: number, gzip: number, count: number}>}
 */
async function measure(files, extension) {
  let raw = 0;
  let gzip = 0;
  let count = 0;
  for (const file of files.filter((name) => name.endsWith(extension))) {
    const contents = await readFile(file);
    raw += contents.byteLength;
    gzip += gzipSync(contents).byteLength;
    count += 1;
  }
  return { raw, gzip, count };
}

/** A budget breach: the metric, what it measured and what was allowed. */
class OverBudget extends Error {}

async function main() {
  try {
    await readdir(dist);
  } catch {
    throw new Error('no dist/ to measure — run `npm run build` first');
  }

  const files = await listFiles(dist);
  // The bundles are what Vite emits into `dist/assets/`. Measuring all of `dist/` would fold in
  // the bundled `background.js` and report the service worker as part of the panel bundle.
  const bundled = files.filter((file) => file.startsWith(assets + path.sep));
  const js = await measure(bundled, '.js');
  const css = await measure(bundled, '.css');
  const total = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce(
    (sum, size) => sum + size,
    0
  );

  /** @type {{label: string, actual: number, budget: number, detail: string}[]} */
  const rows = [
    {
      label: 'bundle JS (gzip)',
      actual: js.gzip,
      budget: BUDGETS['bundle JS (gzip)'],
      detail: `${formatSize(js.raw)} raw in ${js.count} file${js.count === 1 ? '' : 's'}`,
    },
    {
      label: 'bundle CSS (gzip)',
      actual: css.gzip,
      budget: BUDGETS['bundle CSS (gzip)'],
      detail: `${formatSize(css.raw)} raw in ${css.count} file${css.count === 1 ? '' : 's'}`,
    },
    {
      label: 'packaged dist (raw)',
      actual: total,
      budget: BUDGETS['packaged dist (raw)'],
      detail: `${files.length} files under dist/`,
    },
  ];

  const failures = rows.filter((row) => row.actual > row.budget);
  for (const row of rows) {
    const state = row.actual > row.budget ? 'OVER' : 'ok';
    console.log(
      `[size] ${state.padEnd(4)} ${row.label.padEnd(21)} ` +
        `${formatSize(row.actual).padStart(9)} / ${formatSize(row.budget).padStart(9)}  (${row.detail})`
    );
  }

  if (failures.length > 0) {
    const detail = failures
      .map(
        (row) =>
          `  - ${row.label}: ${formatSize(row.actual)} > ${formatSize(row.budget)} ` +
          `(+${formatSize(row.actual - row.budget)})`
      )
      .join('\n');
    throw new OverBudget(`the bundled panel is over budget:\n${detail}`);
  }

  const headroom = rows
    .map((row) => `${row.label} ${(100 - (row.actual / row.budget) * 100).toFixed(0)}%`)
    .join(', ');
  console.log(`[size] within budget (headroom: ${headroom})`);
}

main().catch((error) => {
  console.error(`[size] ${error.message}`);
  process.exit(1);
});
