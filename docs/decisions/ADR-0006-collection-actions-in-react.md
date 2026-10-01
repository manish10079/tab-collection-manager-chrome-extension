# ADR-0006: Collection actions live in React over pure draft mutators, and the action seam is deleted

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §7 and §8, Phase 5.1 ("Legacy actions → React")
- Supersedes: the action half of the temporary seam introduced in ADR-0002 (`src/app/legacy-ui.js`)

## Context

ADR-0002 left `src/app/legacy-ui.js` behind as a deliberate, temporary bridge: React rendered the
collection list, but nine actions that belong to a collection — create/rename/delete, tab edit and
remove, the two pin toggles, open-a-tab, open-all/restore, per-collection export — still lived in
`popup.js` as `window.TCMLegacyUI`. React reached them through a thin adapter so Phase 2 could ship
at every commit.

That seam had three costs by the time Phase 5 started:

- **Two owners of one state shape.** `popup.js` mutated a cloned snapshot and re-saved it while the
  store wrote the same keys through its queue (ADR-0004). The queue serialised writes, but the rules
  were written twice.
- **Rules were untestable.** The pin limits, the case-insensitive name uniqueness and the "empty
  title becomes Untitled" behaviour sat inside DOM-bound functions driven by `alert()`/`confirm()`.
- **Blocking UX.** A refused pin or a duplicate name interrupted the side panel with `alert()`.

Restore was the sharpest case: `openAllTabsInCollection` re-implemented what the service worker
already does behind the `restoreSession` message (a new window, Chrome tab groups, RAM Saver), so
the two paths could drift.

## Decision

- **The nine actions become calls on `useCollectionActions`.** Its signature is now
  `{ toast, addTabs, importTabs }`: the two handlers the app layer owns (they open dialogs) and the
  toast sink arrive by injection, and everything else is owned by the hook. `src/app/legacy-ui.js`
  is deleted; `popup.js` loses all nine functions and the whole `window.TCMLegacyUI` assignment.
- **The rules become pure store-draft mutators** in `src/features/collections/lib/collectionAdmin.js`:
  `normalizeName`, `isNameUnique`, `deleteCollection`, `renameCollection`, `removeTab`, `renameTab`,
  `toggleCollectionPin`, `toggleTabPin`. They take an `AppState` draft and return a verdict, never
  touch the DOM, and are unit-tested directly. `useCollectionActions` runs each through the store's
  `mutate()` and turns the verdict into a toast.
- **Refusals are values, not dialogs.** `renameCollection` returns
  `'renamed' | 'unchanged' | 'current-session' | 'empty' | 'too-long' | 'duplicate' | 'missing'`;
  the pin toggles return `{ changed, limitReached, limit }`. The hook maps each to a toast and keeps
  the card's draft on a refusal, so the blocking `alert()`s are gone. Destructive delete keeps a
  single `window.confirm`, matching the legacy prompt.
- **Restore is one message.** `openAllTabs` sends `{ command: 'restoreSession', collectionId }` to
  the unchanged worker and toasts the response. The duplicated open logic is deleted, so the worker
  stays the only owner of restore, tab groups and RAM Saver.
- **Cross-cutting helpers move to the library layer**: `lib/tabs.js` `discardWhenLoaded` (shared by
  `openTab` and the dialog restore path), `formatFileTimestamp` in `lib/format.js`, and
  `LIMITS.MAX_COLLECTION_NAME_LENGTH` in `shared/constants.js`. The `Collection` typedef's stray
  `isPinned` was corrected to the `pinned` that `lib/sort.js` actually reads.
- **The seam's absence is asserted.** `tests/legacy-state-contract.test.js` now fails if
  `window.TCMLegacyUI =` reappears. `window.__tcmReact` survives with only the shell bridges
  (`setCollectionExpanded`, `openSettings`, `openHistory`, `openShortcuts`, `toast`) until 5.2/5.3.

## Consequences

- `popup.js` drops ~315 lines (1,613 → 1,298) and its two CRUD-adjacent sections; the create-collection
  slide and the global import/export remain there, so `MAX_COLLECTION_NAME_LENGTH`, `isNameUnique`,
  `partitionCollections` and `partitionTabs` are still referenced and were left in place for 5.2/5.3.
- No storage key, message command, manifest entry or `background.js` line changes. The only contract
  touched is the now-absent internal `window.TCMLegacyUI`.
- A refused action can no longer block the panel; it reports through the toast queue (1.6.0).
- The pin-limit and duplicate-name rules are covered by `collectionAdmin.test.js`, and the actions
  against the real store and write queue by the extended `useCollectionActions.test.js`.
- The rule "the store's queue is the only writer" now holds for collection actions too, not just the
  settings toggles and drag & drop.

## Alternatives considered

- **Keep `legacy-ui.js` and move the actions one at a time.** Rejected: the seam is small and
  self-contained, and a partial move would leave two owners of the same rules for another phase.
- **Put the rules in the hook instead of a `lib/` module.** Rejected: the hook needs React and the
  store; the pin limits and the name rules deserve direct unit tests without a render.
- **Keep `alert()` to match the legacy UX exactly.** Rejected: the toast provider already exists and
  the plan's definition of done calls for non-blocking feedback.
- **Have the UI open the restored tabs itself** (as the legacy fallback did). Rejected: it duplicates
  the worker's restore path and would drift from tab-group and RAM-Saver handling.
