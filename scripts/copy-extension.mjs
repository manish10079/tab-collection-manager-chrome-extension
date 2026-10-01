// Phase 0 build: copy the current (vanilla) extension into dist/ unchanged.
// This guarantees a loadable, MV3-valid build before the React app exists, so
// `npm run build` + "Load unpacked" always works at any commit.
// Phase 1 replaces this script with `vite build` (see react-migration-plan.md §8).
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');

// Everything the manifest references, plus the UI the side panel loads.
const ENTRIES = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'icons'];

const REQUIRED = ['manifest.json', 'background.js'];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const copied = [];
  for (const entry of ENTRIES) {
    const from = path.join(root, entry);
    if (!(await exists(from))) {
      console.warn(`[copy] skipped (not found): ${entry}`);
      continue;
    }
    await cp(from, path.join(out, entry), { recursive: true });
    copied.push(entry);
  }

  const missing = REQUIRED.filter((entry) => !copied.includes(entry));
  if (missing.length > 0) {
    throw new Error(`[copy] required entries missing from source: ${missing.join(', ')}`);
  }

  console.log(`[copy] dist/ built with ${copied.length} entries: ${copied.join(', ')}`);
  console.log('[copy] Load dist/ unpacked at chrome://extensions to verify.');
}

main().catch((error) => {
  console.error('[copy] build failed:', error.message);
  process.exit(1);
});
