# SKILL.md — Engineering Standards & Collaboration Playbook

**Project:** Tab Collection Manager (Chrome MV3 extension)
**Applies to:** every human contributor and every AI agent working in this repository

| Field | Value |
| --- | --- |
| Document version | 2.5.0 |
| Status | Active |
| Last updated | 2026-10-02 |
| Owner | Maintainer (`@mkn`) |
| Supersedes | — |

> **Rule zero:** if this document and a one-off preference disagree, follow this document, then
> propose an amendment via PR to `skill.md` (see §11).

---

## 0. How to use this document

1. **Before your first commit**, read §2 (architecture), §3 (folders), §4 (modularity).
2. **While coding**, follow §5 (standards) and §6 (verification).
3. **Before opening a PR**, run the checklist in §8.
4. **When releasing**, follow §7.
5. Standards here are **enforceable**: lint/format/type checks and folder rules are part of
   "done", not suggestions.

---

## 1. Product & stack overview

A Chrome Manifest V3 extension that saves, restores, and auto-tracks browser tab collections
through a persistent side panel.

| Concern | Choice | Notes |
| --- | --- | --- |
| Extension platform | Chrome MV3 (`manifest_version: 3`) | Brave/Edge share the Chromium base; Firefox is **not** supported today |
| UI entry | `side_panel.default_path` | The toolbar action opens the side panel (there is no `default_popup`) |
| UI framework | **React 19 + JavaScript (ES2022+)** (migration target) | Current shipped UI is vanilla JS — see `react-migration-plan.md` |
| Build | **Vite 6** + `@crxjs/vite-plugin` | Fallback: Vite multi-entry + static copy |
| State | `chrome.storage.local` as the single source of truth | Wrapped by a store exposing `useSyncExternalStore` |
| Service worker | ES modules under `background/`, bundled to `background.js` | Autosave engine is the highest-risk code in the repo |
| Tests | Vitest + React Testing Library + Playwright | Net-new; see §6 |
| Package manager | **npm** (single lockfile) | Do not mix npm/yarn/pnpm |

### Language & tooling baseline

| Tool | Config | Enforcement |
| --- | --- | --- |
| JavaScript | ES2022+, ES modules, `.js` / `.jsx`; optional JSDoc for editor hints | `eslint .` in CI and in `npm run build` |
| ESLint | flat config: `@eslint/js` + `react` + `react-hooks` + `jsx-a11y` | CI fails on `error` |
| Prettier | single config, enforced | CI check; **format on save** locally |
| Editor | `.editorconfig`, LF endings | Prevents whitespace-only diff noise |

---

## 2. Architecture

### 2.1 Layers and the dependency rule

```text
        ┌──────────────────────────────────────────┐
        │  app/         (shell, layout, providers) │
        ├──────────────────────────────────────────┤
        │  features/    (collections, tabs, ...)   │
        ├──────────────────────────────────────────┤
        │  components/  (dumb primitives)          │
        ├──────────────────────────────────────────┤
        │  store/  lib/  shared/  (foundations)    │
        └──────────────────────────────────────────┘
        background/  ← separate runtime, shares only `shared/` + `lib/`
```

**The dependency rule (never break this):**

- Dependencies point **downward only**. `shared` knows nothing about `features`.
- A feature **must not import another feature**. Need shared behaviour? Move it to
  `components/`, `lib/`, or `shared/` first, then import.
- `background/` may import `shared/` and `lib/` — both are chrome-free foundations (the diagram above) — but never UI code (`app/`, `features/`, `components/`).
- No cyclic imports. `dependency-cruiser` (optional) or review catches these.

### 2.2 Runtime surfaces

| Surface | Responsibility | Must NOT do |
| --- | --- | --- |
| **UI (side panel / popup)** | Render state, dispatch mutations | Own long-lived state in memory; write storage keys directly outside the store |
| **Service worker** | Autosave, alarms, context menus, GDrive, restore | Render UI; hold state across restarts |
| **Store** | Hydrate from storage, serialize mutations, notify subscribers | Contain JSX or DOM code |
| **`lib/`** | Pure functions (sorting, pinning, validation, backup) | Touch `chrome.*` |
| **`shared/`** | Types + constants for storage keys and message commands | Contain logic with side effects |

### 2.3 Data contracts

Both contracts below are **versioned and frozen** unless a migration is shipped with them.

