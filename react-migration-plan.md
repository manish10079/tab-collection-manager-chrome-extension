# React Migration Plan — Tab Collection Manager

| Field | Value |
|---|---|
| Document version | 1.17.4 |
| Status | Phases 0-8 complete (5.1-5.4, 6, 7 and the folder hierarchy in 8); the vanilla UI is gone, the bundle is self-contained and `dist/` loads nothing remotely (see §2.1 and the changelog) |
| Scope | UI layer of the MV3 extension (`src/sidepanel.html`, `src/`, `src/styles/`) |
| Out of scope | New features, `background.js` rewrite (deferred to Phase 6), Firefox support |

---

## 1. Goals & non-goals

**Goals**

- Replace the imperative DOM code with React components while keeping the extension fully
  functional at every commit (strangler / incremental migration, not big-bang).
- Zero data migration: existing `chrome.storage.local` keys and the `background.js` message
  protocol stay byte-compatible.
- Introduce a real build pipeline (bundling, minification, HMR, type-checking) that the
  project currently lacks.

**Non-goals (initially)**

- Rewriting the service worker (keep `background.js` vanilla through Phase 5).
- Changing UX/design or adding missing features (folders, sharing, AI). Those land after the
  migration is complete.
- Firefox support — the manifest is Chrome-only today.

---

## 2. Current architecture audit

The table below is the **baseline measured for plan v1.0.0**, before any React code existed. For
the live state see §2.1.

| Layer | Size | Notes |
|---|---|---|
| `popup.html` | 657 lines | 7 modals, 3 `<template>` blocks, 0 inline handlers (MV3-safe), Font Awesome + Google Fonts via CDN |
| `popup.js` | ~3,600 lines | ~77 functions, 30 sections; read -> clone -> modify -> save -> render; full re-render on `storage.onChanged` |
| `popup.css` | ~2,870 lines | CSS variables, glassmorphism, modal/settings sections |
| `background.js` | ~1,290 lines | Autosave + debounce + guards, session history, context menus, alarms, GDrive, restore + tab groups |
| Build | none | Hand-written manifest, no bundler, no deps, no tests |

### 2.1 State at plan v1.17.0

Phases 0-8 complete. The vanilla UI is gone — no `popup.html`, no `popup.js`, no seam,
no classic script, and no file still named after the old popup: the stylesheet is `src/styles/panel.css`
as of 1.12.0. Its last trace in the bundle is gone too: the two CDN `<link>`s and the dead half of
the stylesheet.

| Layer | Size | Notes |
|---|---|---|
| `src/sidepanel.html` | 20 lines | The Vite HTML entry: `#root` + the module script. Vite owns the page and its hashed assets |
| `src/` (React) | 9,428 lines, 111 files | 25 test files / 196 unit tests, plus 4 worker files / 34 tests under `background/__tests__/`; the whole panel — shell, collections, dialogs, settings — plus the store and its boot sequence |
| `e2e/` | 4 files, 7 specs | Playwright walk of the packaged extension in Playwright's Chromium; `npm run e2e` builds `dist/` first (1.13.0) |
| `src/styles/panel.css` | 2,803 lines | The migrated pre-React stylesheet, renamed from `popup.css` in 1.12.0; bundled by Vite via the HTML entry, with the rules no surviving mark-up reaches swept in 1.11.0. `src/styles/shell.css` layers the React-owned rules on top |
| Vendor assets | 2 deps | `@fortawesome/fontawesome-free@6.4.0` + `@fontsource/inter`; self-hosted, woff2-only in `dist/` (1.11.0) |
| `dist/` | 1.12 MB | Was 2.5 MB before the build started dropping non-woff2 font fallbacks (1.11.0); the bundled worker is smaller than the copied one (1.15.0) |
| CI | `.github/workflows/ci.yml` | Lint, format check, tests, build and the bundle-size budget on every push and pull request; the E2E walk stays local (1.14.0) |
| `background/` | 15 files | The service worker, split into ES modules in 1.15.0 with the pure decisions under `background/lib/`; `scripts/build.mjs` bundles the entry to the single `dist/background.js` the manifest names |
| Folder hierarchy | `src/lib/folders.js`, `src/features/collections/` + `src/store/migrations/` | One level deep: a frozen `folders` array plus a per-collection `folderId`, rendered by `FolderSection`, moved by drag or the card menu, and upgraded through a versioned migration at `schemaVersion` 1 (1.17.0) |

What the old shell owned, and where each piece went:

| Responsibility | Where it lives now | Slice |
|---|---|---|
| Toasts | ✅ `src/app/providers` (1.6.0) | done |
| Collection/tab CRUD, pin toggles, open/restore, per-collection export | ✅ `useCollectionActions` + `lib/collectionAdmin.js`; `legacy-ui.js` deleted (1.8.0) | done |
| Header, controls bar, slides, sort menu, layout toggle, global import/export, restore backup | ✅ `src/features/shell` (1.9.0) | done |
| Global search results | ✅ `GlobalSearchResults` + `useGlobalSearch` (1.9.0) | done |
| Global keyboard shortcuts | ✅ `useGlobalShortcuts` (1.9.0) | done |
| Shell markup + composition | ✅ `src/sidepanel.html` is the Vite entry; Vite emits the page (1.10.0) | done |
| Boot sequence (theme, worker auto-save, opened-state normalisation) | ✅ `useThemeAttribute` + `useBootSequence` + `store/openedState.js` (1.10.0) | done |
| State bridge for the classic script (`window.__tcmStore`) | ✅ deleted with its only caller (1.10.0) | done |
| Self-hosted Font Awesome + Inter (two CDN `<link>`s) | ✅ runtime deps, bundled by Vite; `dist/` ships woff2 only (1.11.0) | done |
| Dead rules in the panel stylesheet | ✅ swept: 102 lines no React mark-up reaches (1.11.0) | done |
| The last `popup*` filename | ✅ `popup.css` → `src/styles/panel.css`, linked from the Vite entry (1.12.0) | done |
| Accessible names, slide focus return, Escape routing | ✅ `aria-label`s, `aria-hidden` icons, `useRestoreFocus` (1.11.0) | done |

### Pain points this migration fixes

1. Full-tree re-render via `innerHTML` / template cloning causes flicker, loses input focus,
   and re-creates listeners.
2. State logic and DOM logic are interleaved across 3.6k lines — no single place to reason
   about state.
3. No modules or types: everything is global-scope, so refactors are dangerous.
4. The manual `getElementById` element cache can desync from HTML edits.

### Hard constraints

- **MV3 CSP:** `script-src 'self'` — no inline scripts or eval. React bundling is fine; the CDN
  `<link>`s for fonts/Font Awesome should become self-hosted.
