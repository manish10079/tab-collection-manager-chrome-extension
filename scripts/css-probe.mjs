// Does the panel still *resolve* to the same styles? (css-migration-plan.md §6, layer 1.)
//
// The coverage tool answers "is this rule used at all". This answers the harder question a pure CSS
// refactor has to answer: after moving, splitting or flattening a rule, does every element still
// resolve to the same computed style? Unit tests cannot see that — CSS is not behaviour — and a
// throwaway probe is deleted the moment it is needed again, so the probe is a committed script with
// a committed baseline and a stable exit code.
//
// It drives the built extension through a fixed set of panel states, dumps the resolved
// `getComputedStyle` of a fixed probe list at each one, and diffs the result against
// `tests/fixtures/style-probe.json`. Any difference is a change in what the panel actually paints,
// so it fails; `npm run css:probe:update` accepts the new values, and that diff is the review.
//
// Colours are normalised to 8-bit `rgb(r g b / a)` first. Chrome serialises a `color-mix()` result
// as `color(srgb …)` even when it is numerically identical to the `rgba()` it replaced, so a raw
// string diff would report a change that is not on screen — which is exactly what Phase 1's 41
// conversions are made of.
//
// Run it with `npm run css:probe`, which builds `dist/` first. Like `npm run css:coverage` and
// `npm run e2e` it needs a browser and a built `dist/`, so it is not part of `npm test`.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT } from './css-metrics.mjs';

const DIST = path.join(ROOT, 'dist');
const BASELINE = path.join(ROOT, 'tests', 'fixtures', 'style-probe.json');
const PANEL_TIMEOUT_MS = 15_000;
const PROBE_VERSION = 1;
// The side panel is a narrow, fixed surface; pinning the viewport keeps every px-valued property
// (`width`, `grid-template-columns`, a wrapped label) comparable from run to run.
const VIEWPORT = { width: 360, height: 900 };

/**
 * The resolved properties each probe records. Deliberately fixed and small: `transition` is left
 * out because its in-flight value is timing noise, not a style, and every entry here is something a
 * cascade change can plausibly move.
 */
const PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'width',
  'height',
  'min-height',
  'max-width',
  'margin',
  'padding',
  'gap',
  'row-gap',
  'column-gap',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'grid-template-columns',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'color',
  'background-color',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'box-shadow',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'text-overflow',
  'white-space',
  'transform',
];

/**
 * The elements the probe watches — the ones §6 names (header, controls bar, a card, a folder, a tab
 * row, each modal) plus the specific controls Phases 4-5 moved, so a regression in the two-row bar,
 * a menu, a modal or a hidden state is caught. A selector that is absent in a state records
 * `count: 0`, which is itself part of the baseline.
 */
const PROBES = [
  'html',
  'body',
  '.ut-container',
  '.sh-header',
  '#app-name',
  '.sh-controls',
  '.sh-compact-controls-row',
  '#actionsBarDefault',
  '#actionsBarDefault .sh-icon-btn',
  '.sh-action-label',
  '#toggleSearchBtn',
  '#historyBtn',
  '#restoreBackupBtn',
  '.sh-sort-collections-btn',
  '.sh-sort-dropdown-menu',
  '#collectionsContainer',
  '.cc-section-heading',
  '.cc-collection',
  '.cc-collection-header',
  '.cc-collection-name',
  '.cc-collection-menu-btn',
  '.cc-collection-dropdown-menu',
  '.cc-folder',
  '.cc-folder-header',
  '.cc-folder-name',
  '.cc-folder-summary',
  '.tab-item',
  '.tab-title',
  '.tab-url',
  '.tab-tabs-list',
  '.tab-collection-tabs',
  '.tab-collection-tab-search-input',
  '.sh-selection-bar',
  '.sh-selection-count',
  '.sh-search-results-container',
  '.sh-search-section',
  '.ut-empty-state',
  '.dl-modal-overlay',
  '.dl-modal',
  '.dl-modal-header',
  '.set-settings-modal',
  '.set-settings-card',
  '.set-settings-row',
  '.set-toggle-input',
  '.set-toggle-track',
  '.set-toggle-thumb',
  '.dl-history-modal',
  '.ts-toast',
  '.sh-footer-btn-container',
];

/**
 * Probes whose box tracks their *content* rather than the cascade, keyed by state. The history
 * modal grows a row whenever the worker has recorded one more auto-save session by the time the
 * walk reaches it, which is timing, not styling; its cascade is still covered by every other
 * property, so only the content-driven box is dropped.
 */
