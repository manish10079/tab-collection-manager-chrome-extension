// Playwright end-to-end config (react-migration-plan.md §9). This is the half of the suite jsdom
// cannot reach: the real service worker, the real `chrome.*` APIs, the real stylesheet, and the
// packaged extension loading at all — the step that used to be "load dist/ unpacked by hand".
//
// Chromium comes from Playwright rather than from the machine on purpose: branded Chrome and Edge
// removed the `--load-extension` / `--disable-extensions-except` flags in 2025, so the bundled
// Chromium is the only build that can side-load the extension. `channel: 'chromium'` is also what
// lets that happen in headless mode, which is the default here.
//
// Run it with `npm run e2e`, which builds `dist/` first — the tests exercise the packaged
// extension, not the sources.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Vitest owns `src/**` and `tests/**`; keeping the specs in `e2e/` means neither runner has to
  // exclude the other's files.
  // One worker on purpose: every test loads `dist/` into its own persistent browser profile, so
  // parallel workers would spawn several browsers for no gain and make failures harder to read.
  workers: 1,
  fullyParallel: false,
  // Booting a service worker and hydrating the store takes noticeably longer than a jsdom test.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    video: 'off',
  },
});
