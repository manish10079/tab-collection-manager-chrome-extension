# ADR-0010: The service worker is ES modules bundled from `background/`

- Status: accepted
- Date: 2026-10-02
- Context: `react-migration-plan.md` §8, Phase 6 ("Background modernization") and Phase 7 ("Store readiness")

## Context

`background.js` was the last vanilla file in the repository: 1,294 lines, one flat script, excluded
from ESLint and Prettier, and deliberately never touched while the UI moved to React. Nothing was
broken by that — it was a maintainability debt. Every decision the autosave engine makes (which URLs
count as saveable, when a small snapshot is a partial restore, how the max-pin limit is applied when
a snapshot is merged with what was saved) lived inline in a file no test could reach without
launching a browser.

Phase 7's audit also had a concrete finding: `downloads` was in the manifest solely for a "daily
local backup" that nothing ever scheduled. Two functions (`scheduleDailyLocalBackup`,
`performLocalBackup`) and their alarm branch existed, but no code path reached them.

## Decision

### Split the worker into modules

- The worker moves to `background/`, with the entry at `background/index.js` wiring the listeners and
  focused modules for each capability: `state.js` (read/write + the serialized update queue),
  `autosave.js`, `restore.js`, `contextMenu.js`, `gdrive.js`, `messages.js` (the message router),
  `panel.js`, `chromeGroups.js` and `bootstrap.js` (the Current Session invariant). `runtime.js`
  holds the non-durable flags (`isRestoring`, `startupTime`, the debounce handle).
- `background/lib/tabs.js` and `background/lib/duplicates.js` hold the **pure** decisions — URL
  filtering, snapshotting, grouping, capping, identity-preserving merge, the partial-restore guard,
  duplicate detection — so they are unit-testable without a browser (skill.md §3.3).
- The worker imports the frozen contract from `src/shared/` (`STORAGE_KEYS`, `LIMITS`,
  `CURRENT_SESSION_ID`) instead of re-typing keys, and the pure group-id normaliser from
  `src/lib/tabGroups.js`. No storage key, storage shape or message command changed — the migration's
  central guarantee.
- `background/api.js` resolves the Chrome/`browser` global through a `Proxy` rather than capturing it
  at module load, so a late polyfill — and the test setup, which swaps `globalThis.chrome` between
  cases — is honoured.

### Bundle the worker instead of copying it

- `scripts/build.mjs` gains `bundleWorker()`: a second Vite build of `background/index.js`, emitted as
  a single `dist/background.js` (ES, minified, no source map). `manifest.json` keeps
  `background.js` at the extension root, so the manifest, the packaged layout and the E2E assertion on
  the worker URL are all unchanged.
- Copying the directory was rejected: the worker's imports would have to survive `dist/src/` being
  removed (the UI's emitted page directory), and the shared contract is not emitted there.

### Remove the unused permission and its only user

- The dormant local-daily-backup module is deleted, and with it the `downloads` permission. Removing a
  permission is a feature (skill.md §5.4); nothing else reads `chrome.downloads` (the panel's
  export/import use a Blob and a synthetic anchor click in `src/lib/download.js`).
- `manifest.json` otherwise stays as it was: `side_panel.default_path` still points at
  `sidepanel.html`, and there is still no `action.default_popup`, so the toolbar icon opens the panel.

## Consequences

- ESLint and Prettier now cover the whole repository except `src/styles/panel.css` (kept excluded on
  purpose, skill.md §4.3); the worker's exclusion is gone.
- `dist/background.js` is a bundled 18 kB (6 kB gzipped) instead of a copied 40 kB, and `dist/` is
  1.12 MB.
- 34 new unit tests cover the autosave guards and the tab-group rebuild; the suite is 230 tests in
  29 files. The Playwright walk still passes (7 specs), so the bundled module worker runs under MV3
  and its message protocol is intact.
- One sharp edge is preserved rather than fixed: `updateState`'s promise chain keeps a rejection on
  the chain, so a failed update can poison later ones. Changing that is a behavioural change and is
  out of scope for a port whose acceptance is "autosave behaviour unchanged".
- Every icon path, storage key and message command is identical, so existing profiles need no
  migration.

## Alternatives considered

- **Keep `background.js` as one file and only lint/format it.** Rejected: it leaves the decisions
  untestable, which was the actual debt.
- **Move the worker to `background/index.js` and copy the directory, updating the manifest path.**
  Rejected: breaks the packaged path (and the E2E assertion), and the shared-contract imports would
  point into a deleted `dist/src/`.
- **Copy a curated list of `src/shared` files into `dist/`.** Rejected as fragile: the copy list has to
  track the worker's import graph by hand.
- **Port to TypeScript as the plan's Phase 6 text says.** Rejected: `skill.md` 2.0.0 reversed the
  language rule — this is a JavaScript + JSDoc codebase.
- **Fix the `updateState` poisoning while porting.** Deferred: the port's whole point is that autosave
  behaviour does not change; a fix deserves its own change and tests.
- **Keep the dormant local backup and its permission.** Rejected: it is unreachable code and an
  unjustified permission.