**Storage contract** (`chrome.storage.local`) — see `store/schema.js` (`@typedef` JSDoc shapes):

| Key | Type | Owner |
| --- | --- | --- |
| `collections` | `Collection[]` (with `CURRENT_SESSION_ID` first; each carries `folderId`) | store + background |
| `folders` | `Folder[]` (top-level containers; a collection points at one via `folderId`) | store + background |
| `autoSaveCollectionId` | `string \| null` | settings |
| `lastSessionBackup` | `{ tabs, chromeGroups, timestamp, collectionId, name } \| null` | background |
| `ramSaverEnabled`, `theme`, `layoutViewMode`, `collectionSortType` | primitives | settings |
| `enforceMaxPinnedTabs`, `maxPinnedTabs`, `enforceMaxPinnedCollections`, `maxPinnedCollections` | primitives | settings |
| `sessionHistory` | `Array<{ id, timestamp, tabs, chromeGroups }>` (cap 100) | background + history feature |
| `gdriveBackupEnabled`, `gdriveAutoBackupEnabled`, `lastGDriveBackup*` | primitives | gdrive feature + background |
| `schemaVersion` | `number` | store (see §7) |

Per-collection fields include `chromeGroups` (group metadata map), `folderId` (owning folder or
`null`) and per-tab `chromeGroupId`.

A **session snapshot** — either key above — carries `chromeGroups` alongside its `tabs`, because a
saved tab references its Chrome group by number and that id resolves against the snapshot's own map
(`schemaVersion` 2). A snapshot without it still restores; its tabs simply arrive ungrouped.

**Message protocol** (`chrome.runtime.sendMessage`) — request `{ command, ...payload }`,
response `{ success, ...data }`:

`forceAutoSave`, `restoreSession`, `getSessionData`, `gdriveBackup`, `gdriveRestore`,
`gdriveDeleteBackup`, `gdriveSignOut`, `gdriveEnableAutoBackup`, `gdriveGetStatus`.

Adding a command is **additive** (MINOR). Changing a payload shape is **breaking** (MAJOR) and
requires a compatibility shim for one release.

---

## 3. Repository & folder structure

### 3.1 Current state (React, post-migration)

The React migration is complete through Phase 5.4, so the layout below is no longer the vanilla
one. The UI is React + JSDoc in `src/`, bundled by Vite, and the stylesheets live in `src/styles/`
(`tokens.css` for the design values, `index.css` as the single entry, and the per-feature family
sheets `base`/`shell`/`collections`/`tabs`/`dialogs`/`settings`/`toast` the CSS migration split the
old `panel.css` into); the service worker is ES modules under `background/`, bundled by
`scripts/build.mjs` to the single `dist/background.js` the manifest names (Phase 6, ADR-0010). No
file is excluded from lint or format.

```text
manifest.json   background/   icons/
src/sidepanel.html   src/main.jsx   src/app/   src/features/   src/store/   src/lib/   src/shared/   src/styles/
scripts/build.mjs   scripts/dev.mjs   tests/
feature_list.md   missing_features.md   README.md   react-migration-plan.md   docs/decisions/
```

There is no `popup.html`, no `popup.js` and no `window.__tcmStore` bridge; `npm run build` emits
`dist/sidepanel.html` with hashed assets, `npm test` runs the Vitest suite (jsdom) and `npm run e2e`
runs the Playwright walk against `dist/` loaded unpacked.

### 3.2 Target structure