const IGNORE_PROPERTIES = {
  'history-open': {
    '.dl-modal': ['width', 'height'],
    '.dl-history-modal': ['width', 'height'],
  },
};

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{update: boolean, json: boolean, limit: number}} */
  const options = { update: false, json: false, limit: 40 };
  for (const argument of argv) {
    if (argument === '--update') options.update = true;
    else if (argument === '--json') options.json = true;
    else if (argument.startsWith('--limit=')) options.limit = Number(argument.slice(8)) || 0;
  }
  return options;
}

/**
 * Run one walk step. Forgiving on purpose: the probe wants to reach as many states as possible
 * before reporting, and a step that fails leaves the state's snapshot visibly wrong in the diff
 * rather than silently passing.
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

/** Round a channel to its 8-bit value, the unit a screenshot would show. */
function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Format a colour the one way this file compares: 8-bit channels plus alpha.
 *
 * @param {number[]} channels
 * @param {number} alpha
 * @returns {string}
 */
function formatColor(channels, alpha) {
  return `rgb(${channels.map(clamp).join(' ')} / ${Number(alpha.toFixed(3))})`;
}

/**
 * Parse either the legacy `rgb()`/`rgba()` form or the `color(srgb …)` form Chrome emits for a
 * `color-mix()`, and reduce both to the same string.
 *
 * @param {'color'|'rgb'} fn
 * @param {string} body
 * @returns {string}
 */
function canonicalColor(fn, body) {
  const [coords, alphaPart] = body.split('/').map((part) => part.trim());
  const numbers = coords.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map(Number);
  if (numbers.some((number) => Number.isNaN(number))) return `${fn}(${body})`;
  const alpha = alphaPart ? Number(alphaPart) : (numbers[3] ?? 1);
  const channels =
    fn === 'color' ? numbers.slice(0, 3).map((number) => number * 255) : numbers.slice(0, 3);
  return formatColor(channels, alpha);
}

/**
 * Reduce every colour in a computed value to the canonical form. A value can hold more than one
 * colour (`box-shadow`), so this substitutes in place rather than parsing the whole value.
 *
 * @param {string} value
 * @returns {string}
 */
function canonicalizeValue(value) {
  return value
    .replace(/color\(srgb\s+([^)]+)\)/gi, (_, body) => canonicalColor('color', body))
    .replace(/rgba?\(([^)]+)\)/gi, (_, body) => canonicalColor('rgb', body));
}

/**
 * @param {Record<string, {count: number, values?: Record<string, string>}>} raw
 * @returns {Record<string, {count: number, values?: Record<string, string>}>}
 */
function canonicalizeSnapshot(raw) {
  /** @type {Record<string, {count: number, values?: Record<string, string>}>} */
  const out = {};
  for (const [selector, entry] of Object.entries(raw)) {
    if (!entry.values) {
      out[selector] = { count: entry.count };
      continue;
    }
    /** @type {Record<string, string>} */
    const values = {};
    for (const [property, value] of Object.entries(entry.values)) {
      values[property] = canonicalizeValue(value);
    }
    out[selector] = { count: entry.count, values };
  }
  return out;
}

/**
 * Read the resolved style of the first match of every probe selector, plus how many matched.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string[]>} [ignore] Properties to skip, keyed by selector
 * @returns {Promise<Record<string, {count: number, values: Record<string, string>}>>}
 */
async function snapshot(page, ignore = {}) {
  return page.evaluate(
    ({ selectors, properties, ignore }) => {
      /** @type {Record<string, {count: number, values: Record<string, string>}>} */
      const out = {};
      for (const selector of selectors) {
        let nodes = [];
        try {
          nodes = [...document.querySelectorAll(selector)];
        } catch {
          nodes = []; // A selector Playwright cannot run is a probe typo, not a page failure.
        }
        if (nodes.length === 0) {
          out[selector] = { count: 0, values: {} };
          continue;
        }
        const style = getComputedStyle(nodes[0]);
        const skip = ignore[selector] ?? [];
        /** @type {Record<string, string>} */
        const values = {};
        for (const property of properties) {
          if (skip.includes(property)) continue;
          values[property] = style.getPropertyValue(property);
        }
        out[selector] = { count: nodes.length, values };
      }
      return out;
    },
    { selectors: PROBES, properties: PROPERTIES, ignore }
  );
}

/**
 * Fold a probe's resolved values into one line (`count=N;property=value;…`) so the committed
 * baseline stays small and reviewable, with one line per probed element per state instead of one
 * line per property. The in-memory shape is unchanged, so the diff is still reported per property.
 *
 * @param {{count: number, values?: Record<string, string>}} entry
 * @returns {string}
 */
