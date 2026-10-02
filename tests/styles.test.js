import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_STYLESHEET,
  RATCHET_KEYS,
  TOKEN_STYLESHEET,
  compareToBaseline,
  listStylesheets,
  measureRepository,
} from '../scripts/css-metrics.mjs';

/** The single ordered entry every stylesheet is imported from (css-migration-plan.md, §2). */
const ENTRY_STYLESHEET = 'index.css';

/**
 * The feature families the legacy single stylesheet was split into in Phase 2, in cascade order.
 * `tokens.css` comes first and the React-owned `shell.css` sits with the other shell rules.
 */
const FAMILY_SHEETS = [
  'base.css',
  'shell.css',
  'collections.css',
  'tabs.css',
  'dialogs.css',
  'settings.css',
  'toast.css',
];

/**
 * The Phase 0 ratchet of the CSS migration (css-migration-plan.md §5).
 *
 * The panel's styles were the legacy single sheet for most of the migration, so the four §5.3 rules
 * (tokens only, no `!important`, no selector deeper than 3 combinators, no tag selectors, prefixed
 * classes) could not simply be asserted as zeroes while it existed. Instead every metric they
 * measure is recorded in
 * `tests/fixtures/css-baseline.json` and may only go **down**: a rise is a regression, and a fall
 * without lowering the baseline fails too, so an improvement cannot be banked and spent later by
 * accident. This is the same shape as the two guards the migration already trusts —
 * `version-alignment.test.js` for drift, `legacy-shell-removed.test.js` for deleted code.
 *
 * Refreshing the baseline is deliberate: `npm run css:metrics -- --baseline`, in the commit that
 * earned the improvement.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'src', 'styles');

/**
 * Every live file that could load or name a stylesheet: the sources, the build scripts, the page
 * entry and the tooling config. Generated trees (`dist/`, `node_modules/`) are not source, and the
 * test folders are left out so a test can name what it is looking for.
 *
 * @returns {string[]}
 */
function liveFiles() {
  /** @type {string[]} */
  const files = [];

  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs|css|html|json)$/.test(entry.name)) {
        files.push(path.relative(ROOT, full));
      }
    }
  };

  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'scripts'));
  for (const file of [
    '.prettierignore',
    'eslint.config.js',
    'jsconfig.json',
    'manifest.json',
    'package.json',
    'vite.config.js',
  ]) {
    if (existsSync(path.join(ROOT, file))) files.push(file);
  }
  return files;
}

/** @returns {Record<string, any>} */
function baseline() {
  return JSON.parse(
    readFileSync(path.join(ROOT, 'tests', 'fixtures', 'css-baseline.json'), 'utf8')
  );
}

describe('css ratchet', () => {
  it('has not regressed any stylesheet metric', async () => {
    const metrics = await measureRepository();
    const { regressions } = compareToBaseline(metrics, baseline());

    expect(
      regressions,
      `These metrics rose past the baseline in tests/fixtures/css-baseline.json. Fix the ` +
        `stylesheets — a new colour literal belongs in tokens.css as a token, a new selector must ` +
        `not add a fourth combinator, an !important or a tag selector. See css-migration-plan.md §5.`
    ).toEqual([]);
  });

  it('has lowered the baseline to match every improvement', async () => {
    const metrics = await measureRepository();
    const { stale } = compareToBaseline(metrics, baseline());

    expect(
      stale,
      `These metrics improved but tests/fixtures/css-baseline.json was not lowered, so the gain ` +
        `could be spent silently later. Refresh it with \`npm run css:metrics -- --baseline\` in ` +
        `this commit.`
    ).toEqual([]);
  });

  it('records a number for every ratcheted metric', () => {
    const recorded = baseline();
    for (const key of RATCHET_KEYS) {
      expect(typeof recorded[key], `${key} is missing from the baseline`).toBe('number');
    }
  });

  it('imports every stylesheet exactly once, in the documented cascade order', async () => {
    // §6's layer 2: `index.css` is the single place cascade order is decided, so the order is
    // asserted here rather than left to whoever edits the entry next. A sheet that exists on disk
    // but is not imported would silently drop its rules.
    const entry = readFileSync(path.join(STYLES, 'index.css'), 'utf8');
    const imports = [...entry.matchAll(/@import\s+['"]\.\/([\w.-]+)['"]\s*;/g)].map(
      (match) => match[1]
    );
    expect(imports).toEqual([TOKEN_STYLESHEET, ...FAMILY_SHEETS]);

    const present = (await listStylesheets())
      .map((sheet) => sheet.file)
      .filter((f) => f !== ENTRY_STYLESHEET);
    expect([...imports].sort()).toEqual([...present].sort());
  });

  it('retires the legacy stylesheet and every live reference to it', () => {
    // Phase 6 closes the migration: the file is gone and nothing live loads it any more. Prose
    // that records the retirement — the plans, the ADRs, the changelogs — is append-only history
    // and deliberately out of scope; the *live* surface is the sources, the build scripts, the
    // config and the page, and none of them may name it again.
    expect(existsSync(path.join(STYLES, LEGACY_STYLESHEET))).toBe(false);

    // `scripts/css-metrics.mjs` keeps the constant so the ratchet can still record `panelCssLines`;
    // it is the one file allowed to know the retired name.
    const allowed = [path.join('scripts', 'css-metrics.mjs')];
    const offenders = liveFiles().filter((file) =>
      readFileSync(path.join(ROOT, file), 'utf8').includes(LEGACY_STYLESHEET)
    );

    expect(
      offenders.filter((file) => !allowed.includes(file)),
      `Only the style ratchet may still name ${LEGACY_STYLESHEET}; everything else must load a ` +
        `family sheet through ${ENTRY_STYLESHEET} (css-migration-plan.md, Phase 6).`
    ).toEqual([]);
  });

  it('keeps colour literals in the token file once the migration has removed them', async () => {
    // Phase 6 turns this on. Until the ratchet's `colourLiterals` reaches zero — Phases 2-5 retire
    // them family by family — that count is the guard, and a binary "no literal anywhere else"
    // assertion would fire on the legitimate intermediate states of the migration.
    const sheets = await listStylesheets();
    const hasTokens = sheets.some((sheet) => sheet.file === TOKEN_STYLESHEET);
    if (!hasTokens || baseline().colourLiterals > 0) return;

    const offenders = sheets
      .filter((sheet) => sheet.file !== TOKEN_STYLESHEET)
      .filter((sheet) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(sheet.css))
      .map(
        (sheet) => `${sheet.file}: ${sheet.css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)?.length}`
      );

    expect(offenders, `Only ${TOKEN_STYLESHEET} may declare a colour.`).toEqual([]);
  });
});