```text
.
├─ manifest.json                 # source of truth for the extension manifest
├─ package.json  jsconfig.json  vite.config.js  eslint.config.js  .prettierrc
├─ src/
│  ├─ sidepanel.html             # Vite entry (replaces popup.html)
│  ├─ main.jsx                   # React root: providers + <App />
│  ├─ app/
│  │  ├─ App.jsx
│  │  ├─ providers/              # ToastProvider, ThemeProvider, StoreProvider
│  │  └─ layout/                 # AppHeader, ControlsBar, ScrollableContent
│  ├─ features/
│  │  ├─ collections/            # { components, hooks, lib, types.js, index.js }
│  │  ├─ tabs/
│  │  ├─ search/
│  │  ├─ settings/
│  │  ├─ history/
│  │  ├─ gdrive/
│  │  ├─ duplicates/
│  │  └─ keyboard/
│  ├─ components/                # dumb primitives: Button, Toggle, Modal, IconButton, Highlight
│  ├─ store/                     # schema.js, store.js, hooks.js, migrations/
│  ├─ lib/                       # pure utils: sort.js, pinning.js, backup.js, url.js, format.js
│  ├─ shared/                    # types/, storage-keys.js, messages.js, constants.js
│  └─ styles/                    # tokens.css, index.css + base/shell/collections/tabs/dialogs/settings/toast.css
├─ background/
│  ├─ index.js                   # service worker entry
│  ├─ autosave.js  restore.js  contextMenu.js  alarms.js  gdrive.js
│  └─ __tests__/
├─ public/                       # static passthrough: icons/, _locales/
├─ tests/
│  ├─ setup.js
│  ├─ mocks/chrome.js
│  └─ e2e/                       # Playwright specs
├─ docs/
│  ├─ architecture.md
│  ├─ storage-schema.md
│  └─ decisions/                 # ADR-0001-react-migration.md, ADR-0002-state-store.md ...
├─ skill.md                      # this file
├─ react-migration-plan.md
├─ feature_list.md
└─ README.md
```

### 3.3 Folder rules

| Folder | Accepts | Rejects |
| --- | --- | --- |
| `app/` | Composition, providers, layout | Feature business logic |
| `features/<name>/` | One bounded capability, self-contained | Imports from a sibling feature |
| `components/` | Reusable, presentational, no `chrome.*` | Feature-specific behaviour |
| `store/` | Schema, hydration, mutations, hooks | JSX, DOM access |
| `lib/` | Pure, deterministic functions | `chrome.*`, `document`, `window` |
| `shared/` | Types, constants, keys, messages | Side effects, React |
| `background/` | Service-worker logic | UI imports |
| `docs/decisions/` | One ADR per irreversible choice | Living docs (those go in `docs/`) |

**Feature folder template**

```text
features/collections/
├─ components/CollectionList.jsx
├─ components/CollectionCard.jsx
├─ hooks/useCollectionActions.js
├─ lib/collectionSort.js
├─ types.js
├─ __tests__/CollectionCard.test.jsx
└─ index.js            # the ONLY public surface of this feature
```

---

## 4. Modularity for parallel work (conflict-free collaboration)

The goal: **two developers can work on different capabilities at the same time and never touch
the same lines.**

### 4.1 File ownership rules

| Rule | Why |
| --- | --- |
| One component / hook / util **per file** | Two PRs changing one component rarely collide |
| Files named after their single export (`CollectionCard.jsx`, `useDragAndDrop.js`) | Grep-ability; predictable paths |
| **Barrels (`index.js`) export only** — never reorder existing lines when adding | Reordering a 40-line export list conflicts with everyone; appending does not |
| Keep files **≤ ~300 lines**; split by responsibility | Long files become merge battlegrounds |
| Never edit `dist/`, `node_modules/`, generated icons, or lockfiles by hand | Generated content is rebuilt, not merged |
| `docs/` and changelog sections are **append-only** | Two people can add entries without conflict |

### 4.2 Ownership map (CODEOWNERS)

```gitignore
# .github/CODEOWNERS
/store/            @mkn
/shared/           @mkn
/background/       @mkn
/features/gdrive/  @mkn
/manifest.json     @mkn
/skill.md          @mkn
```

Rule: **one owner per folder**. Anyone may contribute to any folder via PR, but the owner
reviews. This keeps the shared foundations stable while features move fast.

### 4.3 Merge-conflict avoidance tactics

| Tactic | Detail |
| --- | --- |
| Trunk-based, short-lived branches | Branch lifetime target: **< 2 days**; rebase on `main` daily |
| Small PRs | Target **≤ 400 changed lines**; larger work lands behind a feature branch of stacked PRs |
| One capability per PR | Don't mix a refactor with a feature; they conflict twice as hard |
| Deterministic formatting | Prettier + import sorting so diffs are semantic, not whitespace |
| Append, don't rewrite | New exports, new changelog entries, new ADR files |
| Avoid "hot files" | `shared/constants.js` and barrels are hot — add new files instead of editing them |
| No reformat-the-whole-file PRs | Formatting-only PRs are separate and mechanical |
| Lockfile policy | One package manager; on conflict **regenerate** (`rm package-lock.json && npm i`) instead of hand-merging |
| Rebase, never merge `main` into a feature branch | Linear history keeps `git bisect` usable |

