import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `popup.js` is the last classic script: no test can import it, it is excluded from ESLint, and it
 * is the one file where a stray `chrome.storage.local.set` would quietly re-open the race ADR-0004
 * closed. So the invariants are checked against its source instead.
 *
 * Since Phase 5.2 the file is only the boot sequence — theme, worker auto-save and opened-state
 * normalisation — so it should be small and free of both write paths and legacy seams. It is
 * deleted in Phase 5.3.
 */
// Relative to the project root, which is where Vitest runs from.
const SOURCE = readFileSync('popup.js', 'utf8').replace(/\r\n/g, '\n');

describe('popup.js state contract', () => {
  it('has no write queue of its own', () => {
    expect(SOURCE).not.toMatch(/updateQueue/);
    expect(SOURCE).not.toMatch(/^async function setState\(/m);
  });

  it('reaches the store through the published bridge', () => {
    expect(SOURCE).toMatch(/globalThis\.__tcmStore/);
    expect(SOURCE).toMatch(/mutateLegacy/);
  });

  it('never writes storage directly', () => {
    expect(SOURCE).not.toMatch(/storage\.local\.set/);
  });

  /**
   * Phase 5.1 deleted the `window.TCMLegacyUI` action adapter and Phase 5.2 deleted the
   * `window.__tcmReact` reverse seam with the legacy header, controls bar and global shortcuts.
   * Re-introducing either would silently put panel Chrome back in this file.
   */
  it('no longer exposes a React-facing seam', () => {
    expect(SOURCE).not.toMatch(/window\.TCMLegacyUI\s*=/);
    expect(SOURCE).not.toMatch(/__tcmReact/);
  });
});
