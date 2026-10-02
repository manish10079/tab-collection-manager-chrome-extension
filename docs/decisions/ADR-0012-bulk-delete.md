# ADR-0012: Bulk deletion, selected across both sections

- Status: accepted
- Date: 2026-10-02
- Context: `feature_list.md` (folder hierarchy, follow-up), `react-migration-plan.md` changelog 1.17.3,
  `skill.md` §4 (modularity) and §7 (versioning)
- Supersedes: ADR-0011's "Deleting a folder keeps its collections"

## Context

Folders landed in 1.17.0 with one deletion at a time: a collection from its card menu, a folder from
the folder menu. That is fine for one item and tedious for ten — clearing out a stale set meant ten
menus and ten confirmations, and the folders and collections being managed sit in two different
sections of the same list.

Two questions had to be answered before writing code, because both are user-visible and hard to
change later:

1. **How does the user select?** The list is a dense card view where a long-press or a modifier-click
   is undiscoverable, and the drag handles already own the pointer gestures on each card.
2. **What does deleting a folder mean now?** ADR-0011 chose "keep the collections, re-root them".
   With a multi-select that also removes collections directly, a folder that spares its contents
   becomes the one selection whose size is not what it looks like.

## Decision

### An explicit Select mode, not modifier-click

- A **Select** toggle in the controls bar (`#toggleSelectBtn`) swaps the default actions row for a
  selection bar: a live `N selected` count, **Delete selected** (disabled at zero) and a cancel that
  clears the selection. Leaving the mode clears it too.
- Each folder and collection then shows a checkbox. Current Session's is **disabled** rather than
  hidden, so the rule ("it is a live mirror, never deletable") is visible instead of guessed at.
- Rejected: `Ctrl`/`Cmd`-click, which is invisible on touch and conflicts with the header's
  click-to-expand; and per-section select-all bars, which double the surface for one gesture.

### The composition root owns the selection

- `App` holds the mode and the two id sets, because the state is shared by two features — the
  controls-bar toggle and the checkboxes that live on the collections list — and neither may import
  the other (`skill.md` §2.1). `CollectionList` passes the sets down to `CollectionCard` and
  `FolderSection`, which stay presentational and merely report `onToggleSelect(kind, id)`.
- Ids are kept in two sets rather than one tagged set: a folder and a collection are looked up in
  different arrays, and a shared id space would only invite a false positive.

### The deletion rules are pure functions

- `src/features/collections/lib/bulkDelete.js` holds the whole decision: `summarizeSelection` counts
  what a selection would remove (folding in the collections a selected folder takes with it and
  excluding Current Session), `describeSelection` renders that count into the one confirmation, and
  `deleteSelection` mutates a draft. `useCollectionActions.deleteMany` is only the wiring: hydrate,
  summarize, confirm, mutate, toast, `false` on cancel so the caller keeps the selection.
- All three are dependency-free and unit-tested without a store or a DOM, which is what makes the
  cascade rule and the Current Session guard cheap to pin down.

### Deleting a folder cascades, behind a prompt

- `deleteFolder` now removes the folder **and the collections inside it**, and clears Auto-Save when
  its target was one of them. This reverses ADR-0011.
- The reason is the prompt, not convenience: with several items selected at once, a confirmation can
  only be honest if it names the real total, and a folder that spared its contents would make the
  count wrong. One confirmation for the whole selection, whose wording includes "Collections inside
  a deleted folder are deleted too", replaces a per-item prompt. The user sees exactly what is
  about to go before anything is.
- The trade-off is explicit: the old rule was reversible and the new one is not. That is acceptable
  because the action is deliberate, singular, and pre-announced — and because a folder is a
  container the user asked to remove, not a view over shared contents.

## Consequences

- The storage contract is unchanged: `schemaVersion` stays `1` and no message command moved, because
  the selection and the mode are UI state that never persist. Nothing to migrate, nothing to shim.
- The suite grew 282 → 297 tests in 36 files (`bulkDelete`, `deleteMany` including the cancel and
  empty-selection paths, the folder cascade, and the list's selection mode) and 11 Playwright specs
  pass; the E2E walks all three kinds of selection at once — a folder, a collection nested inside a
  different folder, and a root collection — accepts the real `window.confirm`, and asserts storage
  kept the unselected folder while losing everything else it named.
- Every document that recorded the old rule was updated with it: `feature_list.md`,
  `missing_features.md`, `README.md` and ADR-0011 (marked superseded), plus the plan changelog.
- The single source of the confirmation text is `describeSelection`, so the count in the prompt and
  the count of things removed cannot drift apart.
- Still open: selecting everything with one control, and an undo. Both are natural follow-ups and
  neither needs a storage change.

## Alternatives considered

- **A separate bulk-delete dialog listing every selected item.** Rejected: the live card list and a
  `N selected` count already show the selection; a modal that repeats it is one more thing to learn
  and to maintain.
- **Deleting on each checkbox, with an undo toast.** Rejected: silent, per-item destruction is worse
  than one deliberate confirmation, and undo would need a trash store — a new persisted shape.
- **Persisting the selection (or the mode) in storage.** Rejected: it would add a settings key and
  therefore a migration and a `schemaVersion` bump (`skill.md` §7.1) for state that should not
  survive a reload.
- **Keeping ADR-0011's non-cascading folder delete.** Rejected: it makes the selection's total
  misleading, which is the one thing a destructive confirmation must never be.