### 4.4 Git workflow

**Branch names**

```text
feat/<area>-<slug>      feat/collections-drag-drop
fix/<area>-<slug>       fix/autosave-partial-restore
refactor/<area>-<slug>  refactor/store-hydration
docs/<slug>             docs/skill-versioning
chore/<slug>            chore/vite-setup
```

**Commit messages — Conventional Commits**

```text
<type>(<scope>): <imperative summary>

[optional body: why, not what]
[optional footer: BREAKING CHANGE: ..., Refs: #12]
```

Allowed types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`,
`style`. Scopes: `collections`, `tabs`, `search`, `settings`, `history`, `gdrive`, `store`,
`background`, `manifest`, `docs`.

**PR rules**

- Title follows Conventional Commits; squash-merge keeps `main` linear.
- Every PR states: what changed, why, how it was verified (§6), and storage/manifest impact.
- **Any** change to storage keys, the message protocol, or `manifest.json` requires an explicit
  call-out in the PR description and an ADR if breaking.

---

## 5. Coding standards

### 5.1 JavaScript

- ES2022+, ES modules, `.js` for logic and `.jsx` for components. **No TypeScript syntax.**
- **Named exports only** (no default exports) so symbols stay greppable and refactor-safe.
- No `var`; prefer `const`, use `let` only when reassigning. No implicit globals.
- Document the shared contracts with JSDoc: storage shapes as `@typedef` in `store/schema.js`,
  message payloads as `@typedef` in `shared/messages.js`.
- Public APIs (a feature's `index.js`, anything in `shared/` or `lib/`) carry JSDoc
  `@param` / `@returns` so editors still give completions and warnings.
- Never assume a stored field exists — validate and default:
  `const tabs = Array.isArray(collection.tabs) ? collection.tabs : [];`
- No `eval`, no `new Function`, no dynamically constructed code (MV3 CSP).

### 5.2 React

- Function components only; hooks at the top, never conditional.
- Keep components **presentational by default**; side effects live in hooks or the store.
- Never mutate state or storage objects in place — clone, modify, persist (matches the existing
  read → clone → modify → save discipline).
- Keys are stable IDs (`tab.id`, `collection.id`), never array indexes.
- `useMemo`/`useCallback` only where measured — no cargo-cult memoisation.
- Document component props with a JSDoc `@typedef` above the component; no spreading unknown props onto DOM nodes.
- One `Modal` primitive + a single portal root; feature screens compose it.

### 5.3 CSS

- Design tokens (colors, spacing, radii, shadows) live in `styles/tokens.css` as CSS variables.
  Never hard-code a color that exists as a token.
- One stylesheet per component; classes prefixed by feature (`cc-` collections,
  `tab-` tabs, `set-` settings) to avoid global collisions.
- No `!important`, no descendant selectors deeper than 3 levels, no styling by element tag.
- Dark theme is the default; light theme overrides via tokens only.

### 5.4 Chrome extension (MV3) rules

- **No remote code.** All scripts bundle locally. Fonts/icons are self-hosted.
- **No inline scripts or inline event handlers** — CSP blocks them and it breaks review.
- Permissions are **justified in the PR**; removing one is a feature, adding one needs a reason.

  | Permission | Justification |
  | --- | --- |
  | `tabs` | Read/restore open tabs |
  | `tabGroups` | Capture and rebuild Chrome tab groups |
  | `storage` | Persist collections and settings |
  | `contextMenus` | "Add to Collection" right-click menu |
  | `sidePanel` | Side-panel UI |
  | `alarms` | Daily GDrive auto-backup |
  | `identity` | Google Drive OAuth |
  | `favicon` | Favicon lookup for saved tabs |

- Service worker must stay **stateless across restarts**: persist anything you need.
- Never block the worker on long loops; chunk and persist.
- Test every change by loading `dist/` unpacked — `vite dev` alone is not verification.

### 5.5 Errors, logging, accessibility

- Wrap `chrome.*` calls that commonly fail (`tabs.get`, `tabGroups.get`, identity) in
  `try/catch` and degrade gracefully — never let a missing group or revoked token break a render.
- Log with a scoped prefix (`[autosave]`, `[gdrive]`, `[restore]`); no `console.log` of user data
  or tokens. `console.warn`/`error` for failures.
- User-visible failures become toasts; silent failures are bugs.
- Every interactive element is keyboard reachable, has an accessible name (visible label or
  `aria-label`), and dialogs trap focus and close on `Escape`.

---

## 6. Testing & verification

| Level | Tool | Required for |
| --- | --- | --- |
| Lint | ESLint (flat config) | Every PR (CI gate) |
| Format | Prettier | Every PR (CI gate) |
| Unit | Vitest | Pure logic: sorting, pinning, URL validation, backup, migrations, group mapping |
| Component | RTL + jsdom | Any component with logic (lists, modals, settings) |
| E2E | Playwright, `channel: 'chromium'` | Golden paths against `dist/` loaded unpacked: create collection, add tabs, reorder, search, settings, export/import, restore. Use Playwright's bundled Chromium — branded Chrome and Edge dropped `--load-extension` / `--disable-extensions-except` in 2025 — and one persistent profile per test so storage starts empty |
| Bundle size | `npm run check:size` (CI gate) | Any change that adds a dependency, an asset or a chunk |
| Manual matrix | Checklist in the PR | Anything touching autosave, restore, or storage shape |

**Minimum bar for a PR to be mergeable:** `npm run build` succeeds, `eslint .`, `prettier --check .`
and `npm test` pass, `npm run check:size` stays inside its budget, new logic has tests, and the
manual matrix has been run for any storage/restore change. All of it runs in
`.github/workflows/ci.yml` on every push, so the local commands are for the inner loop.

Chrome APIs are mocked centrally in `tests/mocks/chrome.js` (see `react-migration-plan.md` §9
for a reference implementation). Do not hand-roll mocks per test file.

---

## 7. Versioning & releases

Four independent version axes. **Never conflate them.**

| Axis | Where | Scheme | Bump when |
| --- | --- | --- | --- |
| Extension | `manifest.json` → `version` | **SemVer** `MAJOR.MINOR.PATCH` | User-visible feature (MINOR), breaking storage/protocol change (MAJOR), fix (PATCH) |
| Storage schema | `schemaVersion` key + `store/migrations/` | integer, monotonic | Any change to a persisted shape |
| Message protocol | `shared/messages.js` constant | integer, monotonic | Any change to a command payload |
| Documentation | header table of each doc | SemVer for the **document** | Content changes to that document |

### 7.1 Storage migrations

1. Add `store/migrations/000X-<slug>.js` exporting `up(data) => data`.
2. Register it in the ordered migration list — **append only**.
3. Bump `schemaVersion`.
4. Ship the migration in the same commit as the shape change, plus a unit test with a real
   pre-migration fixture.
5. Never rewrite history: old migrations are immutable once released.

### 7.2 Release checklist

- [ ] `main` is green (build, lint, unit, e2e)
- [ ] `manifest.json` version bumped per SemVer
- [ ] `schemaVersion` / protocol version bumped if contracts changed
- [ ] Migration tested against a real exported backup
- [ ] `feature_list.md` updated (implemented items checked)
- [ ] README / docs updated for user-visible changes
- [ ] `dist/` built and loaded unpacked one final time
- [ ] Git tag `vX.Y.Z` created
- [ ] Chrome Web Store listing notes drafted (permissions diff called out)

### 7.3 Deprecation policy

Removals happen over two releases: add the replacement and mark the old path deprecated
(warning log + doc note), then remove in the next MINOR/MAJOR. Storage keys follow the same
rule — read both, write the new one, drop the old after one release.

---

## 8. Definition of Done & PR checklist

A change is **done** when all of the following hold:

- [ ] Feature/fix works when the built extension is loaded unpacked
- [ ] `eslint .`, Prettier check, and `npm test` pass locally
- [ ] New logic has unit/component tests; golden paths still pass
- [ ] No new permissions, or the PR justifies them
- [ ] Storage keys / message protocol unchanged — or bump + migration + tests included
- [ ] Files respect the folder rules (§3.3) and the dependency rule (§2.1)
- [ ] Docs updated (`skill.md` amendment, ADR, feature list, README as applicable)
- [ ] PR ≤ ~400 lines or split; one capability only
- [ ] Autosave/restore unaffected, or the manual matrix was run and reported

---

## 9. Templates

**New component**

```jsx
// features/collections/components/CollectionCard.jsx

