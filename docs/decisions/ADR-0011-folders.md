# ADR-0011: Folder hierarchy, applied through a versioned migration

- Status: accepted
- Date: 2026-10-02
- Context: `react-migration-plan.md` §8, Phase 8 ("Folder hierarchy"), and `skill.md` §2.3 / §7.1

## Context

Folders were the oldest unimplemented item on the roadmap (`feature_list.md`,
`missing_features.md`: "flat list only"). The migration's central guarantee up to this point was
that no storage key or shape moved — the UI was rebuilt around a frozen contract. Adding folders is
the first change that genuinely extends that contract, so it is also the first real test of the
storage-versioning rule `skill.md` §7.1 lays down: a shape change ships with a migration and a
`schemaVersion` bump in the same commit.

Two constraints shaped the design:

- **Migration safety.** Existing profiles are a flat `collections` array with no `folders` and no
  `schemaVersion`. They must upgrade in place, and a collection that points at a folder that no
  longer exists must never disappear from the list.
- **The React rendering seam.** `#collectionsContainer > .collection` is load-bearing: the
  `1`–`9` keyboard jump queries it directly, and the E2E helpers resolve a card by reading
  `#collectionsContainer input.collection-name`. Nested rendering must not break that shape for
  root collections.

## Decision

### One level deep, `folderId` on the collection

- Folders are a top-level `folders` array; a collection points at one through a `folderId` field
  (string or `null`). No folder nests inside another — the roadmap and Ta Box both stop at one
  level, and it keeps the render and the migration trivial.
- `folderId` lives on the collection rather than the folder holding a list of ids, so moving a
  collection is a single-field write and a delete cannot leave a dangling membership.
- Current Session is never a folder member: it is a live mirror that always sits first at the root.

### Migrate in `hydrate`, not on demand

- `src/store/migrations/0001-folders.js` exports a dependency-free, idempotent `up(data)` that adds
  `folders: []` and pins every `folderId`; `src/store/migrations/index.js` holds the ordered list
  and returns `{ data, from, changed }`.
- `store.js` runs the runner at the top of `hydrate()`, before `normalizeState`, and writes the
  migrated snapshot back once (with a log) when anything changed. `schemaVersion` and `folders`
  joined the frozen `STORAGE_KEYS` and `toPersistedKeys`.
- `normalizeState` is the safety net: it normalizes the folder records, coerces a non-string
  `folderId` to `null`, and drops any `folderId` whose folder is absent. A half-applied edit, a
  hand-edited profile, or an imported backup missing folders therefore degrades to a root
  collection rather than an invisible one.

### Keep root collections as direct children

- `CollectionList` renders root collections first, then a `FolderSection` per folder. A folder's
  collections live inside its own `.folder-body`; the folder element is `.folder[data-folder-id]`.
  So the keyboard jump and the E2E helpers keep seeing exactly the root `.collection` elements they
  did before, and the pure split lives in `src/lib/folders.js` (`groupCollections`), reusing the
  same sort mode for both levels.
- Membership changes through three routes: dropping a collection on a folder section, the card's
  "Move to folder" menu, and a root drop zone that is rendered **only** while a collection that
  already lives in a folder is being dragged (so the everyday list has no extra row). Dropping a
  collection on another collection reorders it and adopts the target's folder, which is how the
  existing reorder gesture keeps working across folders.

### Deleting a folder keeps its collections

- `deleteFolder` deletes only the container and re-roots its collections; it never deletes what it
  held. That is the least-surprising rule and it is unit-tested.
- Folders travel with backups: the global export/import payload gained a `folders` field (a legacy
  file without it still imports, as all-root) and the Drive backup/restore carries them too.

## Consequences

- Existing profiles upgrade silently on first hydration and gain a `schemaVersion: 1` stamp; a
  pre-folders profile is covered by `src/store/__tests__/migrations.test.js`.
- The suite grew 266 → 279 tests in 35 files (migration, `groupCollections`, `folderDraft`,
  `FolderSection`, a `CollectionList` grouped-render + drag integration test, and the export/import
  round trip); the 7 E2E specs still pass and the size budget stays green.
- `skill.md` §2.3's storage contract gains a `folders` row and notes the per-collection `folderId`
  (document version 2.3.0).
- Folder colors are deliberately not built; the feature is the hierarchy, not a styling system.

## Alternatives considered

- **A folder holds an ordered list of collection ids.** Rejected: more invariants to keep in sync
  (reorder, delete, merge) for no gain at one level.
- **Nest folders arbitrarily.** Rejected: the roadmap asks for one level, and recursion multiplies
  the render, drag and migration work for a use case nobody asked for.
- **Migrate lazily per collection / on first folder use.** Rejected: hydration is the one place that
  already reads and writes the whole snapshot, and a one-shot write there is simpler to reason about
  and to test than scattered guards.
- **Render folders as a separate container element.** Rejected: extras and indentation are cosmetic;
  keeping root `.collection` elements as direct children preserves the keyboard jump and the E2E
  selectors for free.
- **Deleting a folder deletes its collections.** Rejected: destructive and surprising; re-rooting is
  reversible and matches "a container must never delete what it contained".
