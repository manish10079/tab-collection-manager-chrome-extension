# React Migration Plan — Tab Collection Manager

| Field | Value |
|---|---|
| Document version | 1.1.0 |
| Status | In progress — Phases 0, 1 and 2 shipped (see the changelog) |
| Scope | UI layer of the MV3 extension (`popup.html` / `popup.js` / `popup.css`) |
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

| Layer | Size | Notes |
|---|---|---|
| `popup.html` | 657 lines | 7 modals, 3 `<template>` blocks, 0 inline handlers (MV3-safe), Font Awesome + Google Fonts via CDN |
| `popup.js` | ~3,600 lines | ~77 functions, 30 sections; read -> clone -> modify -> save -> render; full re-render on `storage.onChanged` |
| `popup.css` | ~2,870 lines | CSS variables, glassmorphism, modal/settings sections |
| `background.js` | ~1,290 lines | Autosave + debounce + guards, session history, context menus, alarms, GDrive, restore + tab groups |
| Build | none | Hand-written manifest, no bundler, no deps, no tests |

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
- **Single UI entry today:** `side_panel.default_path = popup.html`; the action button opens the
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

**Phase 0 — Prep (0.5 day)**
Init `package.json`, Vite, TS config, `dist/` in `.gitignore`, and a smoke test that the current
extension still loads from `dist/` after a trivial copy build.
*Acceptance:* `dist/` loads unpacked; side panel opens; autosave still works.

**Phase 1 — Scaffold + mount React shell (1-1.5 days)**
Create `src/sidepanel.html`, `main.tsx`, `App`, and the store. Keep the existing `popup.js`
loaded in the same page temporarily so nothing regresses while React renders only header and
controls.
*Acceptance:* React renders header + controls; existing behaviour untouched; no console errors.

**Phase 2 — Read-only rendering (1.5-2 days)**
Migrate `renderCollections` / `renderCollection` / `renderTab` to
`CollectionList` / `CollectionCard` / `TabRow` driven by the store. Wire
`storage.onChanged` -> single React re-render. Delete template-cloning render paths.
*Acceptance:* identical visuals; expand/collapse persists; no focus loss on re-render.

**Phase 3 — Interactions (3-4 days)**
CRUD (create/rename/delete/duplicate check), pin toggles, sort menus, search slide + results,
layout toggle, drag & drop reorder, import/export, open/restore actions.
*Acceptance:* the manual test matrix passes; vanilla event-listener stubs removed.

**Phase 4 — Modals & settings (3-4 days)**
Add-tabs modal, settings modal, GDrive section, history + session details, collection details,
duplicates dialog, shortcuts help. Introduce one `Modal` primitive + portal root.
*Acceptance:* all 7 modals work; settings persist; GDrive round-trips against the unchanged
background.

**Phase 5 — Polish & parity sweep (1.5-2 days)**
Toasts preserved, animations, keyboard shortcuts hook, focus/Escape handling, a11y labels,
delete the last vanilla code and dead CSS, self-host fonts/icons, bundle-size check.
*Acceptance:* `popup.js` deleted; visual diff clean; no leftover `getElementById`.

**Phase 6 — Background modernization (optional, 2-3 days)**
Port `background.js` to TS modules; extract shared types into `shared/`; add tests for autosave
guards and tab-group restore.
*Acceptance:* autosave behaviour unchanged; message protocol unchanged.

**Phase 7 — Store readiness (1 day)**
Optional `default_popup`, permission audit (`tabGroups` now used; `downloads` only for the
disabled local backup), remove CDN links, docs update, tag a release.

**Total: ~14-19 developer-days** (~3-4 weeks part-time), assuming one developer and no new
features during the migration.

---

## 9. Testing strategy

- **Unit (Vitest):** `lib/sort.ts`, `lib/pinning.ts`, `lib/backup.ts`, duplicate normalization,
  group capture/restore mapping, store reducers.