/**
 * @typedef {object} CollectionCardProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {(id: string) => void} onToggle
 */

/** @param {CollectionCardProps} props */
export function CollectionCard({ collection, onToggle }) {
  // ...
}
```

**New hook**

```js
// features/collections/hooks/useCollectionActions.js

/**
 * @typedef {object} CollectionActions
 * @property {(name: string) => Promise<void>} create
 * @property {(id: string, name: string) => Promise<void>} rename
 * @property {(id: string) => Promise<void>} remove
 */

/** @returns {CollectionActions} */
export function useCollectionActions() {
  // ...
}
```

**Feature public API**

```js
// features/collections/index.js
export { CollectionList } from './components/CollectionList.jsx';
export { useCollectionActions } from './hooks/useCollectionActions.js';
```

**ADR skeleton**

```markdown
# ADR-0002: Storage-backed store with useSyncExternalStore

- Status: accepted
- Date: 2026-10-01
- Context: ...
- Decision: ...
- Consequences: ...
- Alternatives considered: ...
```

---

## 10. Anti-patterns (do not do)

- ❌ Editing the service worker (`background/`) and UI state shape in the same commit as unrelated work
- ❌ Building HTML with string concatenation / `innerHTML`
- ❌ Importing one feature from another feature
- ❌ Duplicating a storage key string instead of importing from `shared/storage-keys.js`
- ❌ Reordering barrel exports or alphabetising a whole file in a feature PR
- ❌ Adding a permission "to make it work" without documenting why
- ❌ Hand-merging lockfiles, or committing `node_modules/` / `dist/`
- ❌ Tests that mock `chrome` locally instead of using `tests/mocks/chrome.js`
- ❌ Adding TypeScript syntax (`.ts` / `.tsx`, type annotations) to this JavaScript codebase
- ❌ Reformatting files unrelated to the change
- ❌ Long-lived branches (> 2 days) without rebasing on `main`

---

## 11. Amending this document

1. Open a PR titled `docs(skill): <change>`.
2. Bump the document version in the header table (PATCH for clarifications, MINOR for new rules,
   MAJOR for rule reversals).
3. Add a row to the changelog below — **append only**.
4. The maintainer reviews; merged changes become binding immediately.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-10-01 | Initial standards: stack, architecture, folder structure, parallel-work rules, versioning |
| 2.0.0 | 2026-10-01 | Reversed the language rule: React + JavaScript (ES2022+) with JSDoc instead of TypeScript; ESLint replaces the type-check gate |
| 2.1.0 | 2026-10-01 | §3.1 corrected from "Current state (vanilla)" to the post-migration layout: the React migration is complete through Phase 5.3, so `popup.html` / `popup.js` / the store bridge no longer exist and the section no longer claims "no build system, no modules, no tests". |
| 2.1.1 | 2026-10-02 | Phase 6/7 landed, so §1 and §3.1 name the service worker as ES modules under `background/` (bundled to `dist/background.js`) rather than "vanilla JS today", §5.4's permission table drops the `downloads` row its only caller (the dormant local daily backup) lost, and §10's anti-pattern names the new path. No rule changed. |
| 2.2.0 | 2026-10-02 | §2.1 allows the service worker to import `lib/` as well as `shared/`. The modular worker needs one pure helper (`normalizeGroupId`) that already has a canonical home; the diagram always placed `store/`, `lib/` and `shared/` in one chrome-free foundations layer, so the stricter wording barring the `lib/` edge only forced a duplicate. UI imports stay forbidden. |
| 2.3.0 | 2026-10-02 | §2.3's storage contract gains the `folders` row and notes the per-collection `folderId`, both introduced by the folder hierarchy (Phase 8) under `schemaVersion` 1. No rule changed. |
| 2.5.0 | 2026-10-02 | §3.1's stylesheet description follows Phase 2 of the CSS migration: `panel.css` is gone, split into `tokens.css` (Phase 1) plus the `base`/`shell`/`collections`/`tabs`/`dialogs`/`settings`/`toast` family sheets, with `index.css` as the single entry. The repository is no longer Prettier-excluded anywhere. No rule changed. |
| 2.4.0 | 2026-10-02 | §2.3's snapshot rows gain `chromeGroups`: a session snapshot's tabs reference their Chrome group by number, so the map has to be stored with them or the id resolves to nothing and no restore path can rebuild the group. Landed with migration 0002 and `schemaVersion` 2. No rule changed. |
