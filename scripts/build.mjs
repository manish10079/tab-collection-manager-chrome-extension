// Build: bundle the whole side panel with Vite and assemble the loadable extension in dist/.
//
// Since Phase 5.3 Vite owns the page: `src/sidepanel.html` is the HTML entry, so the bundle's
// hashed script and stylesheet are injected by Vite and there is no composition step and no legacy
// script to copy (react-migration-plan.md §8). What remains here is the extension plumbing Vite
// knows nothing about — the worker, the icons, the manifest — plus the checks that the legacy
// shell really is gone.
import { cp, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/** Copied verbatim. `background.js` is still the vanilla service worker (Phase 6 scope). */
const COPY_FILES = ['background.js', 'manifest.json'];
/** Copied recursively. */
const COPY_DIRS = ['icons'];
/** Where the source manifest says the side panel lives. */
const SIDE_PANEL = 'sidepanel.html';
const ENTRY_HTML = path.join(root, 'src', 'sidepanel.html');

/** Bundle src/sidepanel.html (and its React tree) into dist/. */
async function bundle() {
  await build({ configFile: path.join(root, 'vite.config.js'), mode: 'production' });
}

/**
 * Find a file by name anywhere under `directory`.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {Promise<string|null>} Absolute path, or null
 */
async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/**
 * Move Vite's emitted page to the extension root.
 *
 * Vite mirrors an HTML entry's path relative to its root, so `src/sidepanel.html` lands in
 * `dist/src/`. The emitted asset URLs are absolute (`/assets/...`), so they resolve against the
 * extension origin wherever the page sits — moving it to the root keeps `default_path`, the icon
 * references (`icons/...`, resolved relative to the page) and the packaged layout identical to the
 * pre-migration extension.
 */
async function relocateEntry() {
  const emitted = await findFile(dist, SIDE_PANEL);
  if (!emitted) {
    throw new Error(`Vite emitted no ${SIDE_PANEL} under dist/`);
  }

  const target = path.join(dist, SIDE_PANEL);
  if (emitted !== target) {
    await rename(emitted, target);
    // Drop the now-empty `dist/src/` Vite created for the entry's directory.
    await rm(path.dirname(emitted), { recursive: true, force: true });
  }
  return target;
}

/** Copy the worker, icons and manifest into dist/. */
async function copyStatic() {
  for (const file of COPY_FILES) {
    await cp(path.join(root, file), path.join(dist, file));
  }
  for (const dir of COPY_DIRS) {
    await cp(path.join(root, dir), path.join(dist, dir), { recursive: true });
  }
}

/**
 * Fail the build if the page is not what the extension needs. These replaced the "legacy markup
 * preserved" checks the composition build used: the interesting property is now that the legacy
 * shell is absent and the bundle is wired in.
 *
 * @param {string} html Composed-or-emitted side panel page
 * @param {string} manifest Parsed manifest.json
 */
function assertPage(html, manifest) {
  const checks = {
    'React root present': html.includes('id="root"'),
    'container shell present': html.includes('class="container" id="root"'),
    'bundled module script injected': /<script type="module"[^>]+src="\/assets\/[^"]+\.js"/.test(
      html
    ),
    'bundled stylesheet linked': /<link rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/.test(
      html
    ),
    'no classic script tag': !/<script (?!type="module")[^>]*src=/.test(html),
    'legacy script gone': !html.includes('popup.js'),
    'legacy header gone': !html.includes('id="settingsBtn"'),
    'legacy controls bar gone': !html.includes('id="actionsBarDefault"'),
    'legacy collections container gone': !html.includes('id="collectionsContainer"'),
    'legacy search results container gone': !html.includes('id="searchResultsContainer"'),
    'manifest points at the entry': manifest.side_panel?.default_path === SIDE_PANEL,
  };

  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`side panel failed checks: ${failed.join(', ')}`);
  }
}

async function main() {
  await mkdir(dist, { recursive: true });

  await bundle();
  const page = await relocateEntry();

  await copyStatic();

  const html = await readFile(page, 'utf8');
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  assertPage(html, manifest);

  // Build metadata and source maps are not part of the extension.
  await rm(path.join(dist, '.vite'), { recursive: true, force: true });
  for (const asset of await readdir(path.join(dist, 'assets'))) {
    if (asset.endsWith('.map')) await rm(path.join(dist, 'assets', asset), { force: true });
  }

  const assets = await readdir(path.join(dist, 'assets'));
  console.log(
    `[build] side panel -> ${path.relative(root, page)} (from ${path.relative(root, ENTRY_HTML)})`
  );
  console.log(`[build] assets: ${assets.join(', ')}`);
  console.log(`[build] copied: ${[...COPY_FILES, ...COPY_DIRS].join(', ')}`);
  console.log('[build] Load dist/ unpacked at chrome://extensions to verify.');
}

main().catch((error) => {
  console.error('[build] failed:', error.message);
  process.exit(1);
});