function serializeEntry(entry) {
  const values = Object.entries(entry.values ?? {});
  if (values.length === 0) return `count=${entry.count}`;
  return `count=${entry.count};${values
    .map(([property, value]) => `${property}=${value}`)
    .join(';')}`;
}

/**
 * @param {string} text
 * @returns {{count: number, values: Record<string, string>}}
 */
function parseEntry(text) {
  /** @type {{count: number, values: Record<string, string>}} */
  const entry = { count: 0, values: {} };
  for (const part of text.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === 'count') entry.count = Number(value);
    else entry.values[key] = value;
  }
  return entry;
}

/**
 * @param {{states: Record<string, Record<string, {count: number, values: Record<string, string>}>>}} current
 */
function serializeBaseline(current) {
  /** @type {Record<string, Record<string, string>>} */
  const states = {};
  for (const [state, probes] of Object.entries(current.states)) {
    /** @type {Record<string, string>} */
    const entries = {};
    for (const [selector, entry] of Object.entries(probes)) {
      entries[selector] = serializeEntry(entry);
    }
    states[state] = entries;
  }
  return { ...current, states };
}

/**
 * @param {{states?: Record<string, Record<string, string>>}} stored
 */
function deserializeBaseline(stored) {
  /** @type {Record<string, Record<string, {count: number, values: Record<string, string>}>>} */
  const states = {};
  for (const [state, probes] of Object.entries(stored.states ?? {})) {
    /** @type {Record<string, {count: number, values: Record<string, string>}>} */
    const entries = {};
    for (const [selector, entry] of Object.entries(probes)) {
      entries[selector] = typeof entry === 'string' ? parseEntry(entry) : entry;
    }
    states[state] = entries;
  }
  return { ...stored, states };
}

/**
 * Every way the current run differs from the baseline: a state that appeared or vanished, a probe
 * whose match count moved, or a single property that resolves differently.
 *
 * @param {{states: Record<string, Record<string, {count: number, values?: Record<string, string>}>>}} baseline
 * @param {{states: Record<string, Record<string, {count: number, values?: Record<string, string>}>>}} current
 * @returns {string[]}
 */
function diffSnapshots(baseline, current) {
  const differences = [];
  const states = new Set([...Object.keys(baseline.states), ...Object.keys(current.states)]);
  for (const state of [...states].sort()) {
    const before = baseline.states[state] ?? {};
    const after = current.states[state] ?? {};
    const selectors = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const selector of [...selectors].sort()) {
      const b = before[selector];
      const a = after[selector];
      if (!b && a) {
        differences.push(`${state} · ${selector} · added (count ${a.count})`);
        continue;
      }
      if (b && !a) {
        differences.push(`${state} · ${selector} · removed (was count ${b.count})`);
        continue;
      }
      if (b.count !== a.count) {
        differences.push(`${state} · ${selector} · count ${b.count} → ${a.count}`);
      }
      const bv = b.values ?? {};
      const av = a.values ?? {};
      for (const property of [...new Set([...Object.keys(bv), ...Object.keys(av)])].sort()) {
        if (bv[property] !== av[property]) {
          differences.push(
            `${state} · ${selector} · ${property}: ${bv[property] ?? '(absent)'} → ${av[property] ?? '(absent)'}`
          );
        }
      }
    }
  }
  return differences;
}

/**
 * Drive the panel through the fixed state set, snapping the probe list at each one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(name: string) => Promise<void>} capture
 */