- **Single UI entry:** `side_panel.default_path = sidepanel.html`; the action button opens the
  side panel (no `default_popup`).
- **Storage keys are the data contract — do not rename:** `collections`,
  `autoSaveCollectionId`, `lastSessionBackup`, `ramSaverEnabled`, `collectionSortType`,
  `enforceMaxPinnedTabs`, `maxPinnedTabs`, `enforceMaxPinnedCollections`,
  `maxPinnedCollections`, `layoutViewMode`, `theme`, `sessionHistory`, `gdriveBackupEnabled`,
  `gdriveAutoBackupEnabled`, `lastGDriveBackup*`, plus per-collection `chromeGroups` and
  per-tab `chromeGroupId`.
- **Message commands are the background contract:** `forceAutoSave`, `restoreSession`,
  `getSessionData`, `gdriveBackup`, `gdriveRestore`, `gdriveDeleteBackup`, `gdriveSignOut`,
  `gdriveEnableAutoBackup`, `gdriveGetStatus`.

---

## 3. Target architecture

```text
Extension (MV3)
|- background.js        <- unchanged vanilla service worker (own contract, own tests later)
|- src/
|  |- sidepanel.html    <- Vite entry (replaces popup.html as the build source)
|  |- main.tsx          <- React root
|  |- app/              <- App shell + layout
|  |- components/       <- shared presentational primitives
|  |- features/         <- collections, tabs, search, settings, history, gdrive
|  |- store/            <- storage-backed store + hooks
|  |- lib/              <- chrome wrappers, validation, sorting, dnd, formatting
|  |- shared/           <- types + storage/message contracts shared with the worker
|  `- styles/           <- migrated popup.css (+ per-component CSS as needed)
`- manifest.json        <- copied/rewritten into dist/ by the build
```

### Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bundler | Vite 6 + `@crxjs/vite-plugin`; fallback: Vite multi-entry + `vite-plugin-static-copy` | CRXJS rewrites manifest paths and gives HMR against a loaded extension; the fallback keeps us unblocked |
| Language | TypeScript (strict) | Storage schema and message protocol are the riskiest surfaces |
| State | `chrome.storage.local` as the single source of truth, wrapped in a store + `useSyncExternalStore` | Preserves the existing "storage is truth" invariant and keeps the worker in sync for free |
| Async writes | Serialized write queue (promise chain) | Mirrors the existing `updateState` queue in `background.js`; prevents lost updates |
| Styling | Keep `popup.css` global through Phases 1-4, class names unchanged | Zero-risk visual parity; CSS Modules later if desired |
| Icons/fonts | Self-host Font Awesome + Inter | Removes CDN dependency and store-review friction |
| Service worker | Untouched until Phase 6 | Autosave integrity is the highest-risk code in the repo |
| Tests | Vitest + React Testing Library + chrome mock; Playwright for E2E | Nothing exists today; net-new safety |

---

## 4. Tooling setup

### package.json (proposed)

```json
{
  "name": "tab-collection-manager",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "watch": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@fortawesome/fontawesome-free": "^6",
    "@fontsource/inter": "^5"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2",
    "@types/chrome": "^0.0.300",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5",
    "typescript": "^5",
    "vite": "^6",
    "vitest": "^3",
    "@testing-library/react": "^16",
    "@testing-library/user-event": "^14",
    "jsdom": "^26",
    "@playwright/test": "^1"
  }
}
```

### vite.config.ts (CRXJS path)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: { outDir: 'dist', sourcemap: true, target: 'chrome120' },
  server: { port: 5173, strictPort: true }
});
```

**Fallback** if CRXJS fights the manifest: plain `vite build` with
`rollupOptions.input = { sidepanel: 'src/sidepanel.html' }` plus a small plugin that copies
`manifest.json`, `icons/`, and `background.js` into `dist/` and rewrites `default_path` /
`service_worker` to the built filenames.

Add `dist/` to `.gitignore`.

**Verification loop:** `npm run build` writes `dist/`; load `dist/` unpacked in
`chrome://extensions` and open the side panel. Always verify in a *loaded extension*, not just
`vite dev`.

---

## 5. Component mapping (current -> React)

| Current source | React target |
|---|---|
| `.container`, header, creator badge | `App`, `AppHeader` |
| `#actionsBarDefault` (search, create, import, export, layout, restore, sort) | `ControlsBar`, `SortMenu` |
| `#historyBtn` | `HistoryButton` |
| `#searchSlideContainer`, `#createSlideContainer` | `SlideInput` (reused twice) |
| `#collectionsContainer` + `collectionTemplate` | `CollectionList` -> `CollectionCard` |
| `#tabTemplate` rows | `TabList` -> `TabRow` |
| `#emptyState` | `EmptyState` |
| `#searchResultsContainer` + `filterResults()` | `SearchResults` + `useSearch` |
| `#toastContainer` + `showToast()` | `ToastProvider` + `useToast()` |
| `#addTabsModal` (`manualForm`, `multiForm`, `#openTabTemplate`) | `AddTabsModal`, `ManualTabForm`, `OpenTabsPicker` |
| `#settingsModal` (autosave, RAM saver, theme, GDrive, pinned limits) | `SettingsModal`, `SettingsRow`, `Toggle`, `GDriveSection` |
| `#historyModal`, `#sessionDetailsModal` | `HistoryModal`, `SessionDetailsModal` |
| `#viewCollectionModal`, `#detailsTabList` | `CollectionDetailsModal` |
| `#duplicateUrlDialog` | `DuplicateUrlDialog` (portaled) |
| `#shortcutsHelpModal` | `ShortcutsHelpModal` |
| Sort icons/menus | `SortIconButton`, `TabSortMenu` |
| Drag & drop helpers | `useDragAndDrop` + `DragHandle` |
| Keyboard shortcuts | `useKeyboardShortcuts` |
| `renderTab`, `renderCollection`, `renderCollections` | Pure selectors + components (no `innerHTML`) |

---

## 6. State layer design

```ts
// store/schema.ts — the storage contract (keys unchanged)
export interface TabItem {
  id: string; title: string; url: string; pinned: boolean; index: number;
  windowId: number; active: boolean; discarded: boolean; highlighted: boolean;
  addedAt: number; chromeGroupId?: number | null;
}

export interface Collection {
  id: string; name: string; tabs: TabItem[]; createdAt: number; updatedAt: number;
  isExpanded: boolean; isPinned?: boolean; tabSortType?: string;
  windowGroups?: Record<string, TabItem[]>;
  chromeGroups?: Record<string, { title: string; color: string; collapsed: boolean }>;
}

export interface AppSettings {
  autoSaveCollectionId: string | null; ramSaverEnabled: boolean;
  collectionSortType: string; layoutViewMode: 'list' | 'grid'; theme: 'dark' | 'light';
  enforceMaxPinnedTabs: boolean; maxPinnedTabs: number;
  enforceMaxPinnedCollections: boolean; maxPinnedCollections: number;
}
```

