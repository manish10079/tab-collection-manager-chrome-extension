// Fixtures that load the built extension once per test (react-migration-plan.md §9).
//
// A fresh persistent profile per test is deliberate: `chrome.storage.local` starts empty, so every
// test sees the same first-run panel instead of inheriting what the previous one wrote.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect } from '@playwright/test';
import { createTabServer } from './support/tabServer.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/**
 * @typedef {object} ExtensionFixtures
 * @property {import('@playwright/test').BrowserContext} context  Persistent profile with dist/ loaded
 * @property {import('@playwright/test').Worker} serviceWorker    The extension's MV3 worker
 * @property {string} extensionId                                 The id the worker reports for itself
 * @property {import('@playwright/test').Page} panel              The side panel page, hydrated
 * @property {{url: (name: 'alpha'|'beta') => string, close: () => Promise<void>}} tabServer
 */

/** @type {import('@playwright/test').TestType<ExtensionFixtures & import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */
export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // `channel: 'chromium'` = the Chromium Playwright ships. Branded Chrome and Edge no longer
      // accept these flags, and this channel is also what allows extensions in headless mode.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        // The panel's "close" affordance and the side-panel API are desktop-only surfaces.
        '--no-first-run',
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    // MV3 workers idle-suspend; Playwright keeps this handle valid across a restart.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2]);
  },

  panel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // `data-theme` is written by `useThemeAttribute` only once the store has hydrated, so waiting
    // for it keeps every assertion in a spec off the pre-hydration paint.
    await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
    await expect(page.locator('#collectionsContainer')).toBeVisible();
    await use(page);
    // The panel's own "close" shortcut ends in `window.close()`, so the page may already be gone.
    if (!page.isClosed()) await page.close();
  },

  tabServer: async ({}, use) => {
    const server = await createTabServer();
    await use(server);
    await server.close();
  },
});

export { expect };