async function walkPanel(page, capture) {
  const dialog = (name) => page.getByRole('dialog', { name });
  /** The id the walk's collection gets, resolved from the DOM (a name lives in an input value). */
  let createdId = '';

  await capture('first-run');

  await step('create collection', async () => {
    await page.locator('#toggleCreateBtn').click();
    const input = page.getByPlaceholder('New collection name');
    await input.fill('Style Probe');
    await input.press('Enter');
    await page
      .locator('#collectionsContainer > .cc-collection')
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });

  // The card the walk created is resolved by its name value: a collection's name lives in an
  // input's `value`, which no selector can match (the same reason `e2e/panel.spec.js` has a helper).
  await step('find the created card', async () => {
    const id = await page.evaluate(() => {
      const inputs = [
        ...document.querySelectorAll('#collectionsContainer input.cc-collection-name'),
      ];
      return inputs.find((input) => input.value === 'Style Probe')?.closest('.cc-collection')
        ?.dataset.id;
    });
    if (!id) throw new Error('the created collection was not found');
    createdId = id;
  });
  const card = () => page.locator(`#collectionsContainer .cc-collection[data-id="${createdId}"]`);

  const addTab = async (title, url) => {
    await card().locator('.cc-collection-menu-btn').click();
    await card().locator('.cc-add-tabs-btn').click();
    const addTabs = dialog('Add Tabs');
    await addTabs.getByLabel('Title').fill(title);
    await addTabs.getByLabel('URL').fill(url);
    await addTabs.getByRole('button', { name: 'Add Tab' }).click();
    await addTabs.waitFor({ state: 'hidden', timeout: PANEL_TIMEOUT_MS });
  };

  await step('add two tabs', async () => {
    await addTab('Probe One', 'https://example.test/one');
    await page.keyboard.press('Escape');
    await addTab('Probe Two', 'https://example.test/two');
  });

  await step('expand the collection', async () => {
    await card().locator('.cc-expand-btn').click();
    await card().locator('.tab-item').first().waitFor({ state: 'visible', timeout: 5000 });
  });
  await capture('populated');

  await step('open the collection menu', async () => {
    await card().locator('.cc-collection-menu-btn').click();
  });
  await capture('collection-menu-open');
  await page.keyboard.press('Escape');

  await step('open the sort menu', async () => {
    await page.locator('.sh-sort-collections-btn').first().click();
  });
  await capture('sort-menu-open');
  await page.keyboard.press('Escape');

  await step('selection mode', async () => {
    await page.locator('#toggleSelectBtn').click();
  });
  await capture('selection-mode');
  await page.locator('#cancelSelectionBtn').click();

  await step('search', async () => {
    await page.locator('#toggleSearchBtn').click();
    await page.getByPlaceholder('Search collections or tabs…').fill('Probe');
  });
  await capture('search-open');
  await page.keyboard.press('Escape');

  await step('create a folder', async () => {
    await page.locator('#createFolderBtn').click();
    await page
      .locator('#collectionsContainer > .cc-folder')
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await capture('with-folder');

  // Collapse before the grid: in grid view an expanded card opens the view-collection modal over
  // the panel, which would intercept every later click (the same trap `css-coverage.mjs` documents).
  await step('collapse the collection before grid', async () => {
    await page.keyboard.press('Escape');
    const expanded = card().locator('.tab-collection-tabs.ut-expanded');
    if ((await expanded.count()) > 0) {
      await card().locator('.cc-expand-btn').click();
      await expanded.first().waitFor({ state: 'detached', timeout: 3000 });
    }
  });

  await step('grid view', async () => {
    await page.locator('#toggleLayoutBtn').click();
    await page.locator('#collectionsContainer.ut-grid-view').waitFor({ state: 'attached' });
  });
  await capture('grid-dark');

  await step('open settings', async () => {
    await page.locator('#settingsBtn').click();
    await dialog('Settings').waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await capture('settings-open');
  await page.keyboard.press('Escape');

  await step('back to the list layout', async () => {
    await page.locator('#toggleLayoutBtn').click();
    await page.locator('#collectionsContainer.ut-grid-view').waitFor({ state: 'detached' });
  });
  await capture('list-dark');

  await step('open history', async () => {
    await page.locator('#historyBtn').click();
    await dialog('Session History').waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  });
  await capture('history-open');
  await page.keyboard.press('Escape');

  await step('light theme in settings', async () => {
    await page.locator('#settingsBtn').click();
    const settings = dialog('Settings');
    await settings.waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
    await settings
      .locator('label.set-toggle-switch:has(#lightModeToggle) .set-toggle-track')
      .click();
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 3000 });
  });
  await capture('settings-light');
  await page.keyboard.press('Escape');
  await capture('light-list');

  await step('light grid', async () => {
    await page.locator('#toggleLayoutBtn').click();
    await page.locator('#collectionsContainer.ut-grid-view').waitFor({ state: 'attached' });
  });
  await capture('light-grid');
}

const NOTE =
  'Computed-style probe baseline (css-migration-plan.md §6). `npm run css:probe` dumps the resolved ' +
  'getComputedStyle of a fixed probe list across a fixed set of panel states and diffs it against ' +
  'this file; any difference fails, and `npm run css:probe:update` accepts the new values. Colours ' +
  'are normalised to 8-bit `rgb(r g b / a)` so a `color-mix()` — which Chrome serialises as ' +
  '`color(srgb …)` — compares equal to the `rgba()` it replaced. Each probe is one line, ' +
  '`count=N;property=value;…`, so the file stays readable; the tool still reports a diff per ' +
  'property.';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    await readdir(DIST);
  } catch {
    console.error('[css] no dist/ to probe — run `npm run build` first');
    process.exitCode = 1;
    return;
  }

  /** @type {Record<string, Record<string, {count: number, values: Record<string, string>}>>} */
  const states = {};

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run'],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];

    const page = await context.newPage();
    await page.setViewportSize(VIEWPORT);
    page.setDefaultTimeout(6000);
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page
      .locator('html[data-theme]')
      .waitFor({ state: 'attached', timeout: PANEL_TIMEOUT_MS });
    await page
      .locator('#collectionsContainer')
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });

    // Fonts settle so wrapped-label metrics are stable, and transitions are switched off so a
    // computed value is never read mid-animation — the noise the throwaway Phase 5 probe hit.
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

    // Keyframe entrance animations (`slideFadeIn`, the modal `in`) are not transitions, so
    // `transition: none` does not stop them — reading `opacity`/`transform` mid-flight is what makes
    // a naive probe flap. Finish every running animation so each state is sampled at its settled
    // value; an infinite animation cannot be finished and is simply left alone.
    const settleAnimations = () =>
      page.evaluate(() => {
        for (const animation of document.getAnimations()) {
          try {
            animation.finish();
          } catch {
            /* an infinite animation (a spinner) cannot be finished */
          }
        }
      });

    // The restore tile appears only once the worker has recorded a session backup, a moment after
    // hydration. The controls bar wraps, so whether that tile is there decides how many rows it
    // needs — a state captured before it lands would be measured against a different layout, and
    // its height would differ from the same state on a slower run. Wait for the tile itself rather
    // than guessing: a watchdog sampling for a quiet bar would pass in the gap before it lands.
    await page
      .locator('#restoreBackupBtn')
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });

    /**
     * Snapshot one panel state.
     *
     * Settling the animations finishes the entrance animation of a toast the state's own action
     * raised, so it is sampled at rest. The wait afterwards then lets that toast clear before the
     * next state, because a toast lives on its own timer: left alone, whether a later state still
     * has one on screen depends on how quickly the walk got there — which is what made `.ts-toast`
     * flap between runs. Each state owns the toast it raises instead of inheriting the last one's.
     *
     * @param {string} name
     */
    const capture = async (name) => {
      await settleAnimations();
      await page.waitForTimeout(120);
      states[name] = canonicalizeSnapshot(await snapshot(page, IGNORE_PROPERTIES[name] ?? {}));
      await page.waitForFunction(() => document.querySelectorAll('.ts-toast').length === 0, null, {
        timeout: PANEL_TIMEOUT_MS,
      });
    };

    await walkPanel(page, capture);
  } finally {
    await context.close();
  }

  /** @type {{note: string, measuredAt: string, version: number, viewport: {width: number, height: number}, properties: string[], probes: string[], states: typeof states}} */
  const current = {
    note: NOTE,
    measuredAt: new Date().toISOString().slice(0, 10),
    version: PROBE_VERSION,
    viewport: VIEWPORT,
    properties: PROPERTIES,
    probes: PROBES,
    states,
  };

  const relative = path.relative(ROOT, BASELINE);

  if (options.update) {
    await writeFile(BASELINE, `${JSON.stringify(serializeBaseline(current), null, 2)}\n`);
    console.log(
      `[css] baseline        wrote ${relative} — ${Object.keys(states).length} states × ` +
        `${PROBES.length} probes`
    );
    return;
  }

  /** @type {ReturnType<typeof deserializeBaseline>} */
  let baseline;
  try {
    baseline = deserializeBaseline(JSON.parse(await readFile(BASELINE, 'utf8')));
  } catch {
    console.error(`[css] no baseline at ${relative} — create it with \`npm run css:probe:update\``);
    process.exitCode = 1;
    return;
  }

  const differences = diffSnapshots(baseline, current);

  if (options.json) {
    console.log(
      JSON.stringify(
        { states: Object.keys(states), differences, differenceCount: differences.length },
        null,
        2
      )
    );
    process.exitCode = differences.length > 0 ? 1 : 0;
    return;
  }

  console.log(
    `[css] probe           ${Object.keys(states).length} states × ${PROBES.length} probes (${relative})`
  );

  if (differences.length === 0) {
    console.log('[css] baseline matches — every probed element still resolves the same');
    return;
  }

  console.log(`[css] ${differences.length} difference(s) from the baseline:`);
  const shown = options.limit > 0 ? differences.slice(0, options.limit) : differences;
  for (const difference of shown) console.log(`        ${difference}`);
  if (shown.length < differences.length) {
    console.log(`        … ${differences.length - shown.length} more (pass --limit=0 for all)`);
  }
  console.log('[css] review each change, then `npm run css:probe:update` to accept it');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('[css] probe failed:', error);
  process.exitCode = 1;
});
