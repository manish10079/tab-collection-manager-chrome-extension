import { existsSync, readFileSync } from 'node:fs';
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
 * The Phase 0 ratchet of the CSS migration (css-migration-plan.md §5).
 *
 * The panel still renders the pre-React `panel.css`, so the four §5.3 rules (tokens only, no
 * `!important`, no selector deeper than 3 combinators, no tag selectors, prefixed classes) cannot
 * simply be asserted as zeroes. Instead every metric they measure is recorded in
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
    expect(imports).toEqual([TOKEN_STYLESHEET, LEGACY_STYLESHEET, 'shell.css']);

    const present = (await listStylesheets())
      .map((sheet) => sheet.file)
      .filter((f) => f !== ENTRY_STYLESHEET);
    expect([...imports].sort()).toEqual([...present].sort());
  });

  it('keeps the legacy stylesheet loaded while it still exists', () => {
    // Phase 6 deletes `panel.css` and the cascade assertion above drops it. Until then, a
    // `panel.css` that nothing imports would silently drop every rule the panel still depends on —
    // which is a worse outcome than not starting the migration, so it is guarded either way.
    const legacy = path.join(STYLES, LEGACY_STYLESHEET);
    if (!existsSync(legacy)) return;

    const entry = readFileSync(path.join(STYLES, ENTRY_STYLESHEET), 'utf8');
    expect(entry).toContain(LEGACY_STYLESHEET);
  });

  it('keeps colour literals in the token file once the legacy sheet is gone', async () => {
    // Phase 6 turns this on. Until `panel.css` — the bulk of the remaining literals — is deleted,
    // the ratchet's `colourLiterals` count is the guard; a binary "no literal anywhere else"
    // assertion would fire on the legitimate intermediate states of the migration.
    const sheets = await listStylesheets();
    const hasTokens = sheets.some((sheet) => sheet.file === TOKEN_STYLESHEET);
    const hasLegacy = sheets.some((sheet) => sheet.file === LEGACY_STYLESHEET);
    if (!hasTokens || hasLegacy) return;

    const offenders = sheets
      .filter((sheet) => sheet.file !== TOKEN_STYLESHEET)
      .filter((sheet) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(sheet.css))
      .map(
        (sheet) => `${sheet.file}: ${sheet.css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)?.length}`
      );

    expect(offenders, `Only ${TOKEN_STYLESHEET} may declare a colour.`).toEqual([]);
  });
});
