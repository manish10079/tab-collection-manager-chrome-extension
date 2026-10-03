# Tab Collection Manager v2.4.0

A powerful browser extension for managing, organizing, backing up, and restoring browsing sessions with a premium side-panel experience.

---

# Features Overview

## Core Collection Features

* Create unlimited tab collections
* Rename collections
* Delete collections
* Expand and collapse collections
* Collection creation timestamp
* Collection last modified timestamp
* Editable collection names
* Duplicate collection name prevention (case-insensitive)
* Maximum tab limit per collection (200 tabs)
* Empty state UI when no collections exist

---

## Tab Management Features

### Tab Creation & Editing

* Add tabs manually using Title + URL form
* Add currently open tabs using multi-select mode
* Add all open tabs at once
* Remove individual tabs
* Edit tab titles

### Tab Restoration

* Open individual tabs
* Restore entire collections
* Restore complete browsing sessions
* Rebuild Chrome tab groups with their saved name, color and collapsed state

### Preserved Tab Metadata

* Tab order
* Browser pinned state
* Active state
* Highlighted state
* Discarded state
* Window grouping information
* Chrome tab group membership (group name, color, collapsed state)
* Tab creation timestamp

---

## Auto Save Engine

### Automatic Session Tracking

* Auto-save current browser session
* Dedicated **Current Session** collection
* Automatic updates when:

  * Tab created
  * Tab removed
  * URL changed
  * Title changed
  * Window closed
  * Window focus changed

### Reliability Features

* 500ms debounce protection
* Startup stabilization period
* Partial restore protection
* Session corruption guard
* Automatic backup before overwrite

---

## Session Recovery Features

* Previous session backup system
* One-click restore button
* Backup metadata tooltip
* Session rollback support
* Crash recovery protection
* Protection against accidental overwrites

---

## RAM Saver Mode

A lightweight session restoration system for large collections.

### Features

* Optional RAM Saver toggle
* Lazy loading restored tabs
* Tabs restored in discarded state
* Tabs load only when clicked
* Restore hundreds of tabs without consuming large amounts of RAM

---

## Import & Export Features

### Global Operations

* Export all collections to JSON
* Import all collections from JSON
* Merge collections during import
* Preserve metadata

### Collection Operations

* Export individual collections
* Import tabs into existing collections
* Support both old and new backup formats

---

## Search Features

* Global search box
* Search collection names
* Search tab titles
* Search URLs
* Animated search transitions
* Highlight matching tabs
* Empty result screen
* Instant filtering

---

## Sorting Features

### Collection Sorting

* Custom order
* Last modified
* Name (A-Z)
* Name (Z-A)
* Date created (Newest)
* Date created (Oldest)
* Tab count (Highest)
* Tab count (Lowest)

### Tab Sorting

* Custom order
* Title (A-Z)
* Title (Z-A)
* Date added (Newest)
* Date added (Oldest)

### Dynamic Icons

* Sort icon changes automatically based on active sorting mode

---

## Drag & Drop Features

### Collection Reordering

* Drag collections
* Custom collection ordering
* Dedicated drag handles

### Tab Reordering

* Drag tabs
* Custom tab ordering
* Dedicated drag handles

### Folder Membership

* Drag a collection onto a folder section to move it in
* Drag a nested collection onto the root drop zone to move it back out
* Dropping a collection on another adopts that collection's folder
* Current Session always stays at the root (it is a live mirror, not a folder member)

---

## Bulk Delete 🧹 ✅ Implemented

Select several folders and collections across both sections and remove them in one action.

### Implemented

* A **Select** toggle in the controls bar turns on a checkbox on every folder and collection
* One shared selection spans both sections, with a live "N selected" count
* **Delete selected** asks for one confirmation that names what will go, then removes it all
* Deleting a selected folder cascades to the collections inside it, and the prompt says so
* A collection inside a folder can be checked on its own, without selecting its folder
* Current Session is never deletable, so its checkbox is disabled
* Selection mode exits on delete or cancel, and the live state is UI-only (no storage key changes)

---

## Duplicate Detection System

* Detect duplicate URLs across collections
* Ignore Current Session to avoid false positives
* Display duplicate locations
* Confirmation dialog before insertion
* Add Anyway option

---

## Context Menu Integration

Right click anywhere in the browser to:

* Add current page to a collection
* Add links directly to collections
* Access dynamically generated menus
* Automatically update menus when collections change

---

## Side Panel Support

Unlike popup-based tab managers:

* Opens in Chrome Side Panel
* Persistent workspace
* Does not close when opening tabs
* Includes dedicated close button

---

## UI Features

* Glassmorphism design
* Premium dark mode
* Animated gradient backgrounds
* Panel open and close animations
* Search animations
* Toast notifications
* Hover tooltips
* Chrome tab group badge on saved tabs (group colour dot + group name)
* Responsive layout
* Custom checkbox controls
* Font Awesome icon integration
* Creator badge

