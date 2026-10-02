# Missing Features vs Ta Box (Tabox) 4.2.2

Comparison of **Tab Collection Manager v2.1.1** against the Ta Box extension build
(`ta box tab collection manager extension.zip`, Chrome Web Store build, webpack + React).

Features we already have are **not** listed here: collection CRUD, drag & drop reorder,
autosave engine, session backup/restore, RAM Saver (discard), import/export JSON,
global search, collection/tab sorting, duplicate-URL detection, context menus,
pinned collections, list/grid layout, light/dark theme, Google Drive backup, keyboard
shortcuts (panel-scoped).

Legend: 🔴 major · 🟡 medium · ⚪ minor

---

## 🔴 Major missing features

### 1. Folder hierarchy for collections — ✅ implemented
- **Ta Box:** real folders (`folders_index`, `folder_*` records, `parentId` on collections),
  folder colors, collapse state, drag collections in/out of folders, per-folder tab counts.
- **Us:** implemented. A `folders` array plus a per-collection `folderId` (one level deep);
  `FolderSection` renders the header (expand/collapse, inline rename, counts, options menu)
  with its collections nested inside; drag a collection onto a folder to move it in, drag a
  nested collection onto the root drop zone to move it out, and deleting asks once and then
  removes the folder's collections with it. Folders travel through global export/import and
  the Drive backup, and the persisted shape is upgraded by a versioned migration
  (`schemaVersion: 1`). A separate Select mode bulk-deletes several folders and collections
  at once from both sections.
- **Still missing:** folder colors.

### 2. Chrome Tab Groups capture & restore — ✅ implemented
- **Ta Box:** stores `chromeGroups` metadata (group name, color, collapsed, pinned) with
  each collection and rebuilds actual Chrome tab groups on restore via the
  `chrome.tabGroups` API (15+ references in its background utils).
- **Us:** implemented. `background/chromeGroups.js` records each tab's `groupId` plus the
  group's `title/color/collapsed` on save (`collection.chromeGroups` + per-tab
  `chromeGroupId`), and `background/restore.js` re-groups the unpinned tabs via
  `chrome.tabs.group()` then applies the metadata with `chrome.tabGroups.update()`.

### 3. Sharing & collaboration (requires a backend)
- **Ta Box (Pro, server-backed):** shared folders with members and roles
  (owner / read / write), email invites with notification, public share links for
  single collections and whole folders, join-by-link (with sign-in-deferred stash),
  leave/unshare, member role changes, activity feed (who changed what), and
  per-folder comments. Full API client in `shared-folders.js`.
- **Us:** "Collection Sharing" is a roadmap idea only.
- **Note:** needs server infrastructure (Ta Box uses a Cloudflare Worker API) —
  decide before investing.

### 4. AI assistant (5 tools, server LLM)
- **Ta Box (Pro):** server-side LLM (`/ai/complete`, JSON-schema-constrained):
  1. **Smart organize** – cluster a window's ungrouped tabs into named + colored Chrome tab groups
  2. **Auto-arrange** – file collections into folders (creates/suggests folders)
  3. **Batch rename** – suggest names for up to 10 unnamed collections at once
  4. **Split collection** – split one collection into 2–4 themed sub-collections, with undo
  5. **Duplicate sweep** – find duplicate URL groups across collections with recommended
     keep-one / dedupe-within / extract-to-new-collection / discard-all actions, plus
     undo history and empty-collection cleanup
- **Us:** none. Even without an LLM, the **duplicate sweep + undo** workflow is worth
  building deterministically (we only warn before insert today).

### 5. True multi-device cloud sync (merge, not just backup)
- **Ta Box:** incremental sync engine with snapshot **merge and conflict resolution**
  (`lastUpdated`-wins per entity), **deletion tombstones** (deleted collections/folders
  remembered so deletes propagate), pre-sync safety backups, version recovery, refresh
  tokens, sync lock, storage/sync version migration.
- **Us:** one-way Drive backup + manual restore. Two machines overwrite each other.
- **To build:** per-entity `lastUpdated` timestamps, tombstone list, merge function on
  restore, keep multiple Drive file versions.

### 6. Recently closed restore (`chrome.sessions`)
- **Ta Box:** uses `sessions.getRecentlyClosed`, `sessions.restore`,
  `sessions.onChanged` to restore recently closed tabs/windows.
- **Us:** permission not declared; no UI.
- **To build:** add `"sessions"` permission; a "Recently closed" section/slide in the
  panel with one-click restore of tabs or windows.

---

## 🟡 Medium gaps

### 7. Global keyboard commands (`chrome.commands`)
- Ta Box binds **Ctrl+Shift+1..4** to open the 1st–4th collection from anywhere in the
  browser via manifest `commands` + `background` handler.
- Our shortcuts only work while the side panel has focus.
- **To build:** add `commands` to manifest.json; handler in the worker (`background/`) that opens
  collection N from storage.

### 8. Sleep/deferred tabs (placeholder page restore)
- Ta Box's `deferedLoading.html/js`: restores tabs as tiny placeholder pages showing
  favicon + `(click to load)`, and only navigates to the real URL on focus/click/interaction.
- Complements (not replaces) our discard-based RAM Saver — works even for URLs that
  fail to restore from discard state.

### 9. Incognito support
- Ta Box: `"incognito": "spanning"` in manifest + explicit incognito handling in the
  background worker (tabs saved from incognito windows are tracked separately).
- Us: incognito windows are silently ignored/untracked.

### 10. Multi-window / monitor-aware restore
- Ta Box requests `system.display` and stores window bounds metadata so collections
  reopen into correctly positioned windows across monitors.

### 11. Push notifications for shared events
- Ta Box: web-push subscription via VAPID (`push-client.js`) + optional `notifications`
  permission — live pings when shared collections change; invite notifications.

### 12. Full-page manager view
- Ta Box ships `fullpage.html` — the entire manager in a normal browser tab for when
  the side panel is too cramped.

---

## ⚪ Minor gaps / quality-of-life

13. **Per-collection colors** (color picker on collection, used in UI accents)
14. **Favorites with custom favorite order** (`isFavorite`, `favoriteOrder`) — our pinning covers most of this
15. **`lastOpened` tracking per collection** — enables "recently opened" sort
16. **`unlimitedStorage` permission** — we cap collections at 200 tabs; Ta Box doesn't cap
17. **Storage versioning + data validation & migration** (`storageVersion`, `syncVersion`) for safe future upgrades
18. **Cross-browser support reality check** — Ta Box bundles `browser-polyfill.min.js`; our feature_list.md claims Firefox support but the MV3 manifest has no `sidebar_action` and uses Chrome-only APIs (sidePanel)

---

## Suggested priority (local-only features first, no backend needed)

1. Chrome tab groups capture & restore — ✅ done
2. Folder hierarchy — ✅ done
3. Recently closed restore — small effort, uses one new permission
4. Duplicate sweep + undo — builds directly on our existing duplicate detection
5. Global keyboard commands (Ctrl+Shift+1..4) — small effort
6. Sleep/deferred tab restore — medium effort, UX win for big restores
7. Two-way Drive sync with merge & tombstones — large effort, no backend required
8. Incognito + window-bounds metadata — polish

Backend-dependent (decide first): sharing & collaboration, AI tools, push notifications.