```ts
// store/store.ts (sketch)
let state: AppState = initial;
const listeners = new Set<() => void>();
let writeChain = Promise.resolve();

export function subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
export function getSnapshot() { return state; }

export function mutate(fn: (draft: AppState) => void) {
  writeChain = writeChain.then(async () => {          // serialize like background's updateState
    const next = structuredClone(state);
    await fn(next);
    await chrome.storage.local.set({ collections: next.collections, ...next.settings });
    // state refresh arrives via storage.onChanged -> single render pass
  });
  return writeChain;
}

chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'local') return;
  state = hydrate(changes, state);   // or one debounced re-read
  listeners.forEach(l => l());
});
```

**Hooks:** `useAppState()`, `useCollections()`, `useSettings()`, `useCollection(id)`,
`useGDriveStatus()`, `useToast()`, `useSearch(query)`, `useDragAndDrop()`,
`useKeyboardShortcuts()`, `useAutoSaveStatus()`.

**Invariants to preserve**

- `collections` stays an array with `CURRENT_SESSION_ID` first; `Current Session` stays live and
  is excluded from duplicate detection.
- Pinned-first partitioning (`partitionTabs`) stays a pure selector applied on write, matching
  background behaviour.
- Storage shape and `background.js` may only change in a dedicated commit with its own tests.

---

## 7. Feature-by-feature mapping

| Feature | Where it lives after migration |
|---|---|
| Collections CRUD, rename, expand/collapse | `features/collections` + store mutate helpers |
| Drag & drop reorder (collections + tabs) | `useDragAndDrop`; keep native HTML5 DnD first, consider `dnd-kit` only if parity issues appear |
| Sorting (8 collection modes, 5 tab modes) | Pure `lib/sort.ts` selectors (unit-testable) |
| Search + highlight | `useSearch` + `<Highlight>` component |
| Pin collections/tabs + max-pin limits | `lib/pinning.ts` (same semantics as background) |
| Duplicate URL detection + confirm dialog | `features/duplicates` + portaled dialog |
| Import/export JSON (global + per collection) | `lib/backup.ts` (pure), invoked from `ControlsBar` / `CollectionCard` |
| Session history + details | `features/history` (reads `sessionHistory`) |
| Auto-save toggle, RAM saver, theme, layout | `features/settings` |
| GDrive backup/restore UI | `features/gdrive` (talks to background `gdrive*` messages) |
| Context menu, autosave, alarms, restore | Unchanged in `background.js` |
| Keyboard shortcuts | `useKeyboardShortcuts` (exact bindings kept) |
| Toasts | `ToastProvider` |

---

## 8. Phased execution plan

**Phase 0 — Prep (0.5 day) — complete**
Init `package.json`, Vite, TS config, `dist/` in `.gitignore`, and a smoke test that the current
extension still loads from `dist/` after a trivial copy build.
*Acceptance:* `dist/` loads unpacked; side panel opens; autosave still works.

**Phase 1 — Scaffold + mount React shell (1-1.5 days) — complete**
Create `src/sidepanel.html`, `main.tsx`, `App`, and the store. Keep the existing `popup.js`
loaded in the same page temporarily so nothing regresses while React renders only header and
controls.
*Acceptance:* React renders header + controls; existing behaviour untouched; no console errors.

**Phase 2 — Read-only rendering (1.5-2 days) — complete**
Migrate `renderCollections` / `renderCollection` / `renderTab` to
`CollectionList` / `CollectionCard` / `TabRow` driven by the store. Wire
`storage.onChanged` -> single React re-render. Delete template-cloning render paths.
*Acceptance:* identical visuals; expand/collapse persists; no focus loss on re-render.

**Phase 3 — Interactions (3-4 days) — partially complete**
Shipped: drag & drop reorder (ADR-0003) plus the collection list's expand/collapse, per-collection
tab sort and the cross-collection move rules, all through the store's queue.
**Never shipped:** CRUD (create/rename/delete/duplicate check), pin toggles, sort menus, search
slide + results, layout toggle, import/export and open/restore. They stayed in `popup.js` because
Phase 2's "functional at every commit" decision kept the legacy handlers alive until a React shell
could host them, and the shape of the shell (header, controls bar) was Phase 5 work. The
changelog entries for 1.2.0 and later overstated this as done — see §2.1 and §8.
*Acceptance (superseded):* folded into Phase 5.1 and 5.2.

**Phase 4 — Modals & settings (3-4 days) — complete**
Add-tabs modal, settings modal, GDrive section, history + session details, collection details,
duplicates dialog, shortcuts help. Introduce one `Modal` primitive + portal root.
*Acceptance:* all 7 modals work; settings persist; GDrive round-trips against the unchanged
background.

**Phase 5 — Finish the UI, retire the shell (5-7.5 days)**
The original 1.5-2 day figure assumed Phase 3 had already moved the remaining interactions. It had
not (§2.1), so Phase 5 absorbs them. Estimates are against the measured 1,613-line `popup.js`.

**5.1 Legacy actions → React (1.5-2 days) — complete.** Moved the nine `TCMLegacyUI` methods into React:
collection CRUD (create/rename/delete + case-insensitive uniqueness), tab edit and remove, pin
toggles with the max-pin limits, open-a-tab, open-all/restore, and per-collection export. Each is a
store mutation or a single `chrome.runtime.sendMessage`, and `useCollectionActions` already exposes
the override seam used for add-tabs/import/toast.
*Accepted:* `TCMLegacyUI` is gone from `popup.js`, `src/app/legacy-ui.js` is deleted, and the pin
limits and duplicate-name rules are covered by `collectionAdmin.test.js` + `useCollectionActions.test.js`.

**5.2 Shell chrome → React (2-3 days) — complete.** `AppHeader` (settings/close, name/version),
`ControlsBar` (search + create slides, sort menu, layout toggle, global import/export, restore
backup), `GlobalSearchResults` + `useGlobalSearch` replacing the `filterResults()` `innerHTML`
renderer, and `useGlobalShortcuts` for the global key handler — all in `src/features/shell`, driven
by `useShellController`.
*Accepted:* React owns the whole panel and renders into a single `#appRoot`; `window.__tcmReact`
and `src/app/legacy-handle.js` are deleted; `popup.js` is a 99-line boot script.