- **Component (RTL + jsdom):** `CollectionCard`, `TabRow`, `SettingsModal`, `OpenTabsPicker`
  with a chrome API mock.
- **E2E (Playwright, persistent context with `--load-extension=dist`):** side panel opens;
  create collection; add tabs; reorder; search; toggle settings; export/import round-trip;
  tab-group restore.
- **Manual matrix before deleting `popup.js`:** run old and new builds against the same storage
  profile and compare screenshots + storage snapshots for a scripted scenario list.

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
               getManifest: () => ({ version: '2.0.0' }) },
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
`dist-legacy/` from the Phase 0 copy task; that task is gone, because `popup.js` now reads state
through the bundled store and a copy build could not run.) If a phase fails review, revert that
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
| 1.0.0 | 2026-10-01 | Initial plan derived from a full audit of the vanilla implementation |
| 1.4.0 | 2026-10-01 | Phase 4 started: `src/components/Modal.jsx` is the one modal primitive (shared portal root on `document.body`, focus in/out, Tab trap, topmost-only Escape, overlay click) and the settings modal is its first consumer — `src/features/settings` renders Session, Performance, Appearance, Keyboard Shortcuts, Cloud Backup and Limits from the store, writes everything through `mutate()`, and the legacy markup plus the ~300-line `setupSettingsModal()` are deleted. The two GDrive flags joined the store's contract so the store stays the only writer, and `popup.js` now writes nothing to `chrome.storage.local` at all. Remaining modals (add-tabs, history, session details, duplicates, shortcuts help) and the grid-view modal's conversion to the primitive are next. See `docs/decisions/ADR-0005-modal-primitive-and-settings.md`. |
| 1.3.0 | 2026-10-01 | The state layer is single-queue and `popup.js` no longer owns one: `getState()` / `updateState()` are wrappers over `window.__tcmStore` (`src/app/legacy-store.js`), which translates the flat legacy shape to and from the store draft, `updateQueue` and `setState` are deleted, and the six settings toggles write through the queue instead of single-key `chrome.storage.local.set` calls. This closes the race ADR-0002 accepted and makes the bundle load-bearing: the plain copy build (`build:legacy`, `scripts/copy-extension.mjs`) and the "load the repository root" path are gone — see `docs/decisions/ADR-0004-single-write-queue.md`. |
| 1.2.0 | 2026-10-01 | Phase 3 (drag & drop) shipped: `useDraggable` / `useDropZone` / `DragAndDropProvider` drive native HTML5 reordering of collections and tabs, the four pure mutators (`reorderCollections`, `reorderTabsWithinCollection`, `moveTabToCollection`, `moveTabToCollectionAtPosition`) live in `collectionDraft.js` behind the store's `mutate()`, and the legacy helpers plus their `alert()` refusal are deleted from `popup.js`. Covered by `dragAndDrop.test.jsx` and `useCollectionActions.test.js`. See `docs/decisions/ADR-0003-drag-and-drop-hooks.md`. The rest of Phase 3 (CRUD, sort menus, search slide, layout toggle, import/export, open/restore) had already landed with Phase 2's functional-at-every-commit decision. |
| 1.1.0 | 2026-10-01 | Language switched to **JavaScript + JSDoc** (no TypeScript, per `skill.md` 2.0.0) — the TS snippets in §4, §6 and §9 are historical and superseded by `skill.md` §5. Phase 0/1 shipped: Vite bundle composed into `dist/sidepanel.html`, store + shell. Phase 2 shipped: `CollectionList` / `CollectionCard` / `TabList` / `TabRow` / `GridCollectionModal` render from the store; the template-cloning renderers (`renderCollections`, `renderCollection`, `renderTabs`, `renderTab`) and their `<template>` markup are deleted, expand/collapse and tab sort move through the new `mutate()` queue, and two temporary seams (`src/app/legacy-ui.js`, `src/app/legacy-handle.js`) keep the remaining legacy actions working. Drag & drop stays in Phase 3. See `docs/decisions/ADR-0002-collections-list-react.md`. |
