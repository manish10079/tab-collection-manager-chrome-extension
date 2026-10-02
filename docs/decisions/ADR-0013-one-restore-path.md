# ADR-0013: One restore implementation, and the snapshots that feed it

- Status: accepted
- Date: 2026-10-02
- Context: `background/restore.js`, `background/autosave.js`, `src/features/dialogs/`,
  `src/features/shell/lib/globalBackup.js`, and `skill.md` §2.2 (runtime surfaces) / §7.1 (migrations)

## Context

Chrome tab groups were captured faithfully and restored faithfully — from exactly one of the five
ways a session can come back. The other four opened a flat list of pages, so a user could save a
window full of grouped tabs, restore it from a backup, and silently lose the grouping.

The cause was a split implementation. `background/restore.js` owns `restoreSession`, which rebuilds
groups via `chrome.tabs.group()` + `chrome.tabGroups.update()`. Three callers went through it (a
collection's Open All Tabs, Restore Previous Session, Drive restore), but two did not:

- The **history dialog's Open All** created its tabs from the panel with `chrome.tabs.create()`,
  which is why it could not group them.
- The **export/import payload** carried `chromeGroups` and each tab's `chromeGroupId`, but the
  importer rebuilt every collection from a fresh literal that dropped both.

A second, quieter inconsistency sat underneath: a saved tab records its group **by number**
(`chromeGroupId`), and that number only resolves against the collection's own `chromeGroups` map.
The worker wrote the number onto every tab it saved, but the two snapshots it keeps —
`lastSessionBackup` and each `sessionHistory` entry — stored only the tabs. Both snapshots were
therefore internally inconsistent from the day they were written.

## Decision

### Restoring is the worker's job, for every path

- The history dialog hands its whole entry to the worker's `restoreSession` instead of creating
  tabs itself, so there is exactly one implementation of "put these tabs back, with their groups".
  `src/features/dialogs/lib/openSessionTabs.js` is deleted rather than extended.
- This is the surface boundary `skill.md` §2.2 already draws: the worker owns restore, the UI owns
  rendering and dispatch.
- Rejected: duplicating the group rebuild into the UI. Chrome-API code cannot be shared across the
  boundary — `src/lib/` may not touch `chrome.*` (§3.3) and the worker may not import `features/`
  (§2.1) — so a shared helper has no legal home, and the duplicate is how this bug happened.

### A snapshot carries the map its tabs reference

- `autosave.js` writes `chromeGroups` into `lastSessionBackup` and into each `sessionHistory` entry,
  beside the tabs it already stored.
- The importer carries a collection's `chromeGroups` and every tab's `chromeGroupId` through, on
  both the add and the merge path.
- On a merge the imported group ids are remapped: an identical group is **reused** (so a re-import
  is idempotent), and a differing one takes the next free integer (so an import can never overwrite
  a group the collection's existing tabs still point at). Group ids only have to be unique within a
  collection, which is what makes this safe.

### The snapshot shape change ships with a migration

- Both snapshot shapes changed — the `sessionHistory` element type and `lastSessionBackup` — so
  `schemaVersion` moves to **2** with `0002-session-groups.js`, per `skill.md` §7.1.
- The migration is additive in the strongest sense: a snapshot that predates it gains an empty
  `chromeGroups`, which is behaviour-identical to before (its tabs restore ungrouped). Nothing is
  lost, and a malformed map is replaced rather than trusted.
- Rejected: treating the change as "just a field" and skipping the bump. The rule is any change to a
  persisted shape, and the version is what lets a future reader trust the shape it is reading.

## Consequences

- Groups are rebuilt from a collection, a restore point, a history entry, a JSON import and a Drive
  backup. The one path with a documented gap left is an entry saved *before* this change: it has no
  map, so its tabs restore ungrouped — the migration makes that explicit rather than accidental.
- The restore-point semantics are now precise: `lastSessionBackup.chromeGroups` is the map belonging
  to the **preserved** tabs (the state about to be overwritten), not the freshly captured one. A test
  asserts both halves of that pairing, because it is easy to "fix" into an inconsistency.
- The suite grew 316 → 321 in 38 files, and a new Playwright spec restores a snapshot against real
  Chrome and asserts `chrome.tabGroups` reports the saved title and colour. Reverting the fix makes
  it fail with `Received array: []`, so the guard is real rather than nominal.
- `index` on an imported tab is now its position rather than a constant `0`. The field was stored
  metadata that nothing reads yet, which is exactly why it should not have been lying.
- Still open, and deliberately not fixed here: the Drive payload caps `sessionHistory` at 50 while
  the ring holds 100, so a Drive restore drops half of it. Separate defect, separate change.

## Alternatives considered

- **Give the UI its own group rebuild.** Rejected: duplication across an API boundary with no shared
  home, and the exact shape of the bug being fixed.
- **Have the worker return how many tabs it opened**, so the history toast could keep its count.
  Rejected: `restoreSession` is fire-and-forget and its response payload is part of the frozen
  message protocol (§2.3). The toast now names the tabs it asked for instead.
- **Store the group map on each tab** instead of a collection-level map. Rejected: it duplicates the
  same `{title,color,collapsed}` across every tab in the group and grows with the tab count.
- **Drop `chromeGroupId` from snapshots too**, making the "ungrouped restore" honest. Rejected: it
  throws away information the app can use the moment the map is present, and it would silently
  degrade snapshots taken by this version.