**5.3 Retire the shell (0.5-1 day) — complete.** `src/sidepanel.html` is the Vite HTML entry, so
Vite owns the page and emits `dist/sidepanel.html` with hashed assets; `popup.html`, `popup.js` and
`src/app/legacy-store.js` are deleted, the boot sequence moved into `useBootSequence` (worker
auto-save, fresh read, opened-state normalisation through `store/openedState.js`) and the theme
stays with `useThemeAttribute`, and the ESLint/Prettier exclusions for the deleted files are gone.
*Accepted:* no `popup.*` script or markup exists; `scripts/build.mjs` asserts the page has the React
root, the bundled module script and the bundled stylesheet and that the legacy ids and classic
script are absent; `tests/legacy-shell-removed.test.js` guards the deletion, the seams and the
single-writer rule against the sources.

*Deviation from the plan as written:* the emitted page lands in `dist/src/sidepanel.html` because
Vite mirrors an HTML entry's path relative to its root, and moving Vite's root into `src/` would
break `tests/**` discovery. `build.mjs` relocates the page to `dist/sidepanel.html`; the emitted
asset URLs are origin-absolute (`/assets/...`), so the move is safe and the packaged layout,
`manifest.json`'s `default_path`, and the page-relative `icons/...` references are unchanged.

**5.4 Polish (1-1.5 days).** ✅ *Done (1.11.0).* Font Awesome and Inter are runtime deps bundled
by Vite (the two CDN `<link>`s are deleted); the build drops non-woff2 font fallbacks and asserts
nothing still referenced went missing, so `dist/` ships one `.woff2` per face and loads nothing
remotely; the panel stylesheet lost the 102 lines no surviving mark-up reaches; and the shell gained
accessible names on every icon-only control plus focus return from the slides, with Escape routing
re-confirmed. Toasts landed back in 1.6.0.
*Acceptance:* met — no remote asset loads (`dist/` was verified to contain only a licence comment and
the worker's Drive endpoints), `npm test` is green at 196, and no colour, size, spacing or weight
rule changed, so the visual diff is intentionally empty.

**Phase 6 — Background modernization (2-3 days) — complete**
`background.js` moves to modules under `background/` (JavaScript + JSDoc, per skill.md 2.0.0,
not TypeScript as written here originally). The pure decisions live in `background/lib/` — URL
filtering, snapshotting, grouping, the identity-preserving merge, the partial-restore guard and
duplicate detection — and `scripts/build.mjs` bundles the entry to `dist/background.js`, so the
manifest and packaged layout are unchanged. No storage key, storage shape or message command moved.
*Accepted:* autosave behaviour and the message protocol unchanged, and the seven E2E specs still
pass against the bundled worker; 34 new unit tests cover the guards and the tab-group rebuild.

**Phase 7 — Store readiness (1 day) — complete**
Permission audit: the dormant local-daily-backup module is deleted and `downloads` with it (`tabs`,
`tabGroups`, `storage`, `contextMenus`, `favicon`, `sidePanel`, `alarms` and `identity` all keep a
live caller). `default_popup` stays absent — the toolbar icon opens the panel. Versions reconciled
to 2.0.0 across `manifest.json`, `package.json`, the lockfile, `feature_list.md` and the chrome
mock, the release tagged `v2.0.0`, and the version story then single-sourced at 2.0.1 (1.16.0).
(The CDN links were already removed in 5.4.)

**Phase 8 — Folder hierarchy (2-3 days) — complete**
The first post-migration feature, and the reason §7.1 of `skill.md` exists: collections can live in
one-level folders. The storage contract gains a frozen `folders` array plus a per-collection
`folderId`, applied through the new versioned migration runner (`src/store/migrations/`) so an
existing profile upgrades in place at `schemaVersion` 1; a dangling `folderId` is dropped in
`normalizeState`, so a half-applied edit cannot orphan a collection. Rendering splits at
`CollectionList` — root collections stay direct children of `#collectionsContainer` (the keyboard
jump and the E2E helpers rely on it) and each folder renders as a `FolderSection` whose
collections nest inside; `groupCollections` in `src/lib/folders.js` is the pure split. Membership
moves by dragging a collection onto a folder, by the collection card's "Move to folder" menu, or
back to the root through a drop zone that only appears while a nested collection is dragged;
`moveCollectionToFolder` refuses Current Session, and `deleteFolder` asks once and then removes the
folder's collections with it (1.17.3 — a folder is a container the user asked to remove). Folders
travel in global export/import and the Drive backup.
*Accepted:* the full gate is green (279 tests in 35 files, 7 E2E specs, bundle size within budget),
and a pre-folders profile migrates on load. Decision recorded in ADR-0011.

**Total: ~19-25 developer-days** (~4-5 weeks part-time), once Phase 5's real scope is counted —
the original 14-19 assumed Phase 3 had finished the interactions. Phases 0-8 are all complete as of
plan 1.17.0.

---

## 9. Testing strategy

- **Unit (Vitest):** `lib/sort.js`, `lib/pinning.js`, `lib/backup.js`, duplicate normalization,
  group capture/restore mapping, store reducers.
- **Worker (Vitest) — done (1.15.0).** `background/__tests__/` drives the service worker's modules
  against the central chrome mock: `lib/tabs.js` (URL filtering, snapshot defaults, window
  grouping, capping, the max-pin merge, the partial-restore guard), `lib/duplicates.js`, `autosave.js`
  (identity preservation, the backup and history writes, the guard inside and after the startup
  window) and `restore.js` (tab-group rebuild, the RAM-Saver discard race, restore orchestration).
- **Component (RTL + jsdom):** `CollectionCard`, `TabRow`, `SettingsModal`, `OpenTabsPicker`
  with a chrome API mock.
- **E2E (Playwright, `e2e/`, `npm run e2e`) — done (1.13.0).** `dist/` loaded unpacked into
  Playwright's bundled Chromium (branded Chrome and Edge dropped `--load-extension` in 2025), with
  one fresh extension profile per test so storage starts empty. Seven specs cover the unpacked load
  and then the walk that used to be manual: create a collection and keep it across a reload (checked
  against `chrome.storage.local`, not against the rendered list), add a tab manually and confirm a
  duplicate, edit/rename/pin/remove through the card menus, import the window's open tabs through
  the multi-select picker, search collections and tabs with focus returning to its trigger, toggle
  layout and sort, export a JSON download, expand all with Ctrl+E, open the shortcut help with `?`,
  and open the history and settings dialogs.
- **Manual matrix (loaded unpacked):** now only what a test cannot judge. The unpacked load and the
  golden paths are automated (`npm run e2e`), so the manual pass is what is left: a profile with
  existing data, RAM Saver on restore, a GDrive round-trip against a real account, and anything
  touching the autosave/restore storage shape — with a storage snapshot before and after. Tab-group
  restore is still only manual (it needs a reorder or restore that a spec cannot fake).

```ts
// tests/mocks/chrome.ts (reference implementation)
export function installChromeMock(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  let onChange: any;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map(k => [k, store[k]])),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
          onChange?.(Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, { newValue: v }])), 'local');
        }
      },
      onChanged: { addListener: (fn: any) => { onChange = fn; } }
    },
    tabs: { query: async () => [], create: async () => ({ id: 1 }), group: async () => 1 },
    tabGroups: {
      get: async () => ({ title: 'x', color: 'blue', collapsed: false }),
      update: async () => {}, TAB_ID_NONE: -1
    },
    runtime: { sendMessage: async () => ({ success: true }),
               getManifest: () => ({ name: manifest.name, version: manifest.version }) },
    identity: { getAuthToken: (_o: any, cb: any) => cb('token') }
  } as any;
}
```

---

## 10. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Autosave / data loss during refactor | Critical | Never touch `background.js` or storage keys in Phases 1-5; parallel-run old vs new on a copied profile; keep `lastSessionBackup` intact |
| MV3 CSP / bundler conflicts | High | CRXJS-with-fallback plan; assert no inline scripts; verify in a loaded extension |
| Drag & drop regressions | Medium | Native HTML5 DnD first; golden-path E2E for both reorder levels |
| Storage write races (UI vs autosave) | Medium | Serialized write queue + re-read on `onChanged`; debounce hydration |
| Side panel vs popup entry confusion | Medium | Keep `side_panel.default_path` as the only entry until Phase 7 |
| Bundle bloat (React + Font Awesome) | Low | Tree-shake FA, self-host only used icons, bundle visualizer check |
| Scope creep into new features | Medium | Freeze features until Phase 5 signs off |
| CDN fonts/icons flagged in review | Low | Self-host in Phase 5 |

---

## 11. Rollback strategy

Each phase lands as its own commit pair. (Until Phase 3 the old build was still runnable as
`dist-legacy/` from the Phase 0 copy task; that task is gone, because the panel reads state through
the bundled store and a copy build could not run.) If a phase fails review, revert that
commit only —
`background.js` and the storage contract never move in the same commit as UI work. Tag
`pre-react-migration` on `main` before Phase 1.

---

## 12. Definition of done

- `popup.js` and the `<template>` renderer are gone; all UI is React with no `innerHTML`
  string building.
- `npm run build` produces a loadable `dist/`; `npm test` and `npm run e2e` pass.
- Feature parity confirmed against the test matrix (RAM Saver, GDrive, session history, tab
  groups, drag & drop, search, sorting, duplicates).
- Storage schema and background message protocol unchanged; existing user data upgrades with
  zero migration steps.
- No remote CDN dependencies; README documents the new build workflow.

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| 1.17.4 | 2026-10-02 | Extension version bumped to 2.2.0 — a MINOR, because everything after the 2.1.1 tag is user-visible: the two-section layout with foldable headings and live counts, and bulk delete (1.17.3), which is the first feature to reverse a documented decision (ADR-0011 → ADR-0012). `manifest.json` moves from 2.1.1 to 2.2.0 and `package.json`, both lockfile version fields, `feature_list.md`'s title and `missing_features.md`'s header follow it. The other axes stay where they were: the storage `schemaVersion` is still 1 and the message protocol is unchanged, because every change in this release was UI state or a CSS/rendering fix. `tests/version-alignment.test.js` passes, which is the point of the separate axes (skill.md §7). |
| 1.17.3 | 2026-10-02 | Bulk delete, and a folder that takes its collections with it. A **Select** toggle in the controls bar (`#toggleSelectBtn`) puts a checkbox on every folder and collection; `App` owns the one shared selection (two id sets, since a folder and a collection can share an id space only accidentally) and `CollectionList` passes it down, so a selection spans both sections. `Delete selected` calls the new `deleteMany` action, which funnels into `src/features/collections/lib/bulkDelete.js` — `summarizeSelection` counts what would go (a selected folder's collections included), `describeSelection` names it in the single `window.confirm`, and `deleteSelection` performs it, never touching the live Current Session (its checkbox is disabled). `deleteFolder` changes from "keep the collections, re-root them" to cascade, so removing a folder removes its contents — the confirm says so before anything is lost — and the folder menu, the tests and every doc that described the old rule were updated with it. A collection inside a folder gets its own checkbox too, so it can be removed without taking the folder (a regression test pins that: disabling the nested cards' selection mode fails it). The storage contract is untouched: `schemaVersion` stays 1 and no message changed, because the selection is UI state. Suite 282 → 297 in 36 files (`bulkDelete`, `deleteMany`, the folder cascade, the list's selection mode) and 11 Playwright specs pass, including a bulk-delete walk that selects a folder, a nested collection in a different folder and a root collection at once, accepts the real confirm, and asserts storage kept only the unselected folder. Decision recorded in ADR-0012. |
| 1.17.2 | 2026-10-02 | Extension version bumped to 2.1.1. The collection list became two stacked sections — Folders first (each folder with its collections nested inside), then Collections with the root-level ones — and each section heading carries a live count and folds its section away (`SectionToggle`). `manifest.json`, `package.json`, both lockfile fields, `feature_list.md`'s title and `missing_features.md`'s header move together. The other axes stay put: the storage `schemaVersion` is still 1 — the fold state is local UI state, not a stored key — and the message protocol is unchanged. Suite 280 → 282 with the count and fold coverage; 10 Playwright specs pass. |
| 1.17.1 | 2026-10-02 | Extension version bumped to 2.1.0 — a MINOR, because Phase 8's folder hierarchy (1.17.0) is the first user-visible feature since the 2.0.0/2.0.1 line, so `manifest.json` moves from 2.0.1 to 2.1.0 and `package.json`, both lockfile version fields and `feature_list.md`'s title follow it (the storage `schemaVersion` stays 1 and the message protocol is unchanged). `tests/version-alignment.test.js` still passes, which is the point: the extension axis moves as one while the storage, protocol and document axes stay independent (skill.md §7). |
| 1.17.0 | 2026-10-02 | Phase 8, the first post-migration feature: folders. Collections can be organized into one-level folders, and the storage contract stays migration-safe while gaining two keys. `src/store/migrations/0001-folders.js` plus the ordered runner in `src/store/migrations/index.js` add `folders: []`, pin every collection's `folderId` to a string or `null`, and stamp `schemaVersion` — `store/store.js` runs the migrations inside `hydrate()`, writes the result back once, and `toPersistedKeys` now emits `folders` and `schemaVersion`, both added to the frozen `STORAGE_KEYS`; `normalizeState` normalizes the folders and drops any `folderId` whose folder is gone, so a bad edit cannot orphan a collection. Rendering splits at `CollectionList` into the root collections (still direct children of `#collectionsContainer`, which the keyboard jump and the E2E helpers depend on) and `FolderSection` per folder with its collections nested in `.folder-body`, driven by the pure `groupCollections`/`collectionsInFolder` in `src/lib/folders.js`; `useGroupedCollections` joins them to the store. Membership is managed by `src/features/collections/lib/folderDraft.js` (`createFolder`, `renameFolder`, `deleteFolder` — which keeps its collections and re-roots them — `setFolderExpanded` and `moveCollectionToFolder`, refusing Current Session) behind `useCollectionActions`, with drag-onto-folder and a root drop zone that appears only while a nested collection is dragged; the collection card's menu gains a "Move to folder" section and the controls bar a `#createFolderBtn`. Folders ride through global export/import (`globalBackup.js` gained `folders`, `extractImportedFolders` and folder remapping, with a legacy file still importing as all-root) and the Drive backup (`background/gdrive.js` + `background/state.js`). Test suite 266 → 279 in 35 files (migration, grouping, `folderDraft`, `FolderSection`, `CollectionList`, and the backup round trip), 7 E2E specs still pass and the size budget stays green. Decision recorded in ADR-0011; `skill.md` §2.3 gained the `folders` row at document 2.3.0. |
| 1.16.0 | 2026-10-02 | The extension version is reconciled as a single source of truth. `manifest.json` moves to 2.0.1 — a patch, because nothing user-visible or breaking has landed since the 2.0.0 tag — and `package.json`, the lockfile and `feature_list.md`'s title follow it. `tests/mocks/chrome.js` no longer hard-codes the name and version: it imports `manifest.json` for `runtime.getManifest()`, and a new `tests/version-alignment.test.js` asserts every copy against the manifest, so the three-way drift (manifest 1.9.0 / feature list v2.2.0 / mock 2.0.0) cannot recur. Only the extension axis is checked: the storage schema, the message protocol and each document's own version stay independent by design (skill.md §7). |
| 1.15.0 | 2026-10-02 | Phases 6 and 7 finished, releasing 2.0.0. `background.js` — the last vanilla file, 1,294 lines, still excluded from ESLint and Prettier — is now ES modules under `background/`: `index.js` wires the listeners while `state.js`, `autosave.js`, `restore.js`, `contextMenu.js`, `gdrive.js`, `messages.js` (the router), `panel.js`, `chromeGroups.js`, `bootstrap.js` and `runtime.js` own one capability each, and `background/lib/tabs.js` + `background/lib/duplicates.js` hold the pure decisions (URL filtering, snapshotting, window grouping, capping, the identity-preserving merge, the partial-restore guard, duplicate detection). The worker imports the frozen contract from `src/shared/` and the pure group normaliser from `src/lib/tabGroups.js` instead of re-typing keys, and `background/api.js` resolves the `chrome`/`browser` global through a proxy so a late polyfill and the test setup's per-case mock both work. `scripts/build.mjs` gains `bundleWorker()`, a second Vite build emitting a single ES `dist/background.js`, so `manifest.json`, the packaged layout and the E2E assertion on the worker URL are unchanged; copying the directory was rejected because the shared imports would not survive `dist/src/` being removed. No storage key, storage shape or message command changed. 34 new unit tests in `background/__tests__/` cover the autosave guards and the tab-group rebuild (suite 230 in 29 files) and the seven Playwright specs still pass, so the bundled module worker runs under MV3. Phase 7's audit deleted the dormant local-daily-backup module and the `downloads` permission with it — the panel's export/import never used it — and reconciled the drifting version story (manifest/package/lock 1.9.0, `feature_list.md` v2.2.0, the chrome mock 2.0.0) to 2.0.0. ESLint and Prettier now exclude only `src/styles/panel.css`; `dist/` is 1.12 MB. Decision recorded in ADR-0010. |
| 1.14.0 | 2026-10-02 | Continuous integration, with a size budget. `.github/workflows/ci.yml` runs on every push, pull request and manual dispatch on Node 22 with the npm cache: ESLint, `prettier --check`, `npm test`, `npm run build` and the new `npm run check:size`, in that order so the fast gates fail first and a superseded run is cancelled instead of queueing. The end-to-end suite is deliberately left out — it needs `npx playwright install chromium` and its own X server, so it stays a local command until CI minutes are worth spending on it; `README.md` says so explicitly. `scripts/size-budget.mjs` is the budget: it measures the bundles Vite emits into `dist/assets/` gzipped (JS 100 kB, CSS 36 kB) plus the whole packaged `dist/` raw (1.25 MB), prints all three against their ceilings with the headroom, and exits non-zero with the overage when one is breached. Measuring the bundles from `dist/assets/` rather than all of `dist/` matters: the copied `background.js` would otherwise be counted as panel JS. The check is a separate script rather than a step inside `scripts/build.mjs` because `npm run dev` rebuilds on every source change, where a budget failure would be noise while iterating; skill.md §6 gained the budget as a CI gate and `README.md` documents the numbers and how to raise one. Vite reports the same files in decimal kB and the budget prints binary multiples, a ~2.5% difference that is noted in the script so nobody re-tunes a budget over it. |
| 1.13.0 | 2026-10-02 | The unpacked load is automated: a Playwright end-to-end suite drives the built `dist/` in the Chromium Playwright bundles, so the manual smoke pass is no longer the only way to prove the packaged extension works. New `playwright.config.js`, `e2e/fixtures.js` (a persistent context with `--load-extension=dist`, the extension id read from the service worker, and the panel page asserted hydrated before any test body runs), `e2e/support/tabServer.js` (a loopback static server so the multi-select picker sees real http tabs) and `e2e/panel.spec.js` with seven specs: the unpacked load and mount; create a collection and keep it across a reload; manual tab add plus the duplicate confirmation, tab/collection rename, pin and remove; multi-select import of the window's open tabs; global search with focus returning to its trigger; layout and sort toggles, a JSON export download, Ctrl+E, `?` and `x`; and the history and settings dialogs with focus restored on Escape. Vitest keeps owning `src/**` and `tests/**`, so the specs live in `e2e/` and neither runner has to exclude the other's files; `npm run e2e` builds `dist/` first and is deliberately not part of `npm test`, which stays jsdom-only and dependency-free. `test-results/` and `playwright-report/` are ignored, and `e2e/**` gets an ESLint override because a Playwright fixture callback is literally named `use` — the React hooks rule reads that as a hook call. Playwright's bundled Chromium is required rather than the machine's Chrome: branded Chrome and Edge dropped `--load-extension` and `--disable-extensions-except` in 2025, so `channel: 'chromium'` (which also allows extensions headless) is the supported path. |
| 1.12.0 | 2026-10-02 | `popup.css` renamed to `src/styles/panel.css`. Phase 5.3 deleted `popup.html` and `popup.js`, but the last file still named after the old popup was the stylesheet itself — 2,800 lines of pre-React panel styling that nothing referred to by name any more. It moves under `src/styles/` beside `shell.css`, which is exactly the `styles/` the §3 target tree called for, and the Vite entry (`src/sidepanel.html`) links `./styles/panel.css` instead of `../popup.css`, so the rename rides the existing bundle: the emitted `assets/sidepanel-<hash>.css` is byte-identical before and after. `scripts/build.mjs` and its `assertPage()` checks needed no change because they read the emitted HTML and its hashed asset URL rather than the source path. `.prettierignore` points at the new path, and `scripts/dev.mjs` drops its now-redundant `popup.css` watch entry since the parent `src` is already watched. Code and doc comments naming the stylesheet are updated; the historical ADRs and this changelog's earlier rows stay as written, with an amendment added to ADR-0009. No storage, message-protocol, manifest or build-output change; `background.js` untouched. |
| 1.11.0 | 2026-10-01 | Phase 5.4 finished, closing Phase 5: the panel has no remote assets and no dead shell CSS. Font Awesome (`6.4.0`, the version the CDN served, so the 59 `fa-*` glyph names are unchanged) and Inter (static 400/500/600/700, the only weights `popup.css` and `shell.css` use) became runtime deps imported by `src/main.jsx`, and the two CDN `<link>`s are gone from `src/sidepanel.html`; `all.min.css` is imported rather than the per-style files because it is the only one that also declares the legacy `'Font Awesome 5 Free'` family two `popup.css` `::before` icons still use. `scripts/build.mjs` now deletes every non-woff2 font file after bundling (`dist/` 2.5 MB → 1.15 MB, byte-identical rendering) and proves the deletion safe with a new `assertReferencedAssetsExist()`: it parses `url(...)`/`src=`/`href=` out of the emitted HTML and CSS and fails on a dangling reference, allowing a trimmed legacy format only when a `.woff2` of the same logical font survived. The dead-CSS sweep removed 102 lines of `popup.css` (`.select`, `.btn-primary`, `.auto-save-section`, `.settings-action-btn`, the `.restore-tooltip*` trio and the `search-hidden`/`search-fade-in`/`search-highlight` filter rules — each checked against every `.js`/`.jsx`/`.html` class string, including those built by template literals; the shared `searchFadeIn` keyframe stays for its three remaining callers). Every icon-only control in the shell, the sort menu, the search results and the modal header gained an `aria-label` with a decorative `aria-hidden` icon, the search/create inputs gained labels, and a new `useRestoreFocus` hook returns focus to the button that opened a slide, matching the Modal primitive. Escape routing was re-confirmed (visible dialog > self-closing slide > dismissable menu). Tests are 196 in 25 files, including focus-into/focus-back and accessible-name coverage for the controls bar. Decision recorded in ADR-0009. No storage, message-protocol or manifest change; `background.js` untouched. |
| 1.10.0 | 2026-10-01 | Phase 5.3 finished: the legacy shell is deleted. `src/sidepanel.html` is now the Vite HTML entry, so Vite owns the page and emits `dist/sidepanel.html` with hashed script and stylesheet assets; the composition step is gone and so are `popup.html`, `popup.js` and the `window.__tcmStore` bridge (`src/app/legacy-store.js`), which lost its only caller. The boot sequence moved into React: `useThemeAttribute` owns the theme (at the same moment the deleted script applied it), `useBootSequence` sends the worker `forceAutoSave`, re-reads, and normalises the opened state through the new `store/openedState.js` (collapse all, backfill `addedAt`, drop a stale Auto-Save id) via the store's own queue. `scripts/build.mjs` no longer composes HTML — it bundles, relocates Vite's emitted page from `dist/src/` to the extension root, copies the worker/icons/manifest, strips source maps, and asserts the page has the React root plus bundled assets and none of the legacy ids or classic script. The ESLint and Prettier exclusions for the deleted files are removed (`background.js` and `popup.css` stay excluded: Phase 6 and Phase 5.4). The `popup.js` source-contract test is replaced by `tests/legacy-shell-removed.test.js`, which asserts the files are gone, that no source exposes `__tcmStore` / `__tcmReact` / `TCMLegacyUI`, that only `store/store.js` writes storage, and that nothing assigns `innerHTML`. `manifest.json`'s `side_panel.default_path` changes from `popup.html` to `sidepanel.html` — the only manifest change, and it accompanies the file it points at. No storage key or message-protocol change; `background.js` untouched. |
| 1.9.0 | 2026-10-01 | Phase 5.2 finished: the shell chrome moved into React. A new `src/features/shell` owns the header, the controls bar (search and create slides, collections sort menu, layout toggle, global import/export, restore-backup button, history button), the global search results and the global keyboard shortcuts. `useShellController` holds the slide/query/create state and every action (create collection, sort, layout, import, export, restore, expand all, Current Session only, jump, close panel); `useGlobalSearch` derives the matches and `GlobalSearchResults` renders them from data, replacing the `filterResults()` string builder and its three `innerHTML` writes; `useGlobalShortcuts` replaces the `keydown` section; and `useManifestInfo` fills the header from the manifest. Pure helpers landed alongside: `lib/globalSearch.js` (matching + highlight segments), `lib/globalBackup.js` (export payload + the legacy merge rules), `lib/readJsonFile.js`, `lib/isAnyModalOpen.js`, `lib/scrollIntoView.js` and `lib/download.js` (the export helper `useCollectionActions` had inline); `createCollection` joined `collectionAdmin.js`, and `useDismissable` moved to `app/hooks` now that two features need it. `App` renders the whole panel into a single `#appRoot`, so `useContainerClasses` and `legacy-handle.js` (`window.__tcmReact`) are deleted and the state-contract test asserts the seam cannot return. `popup.html` shrinks from 112 lines / 23 ids to 18 lines / 1 id, and `popup.js` from 1,298 lines to 99 — the boot sequence only (theme before first paint, worker `forceAutoSave` + fresh read, opened-state normalisation). No storage key, message protocol, manifest entry or `background.js` line changes. |
| 1.8.0 | 2026-10-01 | Phase 5.1 finished: every `TCMLegacyUI` action moved into React. The nine methods became `useCollectionActions` calls over the store's write queue — collection rename/delete, tab rename/remove, the pin toggles (with the max-pin limits), open-a-tab, open-all/restore and per-collection export — and their pure rules live in the new `src/features/collections/lib/collectionAdmin.js` (`normalizeName`, `isNameUnique`, `deleteCollection`, `renameCollection`, `removeTab`, `renameTab`, `toggleCollectionPin`, `toggleTabPin`), so the pin limits and the case-insensitive duplicate-name rule are unit-testable. Refusals that used to be blocking `alert()`s now surface as toasts; restore is a single `chrome.runtime.sendMessage` to the unchanged worker instead of the duplicated open logic. `src/app/legacy-ui.js` is deleted, `popup.js` drops ~315 lines (1,613 → 1,298) and its whole `window.TCMLegacyUI` assignment, and `window.__tcmReact` keeps only the shell bridges (`setCollectionExpanded`, `openSettings`, `openHistory`, `openShortcuts`, `toast`). Also folded out of the legacy file: a shared `lib/tabs.js` `discardWhenLoaded` helper (used by `openTab` and the dialogs), a `formatFileTimestamp` in `lib/format.js`, and `LIMITS.MAX_COLLECTION_NAME_LENGTH` in `shared/constants.js`; the `Collection` typedef's stray `isPinned` was corrected to the `pinned` that `lib/sort.js` reads. The state-contract test now asserts the seam is absent. No storage key, message protocol or manifest change; `background.js` untouched. |
| 1.7.0 | 2026-10-01 | Scope reconciled with reality (§2.1), and the header status line corrected from "Phases 0, 1 and 2 shipped" to Phases 0-4 complete / Phase 5 in progress. Phase 3 is recorded as partially complete — drag & drop, expand/collapse and per-collection tab sort shipped, while CRUD, pin toggles, sort menus, search slide + results, layout toggle, import/export and open/restore never left `popup.js`; the earlier changelog entries overstated them. Phase 5 is re-scoped into 5.1 legacy actions, 5.2 shell chrome, 5.3 shell retirement and 5.4 polish, with a measured inventory of what remains and the estimate corrected from 1.5-2 to 5-7.5 days (programme total 14-19 → 19-25). |
| 1.6.0 | 2026-10-01 | Phase 5 started with the toast layer: `src/app/providers` owns a plain queue (`toastStore.js`), a `ToastProvider` that renders it through the shared body-level portal root, and a `useToast` hook. The queue is external to React on purpose, so `publishLegacyHandle()` can wire `__tcmReact.toast` to it and `popup.js`'s `showToast()` becomes a one-line delegator — its 14 call sites are untouched and a toast fired from a `DOMContentLoaded` handler cannot race React's mount. Features no longer reach into `window.TCMLegacyUI` to talk to the user: `useSettingsActions` takes `{ toast }`, `useCollectionActions` gained a `toast` override, and the provider is composed in `main.jsx`. The legacy `#toastContainer` markup and the DOM-building `showToast()` body are deleted, `scripts/build.mjs` asserts the container is gone, `TCMLegacyUI.toast` is removed from the seam, and the two helpers the Phase 4 modal port orphaned (`formatTime`, `validateUrl`) are removed. |
| 1.5.0 | 2026-10-01 | Phase 4 finished: the five remaining legacy modals (add tabs, duplicates, history, session details, shortcuts help) and the grid-view collection modal are on the `Modal` primitive, so every dialog shares one focus/Escape implementation. `src/features/dialogs` owns the UI (`DialogHost` + `useDialogs`, `useTabIntake`, `useOpenTabs`, `useSessionHistory`, and pure `lib/` for duplicates, tab intake, open tabs and snapshot restore), tab intake funnels manual/multi-select/import through a single store mutation, and the duplicate prompt is a Promise the intake awaits. `popup.html` lost all five modal blocks and `#openTabTemplate`; `popup.js` lost the matching controllers, `MODAL_IDS` and `closeTopModal`, leaving only the `?`/history-button bridges through `window.__tcmReact`. `scripts/build.mjs` asserts the legacy modals are gone. See the update in `docs/decisions/ADR-0005-modal-primitive-and-settings.md`. |
| 1.4.0 | 2026-10-01 | Phase 4 started: `src/components/Modal.jsx` is the one modal primitive (shared portal root on `document.body`, focus in/out, Tab trap, topmost-only Escape, overlay click) and the settings modal is its first consumer — `src/features/settings` renders Session, Performance, Appearance, Keyboard Shortcuts, Cloud Backup and Limits from the store, writes everything through `mutate()`, and the legacy markup plus the ~300-line `setupSettingsModal()` are deleted. The two GDrive flags joined the store's contract so the store stays the only writer, and `popup.js` now writes nothing to `chrome.storage.local` at all. Remaining modals (add-tabs, history, session details, duplicates, shortcuts help) and the grid-view modal's conversion to the primitive are next. See `docs/decisions/ADR-0005-modal-primitive-and-settings.md`. |
| 1.3.0 | 2026-10-01 | The state layer is single-queue and `popup.js` no longer owns one: `getState()` / `updateState()` are wrappers over `window.__tcmStore` (`src/app/legacy-store.js`), which translates the flat legacy shape to and from the store draft, `updateQueue` and `setState` are deleted, and the six settings toggles write through the queue instead of single-key `chrome.storage.local.set` calls. This closes the race ADR-0002 accepted and makes the bundle load-bearing: the plain copy build (`build:legacy`, `scripts/copy-extension.mjs`) and the "load the repository root" path are gone — see `docs/decisions/ADR-0004-single-write-queue.md`. |
| 1.2.0 | 2026-10-01 | Phase 3 (drag & drop) shipped: `useDraggable` / `useDropZone` / `DragAndDropProvider` drive native HTML5 reordering of collections and tabs, the four pure mutators (`reorderCollections`, `reorderTabsWithinCollection`, `moveTabToCollection`, `moveTabToCollectionAtPosition`) live in `collectionDraft.js` behind the store's `mutate()`, and the legacy helpers plus their `alert()` refusal are deleted from `popup.js`. Covered by `dragAndDrop.test.jsx` and `useCollectionActions.test.js`. See `docs/decisions/ADR-0003-drag-and-drop-hooks.md`. The rest of Phase 3 (CRUD, sort menus, search slide, layout toggle, import/export, open/restore) had already landed with Phase 2's functional-at-every-commit decision. **Corrected in 1.7.0:** those items did not land and were still in `popup.js` at that time — see §2.1. |
| 1.1.0 | 2026-10-01 | Language switched to **JavaScript + JSDoc** (no TypeScript, per `skill.md` 2.0.0) — the TS snippets in §4, §6 and §9 are historical and superseded by `skill.md` §5. Phase 0/1 shipped: Vite bundle composed into `dist/sidepanel.html`, store + shell. Phase 2 shipped: `CollectionList` / `CollectionCard` / `TabList` / `TabRow` / `GridCollectionModal` render from the store; the template-cloning renderers (`renderCollections`, `renderCollection`, `renderTabs`, `renderTab`) and their `<template>` markup are deleted, expand/collapse and tab sort move through the new `mutate()` queue, and two temporary seams (`src/app/legacy-ui.js`, `src/app/legacy-handle.js`) keep the remaining legacy actions working. Drag & drop stays in Phase 3. See `docs/decisions/ADR-0002-collections-list-react.md`. |
| 1.0.0 | 2026-10-01 | Initial plan derived from a full audit of the vanilla implementation |