---

## Browser Compatibility

Supported browsers:

* Google Chrome
* Brave Browser
* Microsoft Edge
* Mozilla Firefox

---

# Feature Statistics

| Category              | Count |
| --------------------- | ----- |
| Collection Management | 10+   |
| Tab Management        | 15+   |
| Auto Save & Recovery  | 10+   |
| Search & Sort         | 13+   |
| Import & Export       | 6+    |
| UI & UX               | 15+   |
| Performance Features  | 5+    |
| Integration Features  | 5+    |

## Estimated Total Features

**80 to 90 implemented features**

---

# Planned Advanced Features

## Cloud Sync ☁️

Synchronize collections across multiple devices.

### Example Flow

```text
Laptop A
↓
Create collection
↓
Automatically upload to Google Drive (appDataFolder)
↓
Laptop B logs in
↓
Restore from Google Drive
```

Implemented backend:

* Google Drive API via Chrome Identity (drive.appdata scope)
* Manual backup / restore buttons
* Daily auto-backup via Chrome Alarms
* Secure, isolated `appDataFolder` — other apps cannot access your data

---

## Tagging System 🏷️

Assign labels to collections.

### Example

```text
Java Resources
#study #java #backend

Shopping
#buy #wishlist
```

Allows:

* Tag filtering
* Tag searching
* Smart grouping

---

## Folder Hierarchy 📁 ✅ Implemented

Organize collections inside folders (one level deep).

### Example

```text
Study
├── Java
├── DSA
└── AI

Work
├── Meetings
└── Research
```

### Implemented

* Create, rename and delete folders
* Expand / collapse folders (state persists)
* Nested rendering — a folder's collections live inside its body
* Per-folder tab count and collection count
* Drag collections into a folder, and back out to the root
* Move to folder from the collection menu (and remove from folder)
* Deleting a folder confirms first, then removes the collections inside it with it
* Folder hierarchy travels with global export/import and Google Drive backup
* Dangling folder references are dropped on load (a collection can never be orphaned)
* Migration-safe storage: `schemaVersion` + a `folders` array applied by a versioned migration

---

## Color Labels 🎨 ✅ Implemented

Label folders and collections with a color, then filter the list by color. A color is a **shared
grouping key**: the same color can label any number of folders and any number of collections, and
filtering on it brings every one of them together — including a collection whose folder is not
itself labeled.

### Implemented

* Ten built-in colors (red, orange, amber, green, teal, blue, indigo, purple, pink, gray), always
  available and fixed — they can be used but not renamed or removed
* Add your own custom colors (name + picker) from **Settings → Color Labels**, up to 40 of them
* Create a custom color **straight from a folder's or collection's options menu** — a “+” swatch
  opens a color well and a name, and confirming both adds it to the palette and labels that item in
  a single write, so no trip to Settings is needed
* Assign a color from a folder's or collection's options menu, or clear it with the “no color”
  swatch
* A small color dot in a labelled folder's or collection's header
* A **Color** filter in the controls bar — multi-select, so several colors can be shown at once,
  plus a “No color” option for unlabelled items
* Multi-select filtering is a union: it shows folders by their own color and collections by their
  own color, promoting a matching collection out of a folder the filter hid so a color never loses a
  member; a “no matches” message appears when nothing matches
