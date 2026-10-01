import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase 5.3 deleted the legacy shell, so the invariants that used to be checked against `popup.js`
 * (no second write queue, no direct storage write, no React-facing seam) can no longer be checked
 * by reading it — the file has to be gone, and that is what these tests assert.
 *
 * The remaining checks scan the sources for the shapes that would mean a seam crept back in. Test
 * files are skipped: they legitimately mention `chrome.storage.local.set` and reset `innerHTML`.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.freebuff', 'icons']);

/**
 * Every non-test source file under `src/`, relative to the project root.
 *
 * @returns {string[]}
 */
function sourceFiles() {
  const found = [];

  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(js|jsx)$/.test(entry.name) && !/\.(test|spec)\.(js|jsx)$/.test(entry.name)) {
        found.push(path.relative(ROOT, full));
      }
    }
  }

  walk(path.join(ROOT, 'src'));
  return found;
}

describe('legacy shell removed', () => {
  it('deletes popup.html, popup.js and the store bridge', () => {
    expect(existsSync(path.join(ROOT, 'popup.html'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'popup.js'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'src', 'app', 'legacy-store.js'))).toBe(false);
  });

  it('ships a Vite HTML entry instead', () => {
    const entry = readFileSync(path.join(ROOT, 'src', 'sidepanel.html'), 'utf8');
    expect(entry).toMatch(/id="root"/);
    expect(entry).toMatch(/src="\.\/main\.jsx"/);
  });

  it('leaves no legacy global seams in the sources', () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      expect(source, `${file} exposes window.__tcmStore`).not.toMatch(/__tcmStore/);
      expect(source, `${file} exposes window.__tcmReact`).not.toMatch(/__tcmReact/);
      expect(source, `${file} exposes TCMLegacyUI`).not.toMatch(
        /(?:window|globalThis)\.TCMLegacyUI\s*=/
      );
    }
  });

  it('writes storage only through the store', () => {
    const writers = sourceFiles().filter((file) =>
      /chrome\.storage\.local\.set/.test(readFileSync(path.join(ROOT, file), 'utf8'))
    );

    expect(writers).toEqual([path.join('src', 'store', 'store.js')]);
  });

  it('builds no HTML strings', () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      expect(source, `${file} assigns innerHTML`).not.toMatch(/innerHTML\s*=/);
    }
  });
});
