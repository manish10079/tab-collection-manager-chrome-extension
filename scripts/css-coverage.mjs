// Which rules does the panel ever actually use? (css-migration-plan.md, Phase 0.)
//
// Grepping class names against the JSX answers this badly: React assembles class names from
// strings, arrays and template literals, so a name that is never rendered still looks "referenced".
// So this drives the built extension in Playwright, walks the golden paths, and at every checkpoint
// asks the page which of its own stylesheet rules match a live element. A rule that never matches
// across the whole walk is either dead CSS or a state the walk does not reach — and the report
// separates those two by checking whether the rule's class names appear anywhere in `src/`.
//
// Run it with `npm run css:coverage`, which builds `dist/` first. It is a report, not a gate: it
// always exits 0 once it has run, and it lives outside CI for the same reason `npm run e2e` does —
// it needs a built `dist/`.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, STYLES_DIR } from './css-metrics.mjs';

const DIST = path.join(ROOT, 'dist');
const STYLES = path.join(ROOT, STYLES_DIR);
const PANEL_TIMEOUT_MS = 15_000;

/**
 * @typedef {object} Coverage
 * @property {Set<string>} seen       Every selector in the panel's stylesheets
 * @property {Set<string>} matched    Selectors that matched a live element at least once
 * @property {number} checkpoints     How many times the page was sampled
 */

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{json: boolean, limit: number, verbose: boolean}} */
  const options = { json: false, limit: 25, verbose: false };
  for (const argument of argv) {
    if (argument === '--json') options.json = true;
    else if (argument === '--verbose') options.verbose = true;
    else if (argument.startsWith('--limit=')) options.limit = Number(argument.slice(8)) || 25;
  }
  return options;
}

/** Collapse the whitespace differences between the source stylesheet and its minified build. */
function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim();
}

/** Every non-test source file under `src/`, concatenated — the "is this class still rendered?" haystack. */
async function readSourceText() {
  const parts = [];
  /** @param {string} directory */
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(js|jsx|html)$/.test(entry.name)) parts.push(await readFile(full, 'utf8'));
    }
  }
  await walk(path.join(ROOT, 'src'));
  return parts.join('\n');
}

/**
 * The source stylesheets, normalized, so a selector can be traced back to its file.
 *
 * This doubles as the scope of the whole report. Vite bundles the panel into a single CSS asset
 * that also carries Font Awesome and the Inter faces, so `document.styleSheets` exposes ~2,300
 * rules of which most are vendor `.fa-*` utilities — reporting on those would bury the handful of
 * rules this migration actually cares about. Only selectors that appear in `src/styles/` count.
 *
 * @returns {Promise<Array<{file: string, text: string}>>}
 */
async function readSourceStylesheets() {
  const sheets = [];
  for (const entry of await readdir(STYLES, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
    sheets.push({
      file: path.posix.join(STYLES_DIR, entry.name),
      text: normalizeSelector(await readFile(path.join(STYLES, entry.name), 'utf8')),
    });
  }
  return sheets;
}

/**
 * Whether a selector is one this repository writes, rather than a vendor utility.
 *
 * @param {string} selector
 * @param {Array<{file: string, text: string}>} sheets
 * @returns {boolean}
 */
function isOurs(selector, sheets) {
  const normalized = normalizeSelector(selector);
  return sheets.some((sheet) => sheet.text.includes(normalized));
}

/**
 * Ask the page which of its stylesheet rules match an element right now, and fold the answer into
 * the running coverage.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Coverage} coverage
 */
async function record(page, coverage) {
  const result = await page.evaluate(() => {
    const selectors = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // A stylesheet the page may not read (none today, but harmless to guard).
      }
      for (const rule of rules) {
        // Keyframes and font-face rules have no selectorText.
        if (typeof rule.selectorText === 'string') selectors.push(rule.selectorText);
      }
    }
    const hit = [];
    for (const selector of selectors) {
      try {
        if (document.querySelector(selector)) hit.push(selector);
      } catch {
        // A pseudo-element cannot be matched by a selector query; it stays unmatched.
      }
    }
    return { selectors, hit };
  });

  for (const selector of result.selectors) coverage.seen.add(selector);
  for (const selector of result.hit) coverage.matched.add(selector);
  coverage.checkpoints += 1;
}

/**
 * Run one walk step: never let a missing control end the run, because the point is to cover as much
 * of the panel as possible before reporting.
 *
 * @param {string} label
 * @param {() => Promise<void>} action
 */
async function step(label, action) {
  try {
    await action();
  } catch (error) {
    console.warn(`[css] step "${label}" skipped: ${error.message.split('\n')[0]}`);
  }
}

