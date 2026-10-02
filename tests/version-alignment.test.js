import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import { installChromeMock } from './mocks/chrome.js';

/**
 * `manifest.json` is the single source of truth for the extension version (skill.md §7). The
 * package metadata, the feature list's title and the chrome mock each repeated it, and three of
 * them drifted to three different values at once — so this asserts the copies cannot diverge again.
 *
 * The other version axes are deliberately not checked here: the storage schema, the message
 * protocol, `skill.md`'s document version and `react-migration-plan.md`'s document version are
 * independent (skill.md §7), and conflating them is the thing this test exists to prevent.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} relative */
function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

describe('extension version alignment', () => {
  it('keeps package.json on the manifest version', () => {
    expect(readJson('package.json').version).toBe(manifest.version);
  });

  it('keeps both lockfile version fields on the manifest version', () => {
    const lock = readJson('package-lock.json');
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].version).toBe(manifest.version);
  });

  it('keeps the feature list title on the manifest version', () => {
    const title = readFileSync(path.join(ROOT, 'feature_list.md'), 'utf8').split('\n')[0];
    expect(title).toBe(`# Tab Collection Manager v${manifest.version}`);
  });

  it('reports the manifest version through the chrome mock', () => {
    const { chrome } = installChromeMock();
    expect(chrome.runtime.getManifest()).toMatchObject({
      name: manifest.name,
      version: manifest.version,
    });
  });
});