* A **Color** option in the Collections sort menu that groups the list into colour sections — every
  folder and collection sharing a colour sits together (a collection whose folder carries a
  different colour is promoted into its own colour's section), with the unlabelled items last
* Labels and the custom palette travel through global export/import and the Google Drive backup; a
  label whose colour a file does not carry is dropped rather than trusted, and a re-import never
  duplicates a colour
* Removing a custom color unlabels everything that used it (no dangling references)
* Migration-safe storage: `color` on folders/collections and a `customColors` palette, applied by
  `schemaVersion: 3`

---

## Collection Sharing 👥

Share collections with others.

### Example Flow

```text
Click Share
↓
Generate Link
↓
Send to Friend
↓
Friend Imports Collection
```

---

## Keyboard Shortcuts ⌨️ ✅ Implemented

Quick actions without touching the mouse.

### Implemented Shortcuts

* Ctrl + F → Search
* Ctrl + N → New Collection
* Ctrl + E → Expand All (toggle expand/collapse all collections)
* Ctrl + Shift + E → Expand Current Session only
* Ctrl + D → Toggle list / grid view
* 1 – 9 → Jump to the Nth collection
* ? → Open keyboard shortcuts help overlay
* Esc → Close Modal / Slide / Dropdown
* X → Close Panel

---

## Notes Per Collection 📝

Attach notes or reminders to collections.

### Example

```text
System Design

Watch:
- Load Balancer
- Redis
- Kafka
```

---

## Automatic Cleanup Rules 🧹

Self-maintaining collections.

### Examples

* Remove duplicate URLs
* Archive inactive collections
* Delete expired tabs
* Auto-clean old sessions

---

## Pinned Collections 📌

Collections stay permanently at the top.

### Example

```text
📌 Work
📌 Study
📌 Daily

Movies
Shopping
Travel
```

---

## Archive Mode 📦

Soft delete collections instead of permanently removing them.

### Example

```text
Active
- Work
- Study

Archived
- College Notes
- Travel 2024
```

---

## Statistics Dashboard 📊

Insights into browsing habits.

### Examples

* Total collections
* Total tabs
* Average tabs per collection
* Largest collection
* Most visited domains
* Collection growth over time

Example:

```text
Collections: 42
Tabs: 1,284
Largest Collection: Work (212 tabs)
Top Domain: github.com
```

---

# Roadmap Recommendation

Recommended implementation order:

1. Pinned Collections ✅
2. Notes Per Collection
3. Archive Mode
4. Statistics Dashboard
5. Keyboard Shortcuts ✅
6. Tagging System
7. Automatic Cleanup Rules
8. Folder Hierarchy ✅
9. Collection Sharing
10. Cloud Sync

---

# Missing Features vs Ta Box (Tabox 4.2.2)

Gap analysis against the Ta Box (Tabox) extension build
(`ta box tab collection manager extension.zip`, Chrome Web Store build, v4.2.2).
Everything already implemented in this extension is NOT listed here.

Legend: 🔴 major · 🟡 medium · ⚪ minor · Status: ✅ implemented · 🔶 partial · ❌ not implemented

---

## 🔴 Major missing features

### 1. Folder hierarchy for collections — ✅ Implemented
* **Ta Box:** real folders (`folders_index`, `parentId` on collections), folder colors,
  collapse state, drag collections in/out of folders, per-folder tab counts.
* **Us:** implemented — a frozen `folders` array plus a per-collection `folderId` (one level
  deep); `FolderSection` renders a folder header (expand/collapse, inline rename, tab +
  collection counts, options menu) with its collections nested in `.folder-body`; root
  collections stay direct children of the list. Drag a collection onto a folder to move it
  in, drop it on another collection to adopt that collection's folder, or drop it on the
  root drop zone (shown only while a nested collection is dragged) to move it back out.
  Create via the controls bar, rename/delete from the folder menu; deleting asks once and then
  removes the collections inside the folder with it. Folders ride along in global
  export/import and the Google Drive backup; a dangling `folderId` is dropped on load.
* **Migration-safe:** the persisted shape moved to `schemaVersion: 1` through a versioned
  migration (`src/store/migrations/`), so an existing profile upgrades in place.
* **Colors:** folder colors are implemented — see **Color Labels** below.

### 2. Chrome Tab Groups capture & restore — ✅ Implemented
* **Ta Box:** stores `chromeGroups` metadata (group name, color, collapsed, pinned) with
  each collection and rebuilds actual Chrome tab groups on restore via `chrome.tabGroups`.
* **Us:** implemented — `"tabGroups"` permission added to the manifest; autosave and the
  "Add tabs" modal record each tab's `chromeGroupId` plus a collection-level
  `chromeGroups` map (`title` / `color` / `collapsed`); `restoreSession()` (and the popup
  fallback path) rebuild the groups via `chrome.tabs.group()` + `chrome.tabGroups.update()`.
* **Notes:** pinned tabs are skipped when grouping (Chrome cannot group them); groups
  whose metadata was lost are restored as ungrouped tabs.
* **Every restore path:** a saved tab references its group by number, so the snapshot has to
  carry the map that id resolves against. Session snapshots (`lastSessionBackup`, each
  `sessionHistory` entry) and the export/import payload now store `chromeGroups` with their
  tabs, and the history dialog's Open All goes through the worker like the other restores,
  so groups come back from a collection, a restore point, a history entry, a JSON backup
  and a Google Drive backup — not only from a live collection.

### 3. Sharing & collaboration (requires a backend) — ❌ Not implemented
* **Ta Box (Pro, server-backed):** shared folders with members and roles
  (owner / read / write), email invites with notification, public share links for single
  collections and whole folders, join-by-link (sign-in-deferred), leave/unshare, member
  role changes, activity feed (who changed what), and per-folder comments.
* **Us:** roadmap idea only. Needs server infrastructure (Ta Box uses a Cloudflare
  Worker API) — decide before investing.

### 4. AI assistant (5 tools, server LLM) — ❌ Not implemented
* **Ta Box (Pro):** server-side LLM (`/ai/complete`, JSON-schema-constrained):
  1. **Smart organize** – cluster a window's ungrouped tabs into named + colored Chrome tab groups
  2. **Auto-arrange** – file collections into folders (creates/suggests folders)
  3. **Batch rename** – suggest names for up to 10 unnamed collections at once
  4. **Split collection** – split one collection into 2–4 themed sub-collections, with undo
  5. **Duplicate sweep** – duplicate URL groups across collections with recommended
     keep-one / dedupe-within / extract-to-new-collection / discard-all actions,
     plus undo history and empty-collection cleanup
* **Us:** none. Even without an LLM, the **duplicate sweep + undo** workflow is worth
  building deterministically (we only warn before insert today).

### 5. True multi-device cloud sync (merge, not just backup) — ❌ Not implemented
* **Ta Box:** incremental sync engine with snapshot **merge and conflict resolution**
  (`lastUpdated`-wins per entity), **deletion tombstones** so deletes propagate,
  pre-sync safety backups, version recovery, refresh tokens, sync lock,
  storage/sync version migration.
* **Us:** one-way Drive backup + manual restore; two machines overwrite each other.
* **To build:** per-entity `lastUpdated` timestamps, tombstone list, merge function on
  restore, keep multiple Drive file versions.

### 6. Recently closed restore (`chrome.sessions`) — ❌ Not implemented
* **Ta Box:** `sessions.getRecentlyClosed` / `sessions.restore` / `sessions.onChanged`
  to restore recently closed tabs and windows.
* **Us:** permission not declared; no UI.
* **To build:** add `"sessions"` permission; a "Recently closed" section/slide in the
  panel with one-click restore of tabs or windows.

---

## 🟡 Medium gaps

### 7. Global keyboard commands (`chrome.commands`) — ❌ Not implemented
* Ta Box binds **Ctrl+Shift+1..4** to open the 1st–4th collection from anywhere in the
  browser via manifest `commands` + background handler.
* Our shortcuts only work while the side panel has focus.

### 8. Sleep/deferred tabs (placeholder page restore) — ❌ Not implemented
* Ta Box's `deferedLoading.html`: restores tabs as tiny placeholder pages showing
  favicon + "(click to load)", navigating to the real URL only on focus/click.
* Complements (not replaces) our discard-based RAM Saver.

### 9. Incognito support — ❌ Not implemented
* Ta Box: `"incognito": "spanning"` in manifest + explicit incognito handling in the
  background worker (tabs saved from incognito windows tracked separately).
* Us: incognito windows are silently ignored/untracked.

### 10. Multi-window / monitor-aware restore — 🔶 Partial
* Ta Box requests `system.display` and stores window bounds metadata so collections
  reopen into correctly positioned windows across monitors.
* Us: tab `windowId` is saved and windows are grouped on restore, but window
  position/size and monitor info are not.

### 11. Push notifications for shared events — ❌ Not implemented
* Ta Box: web-push subscription via VAPID + optional `notifications` permission —
  live pings when shared collections change; invite notifications.

### 12. Full-page manager view — ❌ Not implemented
* Ta Box ships `fullpage.html` — the entire manager in a normal browser tab for when
  the side panel is too cramped.

---

## ⚪ Minor gaps / quality-of-life

13. **Per-collection colors** (color picker, used in UI accents) — ✅ Implemented as **Color Labels** (folders and collections, ten built-ins plus custom colors, with a color filter)
14. **Favorites with custom favorite order** (`isFavorite`, `favoriteOrder`) — 🔶 Partial (pinning covers the main use case; no separate favorites order)
15. **`lastOpened` tracking per collection** — enables "recently opened" sort — ❌ Not implemented
16. **`unlimitedStorage` permission** — ❌ Not implemented (we cap collections at 200 tabs; Ta Box doesn't cap)
17. **Storage versioning + data validation & migration** (`storageVersion`, `syncVersion`) — 🔶 Partial (a `schemaVersion` key and a versioned migration runner (`src/store/migrations/`) now upgrade an existing profile in place; still no sync-versioning and validation is limited to `normalizeState`)
18. **Cross-browser support reality check** — ❌ Chrome-only (Ta Box bundles `browser-polyfill.min.js`; we claim Firefox support but our MV3 manifest has no `sidebar_action` and uses Chrome-only APIs (sidePanel))

---

## Suggested priority (local-only features first, no backend needed)

1. Chrome tab groups capture & restore — ✅ Done
2. Folder hierarchy — ✅ Done
2b. Color labels + color filter — ✅ Done
3. Recently closed restore — small effort, uses one new permission
4. Duplicate sweep + undo — builds on our existing duplicate detection
5. Global keyboard commands (Ctrl+Shift+1..4) — small effort
6. Sleep/deferred tab restore — medium effort, UX win for big restores
7. Two-way Drive sync with merge & tombstones — large effort, no backend required
8. Incognito + window-bounds metadata — polish

Backend-dependent (decide first): sharing & collaboration, AI tools, push notifications.