/**
 * Drive the panel through its golden paths, sampling the stylesheets after each one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Coverage} coverage
 * @returns {Promise<string[]>} Selectors that are only reachable in a hover/focus state
 */
async function walkPanel(page, coverage) {
  const dialog = (name) => page.getByRole('dialog', { name });
  /** The id of the card the walk creates, resolved from the DOM because the name is in a value. */
  let createdId = '';

  // ── First-run panel, so the empty state and the shell chrome are sampled ──
  await record(page, coverage);

  // ── Create a collection (Toast, controls bar, card, Current Session) ──
  await step('create collection', async () => {
    await page.locator('#toggleCreateBtn').click();
    const input = page.getByPlaceholder('New collection name');
    await input.fill('CSS Coverage');
    await input.press('Enter');
    await page
      .locator('#collectionsContainer > .collection')
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await record(page, coverage);

  // The first card is the worker's live **Current Session**, whose menu has no folder or delete
  // entries. The card the walk created is the one to drive, so it is resolved by its name value —
  // a collection's name lives in an input's `value`, which no selector can match (the same reason
  // `e2e/panel.spec.js` has a `cardFor` helper).
  await step('find the created card', async () => {
    const id = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#collectionsContainer input.collection-name')];
      return inputs.find((input) => input.value === 'CSS Coverage')?.closest('.collection')?.dataset
        .id;
    });
    if (!id) throw new Error('the created collection card was not found');
    createdId = id;
  });
  // Depth-agnostic on purpose: the walk moves this collection into a folder partway through, and
  // `#collectionsContainer > .collection` would stop matching it at that point.
  const card = page.locator(`#collectionsContainer .collection[data-id="${createdId}"]`);

  // ── Add a tab through the dialog (modal primitive, form controls, buttons) ──
  await step('add a tab', async () => {
    await card.locator('.collection-menu-btn').click();
    await card.locator('.add-tabs-btn').click();
    const addTabs = dialog('Add Tabs');
    await addTabs.getByLabel('Title').fill('Coverage docs');
    await addTabs.getByLabel('URL').fill('https://example.test/docs');
    await addTabs.getByRole('button', { name: 'Add Tab' }).click();
    await addTabs.waitFor({ state: 'hidden', timeout: PANEL_TIMEOUT_MS });
  });
  await record(page, coverage);

  // ── Expand the collection, then open its tab menu ──
  await step('expand and open the tab menu', async () => {
    await card.locator('.expand-btn').click();
    await card.locator('.tab-item').first().waitFor({ state: 'visible', timeout: 5000 });
    await card.locator('.tab-actions .icon-btn, .tab-item .icon-btn').last().click();
  });
  await record(page, coverage);

  await step('open the collection menu', async () => {
    await page.keyboard.press('Escape');
    await card.locator('.collection-menu-btn').click();
  });
  await record(page, coverage);

  // ── Folders: create one, then file the collection into it ──
  await step('create a folder', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#createFolderBtn').click();
    await page
      .locator('#collectionsContainer > .folder')
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await record(page, coverage);

  await step('move the collection into the folder', async () => {
    await card.locator('.collection-menu-btn').click();
    await card.locator('.move-to-folder-btn').first().click();
  });
  await record(page, coverage);

  await step('open the folder menu and rename control', async () => {
    const folder = page.locator('#collectionsContainer > .folder').first();
    await folder.locator('.folder-menu-btn').click();
  });
  await record(page, coverage);

  await step('collapse the folder', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#collectionsContainer > .folder .expand-btn').first().click();
  });
  await record(page, coverage);

  // ── Selection mode (checkboxes, selection bar, selected card) ──
  await step('selection mode', async () => {
    await page.locator('#toggleSelectBtn').click();
    await page.locator('#collectionsContainer .select-checkbox input').first().check();
  });
  await record(page, coverage);

  await step('leave selection mode', async () => {
    await page.locator('#cancelSelectionBtn').click();
  });
  await record(page, coverage);

  // ── Search ──
  await step('search', async () => {
    await page.locator('#toggleSearchBtn').click();
    await page.getByPlaceholder('Search collections or tabs…').fill('coverage');
  });
  await record(page, coverage);

  await step('close search', async () => {
    await page.keyboard.press('Escape');
  });
  await record(page, coverage);

  // ── Grid view ──
  //
  // This has to be the last interaction before the layout returns to list, for two reasons that are
  // both about what the grid does to the DOM. Switching to grid while the collection is expanded
  // opens the view-collection modal over the panel, which would make every later click time out.
  // So the folder is re-expanded and the collection collapsed first: that is also the only state in
  // which the folder's collections — and the grid rules that keep them in list layout — are
  // rendered, which is exactly the CSS Phase 2/5 has to protect.
  await step('prepare grid view', async () => {
    await page.locator('#collectionsContainer > .folder .expand-btn').first().click();
    await card.locator('.expand-btn').click();
    await card.locator('.collection-tabs.expanded').waitFor({ state: 'detached', timeout: 3000 });
  });
  await record(page, coverage);

  await step('grid view', async () => {
    await page.locator('#toggleLayoutBtn').click();
    await page.locator('#collectionsContainer.grid-view').waitFor({ state: 'attached' });
  });
  await record(page, coverage);

  // The collection menu in grid view: the grid flips its odd/even alignment, which the stylesheet
  // re-pins, so opening it here is what covers that rule.
  await step('open the collection menu in grid view', async () => {
    await card.locator('.collection-menu-btn').click();
  });
  await record(page, coverage);

  await step('back to list view', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#toggleLayoutBtn').click();
    await page.locator('#collectionsContainer.grid-view').waitFor({ state: 'detached' });
  });
  await record(page, coverage);

  // ── Sort menu ──
  await step('open the sort menu', async () => {
    await page.locator('.sort-collections-btn').first().click();
  });
  await record(page, coverage);

  // ── Settings, including the light theme so its token overrides are genuinely covered ──
  await step('settings', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#settingsBtn').click();
    await dialog('Settings').waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await record(page, coverage);

  await step('light theme', async () => {
    const settings = dialog('Settings');
    await settings.locator('label.toggle-switch:has(#lightModeToggle) .toggle-track').click();
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 3000 });
  });
  await record(page, coverage);

  await step('back to the dark theme', async () => {
    const settings = dialog('Settings');
    await settings.locator('label.toggle-switch:has(#lightModeToggle) .toggle-track').click();
  });
  await record(page, coverage);

  await step('close settings', async () => {
    await page.keyboard.press('Escape');
  });

  // ── Session history, and a session's details ──
  await step('history', async () => {
    await page.locator('#historyBtn').click();
    await dialog('Session History').waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await record(page, coverage);

  await step('session details', async () => {
    await page.locator('.history-modal .card-click-area').first().click({ timeout: 2500 });
  });
  await record(page, coverage);

  await step('close history', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  // ── Keyboard shortcuts help (`?`) ──
  await step('shortcuts help', async () => {
    await page.locator('#collectionsContainer').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('?');
    await dialog(/Shortcuts/i).waitFor({ state: 'visible', timeout: 2500 });
  });
  await record(page, coverage);

  await step('close shortcuts help', async () => {
    await page.keyboard.press('Escape');
  });
  await record(page, coverage);

  // ── Hover-only and focus-only rules ──
  return hoverSweep(page, coverage);
}

/**
 * `:hover`/`:focus` rules never match a plain `querySelector`, so hover the element each one
 * targets and re-sample. Capped, because the panel has more hover states than are worth a round
 * trip each.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Coverage} coverage
 * @returns {Promise<string[]>}
 */
async function hoverSweep(page, coverage) {
  const stateful = [...coverage.seen].filter(
    (selector) =>
      !coverage.matched.has(selector) &&
      !selector.includes('::') &&
      /:(hover|focus-visible|focus-within|focus)\b/.test(selector)
  );

  /** @type {string[]} */
  const bases = [];
  for (const selector of stateful) {
    const base = selector
      .replace(/:(hover|focus-visible|focus-within|focus)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (base && !bases.includes(base)) bases.push(base);
  }

  // An element that is not on screen right now (a closed menu, a collapsed panel) is expected, not
  // a failure — the rule stays in the "walk did not reach it" bucket. Hovering is best-effort, so
  // these are silent rather than warnings; only a genuinely broken selector would matter here.
  let hovered = 0;
  for (const base of bases.slice(0, 60)) {
    const target = page.locator(base).first();
    try {
      if ((await target.count()) === 0) continue;
      if (!(await target.isVisible())) continue;
      await target.hover({ timeout: 1000 });
      hovered += 1;
      await record(page, coverage);
    } catch {
      // Not reachable in this state; leave it unmatched.
    }
  }

  console.log(`[css] hovered         ${hovered} of ${bases.length} hover/focus targets`);
  return stateful;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    await readdir(DIST);
  } catch {
    console.error('[css] no dist/ to measure — run `npm run build` first');
    process.exitCode = 1;
    return;
  }

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run'],
  });

  /** @type {Coverage} */
  const coverage = { seen: new Set(), matched: new Set(), checkpoints: 0 };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];

    const page = await context.newPage();
    // A report should be quick and forgiving: a target this walk misses is expected (a collapsed
    // menu, a state it does not reach), and waiting Playwright's 30s default for each one would
    // turn a two-minute report into a twenty-minute one.
    page.setDefaultTimeout(6000);
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page
      .locator('html[data-theme]')
      .waitFor({ state: 'attached', timeout: PANEL_TIMEOUT_MS });
    await page
      .locator('#collectionsContainer')
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });

    const stateful = await walkPanel(page, coverage);

    const [sourceText, stylesheets] = await Promise.all([
      readSourceText(),
      readSourceStylesheets(),
    ]);

    // Scope to the selectors this repository writes. Everything else in the bundle is vendor CSS.
    const ours = [...coverage.seen].filter((selector) => isOurs(selector, stylesheets));
    const oursMatched = ours.filter((selector) => coverage.matched.has(selector));

    /** @type {Array<{selector: string, file: string, classesInSource: boolean}>} */
    const unmatched = [];
    /** @type {string[]} */
    const pseudoElements = [];

    for (const selector of ours.sort()) {
      if (coverage.matched.has(selector)) continue;
      if (selector.includes('::')) {
        pseudoElements.push(selector);
        continue;
      }
      // `[data-theme="light"]` / `:root` are the token declaration blocks. They are not rules with
      // a subject, so "never matched" says nothing about whether they are needed — and deleting one
      // would break the theme. Excluded deliberately.
      if (/^(:root|\[data-theme)/.test(selector)) continue;
      const names = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
      const normalized = normalizeSelector(selector);
      const sheet = stylesheets.find((candidate) => candidate.text.includes(normalized));
      unmatched.push({
        selector,
        file: sheet?.file ?? '(not found in src/styles)',
        // A rule whose classes are gone from the sources is a dead-CSS candidate; one whose classes
        // are still rendered is a state this walk never reached.
        classesInSource: names.length > 0 && names.every((name) => sourceText.includes(name)),
      });
    }

    const dead = unmatched.filter((entry) => !entry.classesInSource);
    const unexercised = unmatched.filter((entry) => entry.classesInSource);
    const byFile = {};
    for (const entry of unmatched) byFile[entry.file] = (byFile[entry.file] ?? 0) + 1;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            checkpoints: coverage.checkpoints,
            bundledRules: coverage.seen.size,
            bundledMatched: coverage.matched.size,
            rules: ours.length,
            matched: oursMatched.length,
            pseudoElements: pseudoElements.length,
            statefulSelectors: stateful.length,
            unmatched: unmatched.length,
            byFile,
            deadClasses: dead.map((entry) => entry.selector),
            unexercisedStates: unexercised.map((entry) => entry.selector),
            pseudoElementSelectors: pseudoElements,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`[css] checkpoints     ${coverage.checkpoints}`);
    console.log(
      `[css] bundled         ${coverage.seen.size} rules in dist/ (${coverage.matched.size} matched), ` +
        `including vendor CSS`
    );
    console.log(
      `[css] ours            ${ours.length} rules from ${STYLES_DIR}, ${oursMatched.length} matched, ` +
        `${pseudoElements.length} pseudo-element, ${stateful.length} hover/focus-only, ` +
        `${unmatched.length} never matched`
    );
    console.log(
      `[css] by file         ${
        Object.entries(byFile)
          .map(([file, count]) => `${file} ${count}`)
          .join(', ') || '(none)'
      }`
    );
    console.log(
      `[css] dead-CSS        ${dead.length} rule(s) whose classes appear nowhere in src/`
    );
    for (const entry of dead.slice(0, options.limit)) {
      console.log(`        ${entry.selector}    ${entry.file}`);
    }
    if (dead.length > options.limit) console.log(`        … ${dead.length - options.limit} more`);
    console.log(
      `[css] unexercised     ${unexercised.length} rule(s) whose classes are still rendered — the walk did not reach that state`
    );
    // The first few by default, because these are what Phase 4 extends the walk for; the whole list
    // is behind --verbose.
    for (const entry of unexercised.slice(0, options.verbose ? options.limit * 4 : 10)) {
      console.log(`        ${entry.selector}    ${entry.file}`);
    }
    if (unexercised.length > (options.verbose ? options.limit * 4 : 10)) {
      console.log('        … run with --verbose for the rest');
    }
    console.log(
      '[css] report only — review before deleting anything; run with --verbose for more.'
    );
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error('[css] coverage failed:', error);
  process.exitCode = 1;
});
