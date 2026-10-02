// Build: bundle the whole side panel with Vite and assemble the loadable extension in dist/.
//
// Since Phase 5.3 Vite owns the page: `src/sidepanel.html` is the HTML entry, so the bundle's
// hashed script and stylesheet are injected by Vite and there is no composition step and no legacy
// script to copy (react-migration-plan.md §8). What remains here is the extension plumbing Vite
// knows nothing about — the worker, the icons, the manifest — plus the checks that the legacy
// shell really is gone.
import { cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/** Copied verbatim. The service worker is bundled separately (see `bundleWorker`). */
const COPY_FILES = ['manifest.json'];
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
 * Bundle the service worker into `dist/background.js`.
 *
 * Since Phase 6 the worker is ES modules under `background/` that import the frozen shared contract
 * from `src/shared/`, so it can no longer be copied file-by-file. `manifest.json` still names
 * `background.js` at the extension root, which is exactly where this emits; bundling collapses the
 * module graph into that one file and keeps the copied extension free of `dist/src/` (the UI's
 * emitted page directory, which is removed) and of any remote code (skill.md §5.4).
 */
async function bundleWorker() {
  await build({
    configFile: false,
    root,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: false,
      target: 'esnext',
      minify: true,
      rollupOptions: {
        input: path.join(root, 'background', 'index.js'),
        output: { entryFileNames: 'background.js', format: 'es' },
      },
    },
  });
}

/**
 * Every file under `directory`, as absolute paths.
 *
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else found.push(full);
  }
  return found;
}

/**
 * Find a file by name anywhere under `directory`.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {Promise<string|null>} Absolute path, or null
 */
async function findFile(directory, name) {
  const match = (await listFiles(directory)).find((file) => path.basename(file) === name);
  return match ?? null;
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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

/** Font formats we never ship: `.woff2` covers every Chrome MV3 target, so the older fallbacks
 * just duplicate payload. `.ttf`/`.otf`/`.eot` only exist for ancient browsers. */
const TRIMMED_FONT_EXTENSIONS = new Set(['.woff', '.ttf', '.eot', '.otf']);

/**
 * Identify one logical font across formats.
 *
 * Vite hashes each emitted file separately, so `inter-latin-400-normal-<hash>.woff` and
 * `inter-latin-400-normal-<other>.woff2` are the same font in two formats. Dropping the trailing
 * 8-character content hash and the extension makes them comparable.
 *
 * @param {string} file
 */
function logicalFontKey(file) {
  return path.basename(file, path.extname(file)).replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/** Strip surrounding quotes and a leading `/` so a reference can be resolved against dist/. */
function referenceToDistPath(reference) {
  const clean = reference.replace(/^['"]|['"]$/g, '').split(/[?#]/)[0];
  const relative = clean.startsWith('/') ? clean.slice(1) : clean;
  return path.join(dist, relative);
}

/** Every `assets/...` reference in an emitted HTML or CSS file. */
function assetReferences(source) {
  const found = new Set();
  for (const match of source.matchAll(/url\(\s*([^)]+?)\s*\)/g)) {
    if (match[1].includes('/assets/')) found.add(match[1]);
  }
  for (const match of source.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * Delete duplicate font formats from dist/assets, keeping only `.woff2`.
 *
 * Vite emits every `src` in a font's `@font-face` rule, so `@fontsource/inter` ships woff2 plus
 * woff and Font Awesome ships woff2 plus ttf. Shipping only the modern format keeps rendering
 * identical while roughly halving the package.
 *
 * @returns {Promise<{removed: number, bytes: number}>}
 */
async function trimFontFallbacks() {
  const assets = path.join(dist, 'assets');
  let removed = 0;
  let bytes = 0;
  for (const file of await listFiles(assets)) {
    if (!TRIMMED_FONT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    bytes += (await stat(file)).size;
    await rm(file, { force: true });
    removed += 1;
  }
  return { removed, bytes };
}

/**
 * Verify nothing the page or its stylesheets reference went missing.
 *
 * The one sanctioned gap is a trimmed font fallback: `url(...woff2)` and `url(...ttf)` both sit in
 * one `@font-face`, and dropping the ttf is only safe because its `.woff2` sibling survived. Any
 * other dangling reference — a truncated stylesheet, a mistyped hash — is a build failure.
 */
async function assertReferencedAssetsExist() {
  const assets = path.join(dist, 'assets');
  const existing = await listFiles(assets);
  const woff2Fonts = new Set(
    existing.filter((file) => file.endsWith('.woff2')).map(logicalFontKey)
  );

  const sources = [path.join(dist, SIDE_PANEL), ...existing.filter((f) => f.endsWith('.css'))];
  const missing = [];
  for (const source of sources) {
    for (const reference of assetReferences(await readFile(source, 'utf8'))) {
      const target = referenceToDistPath(reference);
      try {
        await stat(target);
      } catch {
        const trimmable = TRIMMED_FONT_EXTENSIONS.has(path.extname(target).toLowerCase());
        if (!trimmable || !woff2Fonts.has(logicalFontKey(target))) missing.push(reference);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`dist/ is missing referenced assets: ${[...new Set(missing)].join(', ')}`);
  }
}

/**
 * Total bytes of every file under `directory`.
 *
 * @param {string} directory
 * @returns {Promise<number>}
 */
async function directorySize(directory) {
  let total = 0;
  for (const file of await listFiles(directory)) {
    total += (await stat(file)).size;
  }
  return total;
}

async function main() {
  await mkdir(dist, { recursive: true });

  await bundle();
  const page = await relocateEntry();

  await bundleWorker();
  await copyStatic();

  const html = await readFile(page, 'utf8');
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  assertPage(html, manifest);

  // Build metadata and source maps are not part of the extension.
  await rm(path.join(dist, '.vite'), { recursive: true, force: true });
  for (const asset of await readdir(path.join(dist, 'assets'))) {
    if (asset.endsWith('.map')) await rm(path.join(dist, 'assets', asset), { force: true });
  }

  const trimmed = await trimFontFallbacks();
  await assertReferencedAssetsExist();

  const size = await directorySize(dist);
  console.log(
    `[build] side panel -> ${path.relative(root, page)} (from ${path.relative(root, ENTRY_HTML)})`
  );
  console.log(
    `[build] dropped ${trimmed.removed} non-woff2 font files (${formatSize(trimmed.bytes)}); dist is ${formatSize(size)}`
  );
  console.log(`[build] bundled background/ -> background.js`);
  console.log(`[build] copied: ${[...COPY_FILES, ...COPY_DIRS].join(', ')}`);
  console.log('[build] Load dist/ unpacked at chrome://extensions to verify.');
}

main().catch((error) => {
  console.error('[build] failed:', error.message);
  process.exit(1);
});
