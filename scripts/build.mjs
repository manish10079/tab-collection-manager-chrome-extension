// Build: bundle the React shell (Vite) and compose dist/sidepanel.html from the legacy
// popup.html, then copy the untouched legacy runtime + icons and emit a manifest whose
// side panel points at the composed page.
//
// Why compose instead of keeping a second HTML file: popup.html stays the single source
// of markup during the strangler migration (react-migration-plan.md §8, Phase 1), so the
// legacy DOM and the React container can never drift apart.
//
// This is the only build: the React bundle carries the store, and `popup.js` reads state through
// it, so a copy-without-bundling build would produce a side panel that cannot read or write.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// Legacy runtime copied verbatim — still owned by the old build until it is migrated.
const LEGACY_FILES = ['popup.css', 'popup.js', 'background.js'];
const LEGACY_DIRS = ['icons'];

const RAW_MANIFEST = path.join(root, 'manifest.json');
const SHELL_HTML = path.join(root, 'popup.html');

/** Bundle src/main.jsx (and its CSS) into dist/assets. */
async function bundleReact() {
  await build({ configFile: path.join(root, 'vite.config.js'), mode: 'production' });
}

/** Read the entry record Vite wrote to dist/.vite/manifest.json. */
async function readEntry() {
  const manifestPath = path.join(dist, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const key = Object.keys(manifest).find((candidate) => manifest[candidate].isEntry);
  if (!key) throw new Error('Vite manifest contains no entry');
  return manifest[key];
}

/** Copy the legacy scripts, stylesheet and icons beside the composed page. */
async function copyLegacy() {
  for (const file of LEGACY_FILES) {
    await cp(path.join(root, file), path.join(dist, file));
  }
  for (const dir of LEGACY_DIRS) {
    await cp(path.join(root, dir), path.join(dist, dir), { recursive: true });
  }
}

/**
 * Turn the legacy shell into the side-panel page: keep every legacy tag and its markup,
 * swap the asset tags and append the module script. Since Phase 2 the React mount point
 * (`#collectionsContainer`) lives in popup.html itself — there is no injected container, so
 * the legacy markup and the React tree cannot drift apart.
 *
 * @param {string} shell Raw popup.html
 * @param {{file: string, css?: string[]}} entry Vite entry record
 * @returns {string}
 */
function composeHtml(shell, entry) {
  const styleLinks = ['./popup.css', ...(entry.css ?? []).map((file) => `./${file}`)]
    .map((href) => `  <link rel="stylesheet" href="${href}">`)
    .join('\r\n');

  const html = shell
    // Drop the tags that pointed at unhashed root files; re-injected below.
    .replace(/[ \t]*<link rel="stylesheet" href="popup\.css">\r?\n/, '')
    .replace(/[ \t]*<script src="popup\.js"><\/script>\r?\n/, '')
    .replace('</head>', `${styleLinks}\r\n</head>`)
    .replace(
      '</body>',
      `  <script src="./popup.js"></script>\r\n  <script type="module" src="./${entry.file}"></script>\r\n</body>`
    );

  const checks = {
    'React mount point present': html.includes('id="collectionsContainer"'),
    'legacy collection template removed': !html.includes('id="collectionTemplate"'),
    'legacy settings modal removed': !html.includes('id="settingsModal"'),
    'legacy add-tabs modal removed': !html.includes('id="addTabsModal"'),
    'legacy duplicate dialog removed': !html.includes('id="duplicateUrlDialog"'),
    'legacy history modal removed': !html.includes('id="historyModal"'),
    'legacy session details modal removed': !html.includes('id="sessionDetailsModal"'),
    'legacy shortcuts help modal removed': !html.includes('id="shortcutsHelpModal"'),
    'legacy open-tab template removed': !html.includes('id="openTabTemplate"'),
    'legacy toast container removed': !html.includes('id="toastContainer"'),
    'legacy markup preserved': html.includes('<div class="scrollable-content">'),
    'React bundle injected': html.includes(entry.file),
    'legacy stylesheet re-linked': html.includes('href="./popup.css"'),
    'legacy script re-linked': html.includes('src="./popup.js"'),
    'old stylesheet tag removed': !html.includes('href="popup.css"'),
    'old script tag removed': !html.includes('<script src="popup.js">'),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`composed HTML failed checks: ${failed.join(', ')}`);
  }

  return html;
}

/** Emit dist/manifest.json with the side panel pointed at the composed page. */
async function writeManifest() {
  const source = JSON.parse(await readFile(RAW_MANIFEST, 'utf8'));
  const manifest = {
    ...source,
    side_panel: { ...(source.side_panel ?? {}), default_path: 'sidepanel.html' },
  };
  await writeFile(
    path.join(dist, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
}

async function main() {
  await mkdir(dist, { recursive: true });

  await bundleReact();
  const entry = await readEntry();

  await copyLegacy();

  const shell = await readFile(SHELL_HTML, 'utf8');
  await writeFile(path.join(dist, 'sidepanel.html'), composeHtml(shell, entry), 'utf8');

  const manifest = await writeManifest();

  // Build metadata is not part of the extension.
  await rm(path.join(dist, '.vite'), { recursive: true, force: true });

  console.log(`[build] sidepanel.html composed from popup.html + ${entry.file}`);
  console.log(`[build] legacy assets copied: ${[...LEGACY_FILES, ...LEGACY_DIRS].join(', ')}`);
  console.log(`[build] manifest side panel -> ${manifest.side_panel.default_path}`);
  console.log('[build] Load dist/ unpacked at chrome://extensions to verify.');
}

main().catch((error) => {
  console.error('[build] failed:', error.message);
  process.exit(1);
});
