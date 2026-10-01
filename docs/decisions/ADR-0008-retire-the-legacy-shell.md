# ADR-0008: The legacy shell is deleted; Vite owns the side-panel page

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §8, Phase 5.3 ("Retire the shell")
- Supersedes: the composition build from Phase 1, and the state bridge ADR-0004 kept for `popup.js`

## Context

After ADR-0007 the panel was React-rendered, but three pieces of the old world were still load
bearing:

- **`popup.html` was the build's single source of markup.** `scripts/build.mjs` read it, stripped
  two asset tags and re-injected hashed ones plus the bundle, then wrote `dist/sidepanel.html`. The
  page therefore could not be previewed or served by Vite, and every asset path was composed by
  hand.
- **`popup.js` was a classic script with a start-up job.** It applied the persisted theme, asked the
  worker for an auto-save, re-read storage, and normalised the opened state (collapse every
  collection, backfill `addedAt`, drop a stale Auto-Save id). It was the last file in the extension
  ESLint and Prettier had to exclude.
- **`src/app/legacy-store.js` published `window.__tcmStore`**, a flat-shape bridge over the store
  whose only caller was `popup.js`. With the script gone the bridge is dead weight, and keeping it
  would keep the door open for a second writer.

`tests/legacy-state-contract.test.js` existed to police `popup.js` by reading its source: no second
write queue, no direct `chrome.storage.local.set`, no React-facing seam. That test only makes sense
while the file exists.

## Decision

- **`src/sidepanel.html` is the Vite HTML entry.** Vite owns the page and emits it with the hashed
  module script and stylesheet injected; `popup.html` is deleted and `scripts/build.mjs` no longer
  composes HTML. Vite's root stays at the repository root (moving it into `src/` would break
  `tests/**` discovery), so the emitted page lands in `dist/src/sidepanel.html`.
- **`build.mjs` relocates the emitted page to `dist/sidepanel.html`.** Vite's asset URLs are
  origin-absolute (`/assets/...`), so they resolve against the extension origin wherever the page
  sits. The move keeps `manifest.json`'s `default_path` (`sidepanel.html`), the packaged layout and
  the page-relative `icons/...` references exactly as they were.
- **The boot sequence is React.** `useThemeAttribute` is the only place that sets `data-theme`, at
  the same moment the deleted script did (right after the first hydration). `useBootSequence` sends
  the worker `forceAutoSave`, re-reads, and normalises the opened state through the new
  `src/store/openedState.js` — a pure draft mutator, applied via the store's own `mutate()` queue.
  It runs after the first paint, as `popup.js` did, so the panel is never blocked on a worker
  round-trip.
- **The state bridge is deleted** with `src/app/legacy-store.js`, and `main.jsx` no longer publishes
  anything. There is exactly one importer of the store now: the React tree.
- **The build asserts the new shape** instead of the old one: the page has `#root`, a bundled module
  script and a bundled stylesheet, and none of the legacy ids, no `popup.js` and no classic script
  tag.
- **The contract test is replaced by `tests/legacy-shell-removed.test.js`**, which asserts the
  deleted files are absent, `src/sidepanel.html` is the entry, no source exposes `__tcmStore`,
  `__tcmReact` or a `TCMLegacyUI` assignment, only `src/store/store.js` calls
  `chrome.storage.local.set`, and nothing assigns `innerHTML`.
- **`manifest.json` changes one field**: `side_panel.default_path` from `popup.html` to
  `sidepanel.html`. It is the only manifest change and it accompanies the file it points at.

## Consequences

- The packaged extension is `manifest.json`, `background.js`, `sidepanel.html`, `icons/` and
  `assets/` — no legacy files, no source maps, no build metadata.
- Prettier's and ESLint's exclusions shrink to `background.js` (Phase 6) and `popup.css` (Phase 5.4).
  Everything the old shell owned is now linted because it is React.
- `dist/sidepanel.html` can be opened by any static server (`vite preview`), which is what makes a
  browser smoke check possible without loading the extension.
- The dead-CSS sweep in Phase 5.4 has a clear boundary: `popup.css` is now only reachable through
  the Vite entry, so any rule no React component uses is safely removable.
- Rollback is coarser than before: one commit deletes the shell and changes the build. Restoring the
  old script would mean reverting this commit and re-adding the ESLint/Prettier exclusions.
- Losing `popup.js` also loses the only build-independent way to run the panel, which was already
  impossible since Phase 3 (ADR-0004) — `dist/` was already the only loadable build.
- No storage key, storage shape or message-protocol change; `background.js` is untouched.

## Alternatives considered

- **Move Vite's root to `src/`** so the emitted page lands at `dist/sidepanel.html` on its own.
  Rejected: `tests/setup.js`, the include globs and every tooling path are root-relative, and
  vitest's root would have to be overridden separately — more machinery than the one-line relocate
  it saves.
- **Keep `popup.html` as a thin Vite entry beside the other configs.** Rejected: the file is the
  migration's namesake; leaving a `popup.html` that is not the popup invites exactly the confusion
  this phase exists to end.
- **Move the boot sequence into `main.jsx` before `createRoot`, awaited.** Rejected: it would block
  the first paint on a worker round-trip (`forceAutoSave`), which is a user-visible regression for
  no benefit — the theme does not depend on it.
- **Keep `window.__tcmStore` for debugging.** Rejected: an unused global that can write state is a
  second write path waiting to be used, which is the invariant ADR-0004 established.
- **Keep `tests/legacy-state-contract.test.js` as-is.** Rejected: it read a file that no longer
  exists, and the properties it checked are now better asserted against the sources that survive.
