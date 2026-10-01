import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `popup.js` is a classic script: no test can import it, it is excluded from ESLint, and it is the
 * one file where a stray `chrome.storage.local.set` would quietly re-open the race ADR-0004 closed.
 * So the invariant is checked against its source instead.
 *
 * The rule: every write goes through the store's serialized queue. Phase 4 removed the last direct
 * write — the GDrive flags, which the React settings modal now owns through the store — so the
 * check has nothing left to carve out.
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
    expect(SOURCE).toMatch(/async function updateState\(mutator\)/);
  });

  it('never writes storage directly', () => {
    expect(SOURCE).not.toMatch(/storage\.local\.set/);
  });

  /**
   * Phase 5.1 moved every `window.TCMLegacyUI` action into React (react-migration-plan.md §8), so
   * the adapter that served it is deleted. Re-introducing the seam would silently send collection
   * mutations back through this file.
   */
  it('no longer exposes a React-facing action seam', () => {
    expect(SOURCE).not.toMatch(/window\.TCMLegacyUI\s*=/);
  });
});
