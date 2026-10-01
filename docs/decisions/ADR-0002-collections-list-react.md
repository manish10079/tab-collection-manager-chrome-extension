# ADR-0002: The collections list is React-owned, actions stay behind a seam

- Status: accepted
- Date: 2026-10-01
- Amended: 2026-10-01 — the deferred drag & drop landed in Phase 3
  (`docs/decisions/ADR-0003-drag-and-drop-hooks.md`): the legacy `reorderCollections` /
  `moveTabToCollection*` helpers were deleted from `popup.js`, so the decision bullet below
  describes the Phase 2 state only.
- Context: `react-migration-plan.md` §8, Phase 2 ("read-only rendering")
- Supersedes: —

## Context

Phase 2 moves `renderCollections` / `renderCollection` / `renderTabs` / `renderTab` — the
template-cloning renderers in `popup.js` — to React. Two things make that harder than a
straight rewrite:

1. Every card action (pin, rename, delete, import/export, open all, per-tab menus) was wired
   by attaching listeners *inside* the renderers, so deleting the renderers also deletes the
   behaviour unless something replaces it.
2. The grid-view modal used to **move** a rendered `.collection-tabs` node between the card
   and `#viewCollectionModal`. React cannot survive having a node it owns moved out of its
   tree, and the expand/collapse animation depends on the same node.

Phase 3 is where interactions are scheduled, but the plan also requires the extension to stay
working at every commit, so the list could not be left inert for a phase.

## Decision

- **React owns the list.** `src/features/collections` renders into the legacy
  `#collectionsContainer`, reusing the legacy class names so `popup.css` needs no change.
  The two classes React cannot set through JSX (`grid-view`, `sort-active`, which live on the
  mount element itself) are applied by `useContainerClasses`, a shell hook in `app/`.
- **Membership changes go through the store.** Expand/collapse and per-collection tab sort use
  the new serialized `mutate()` write queue, so they behave exactly like the legacy
  `updateState` and both UIs re-render from `storage.onChanged`.
- **A single, temporary seam replaces the old listener wiring.**
  `popup.js` publishes `window.TCMLegacyUI` for the actions it still owns, and the React side
  reaches it through `src/app/legacy-ui.js`, injected into `useCollectionActions` by `App`.
  For the reverse direction (a legacy call site driving React state) the app publishes
  `window.__tcmReact` from `src/app/legacy-handle.js`.
- **The grid-view modal is React-owned** (`GridCollectionModal`). Its open state *is* the
  collection's `isExpanded`, which removes the DOM-moving entirely.
- **Drag & drop stays legacy-until-Phase-3** *(superseded by ADR-0003)*: drag handles render,
  but reordering is not wired, and the legacy DnD handlers that lived in the renderers were
  deleted with them. `reorderCollections` / `moveTabToCollection*` remain in `popup.js` ready
  for the port.

## Consequences

- The list, its tabs, sorting, expansion and per-collection search are React; the controls
  bar, modals and the service worker are untouched.
- Two write queues exist for one storage contract: the store's `mutate()` (React) and the
  legacy `updateQueue` in `popup.js`. Both do read-modify-write of the same key set, so a
  mutation from each UI in the same tick can lose one of them. The window is a single
  `chrome.storage.local.get` round trip and the risk is accepted until Phase 3 moves the
  remaining mutators into the store and the legacy queue disappears. *(Closed in Phase 3 —
  `updateQueue` is gone and every write goes through the store; see
  `docs/decisions/ADR-0004-single-write-queue.md`.)*
- Two seams exist (`legacy-ui.js`, `legacy-handle.js`). They are deliberately tiny, documented
  and must be deleted in Phase 5 together with `popup.js`.
- `README`/`docs` still describe `popup.js` as the UI renderer for everything else; Phase 5
  updates the prose.

## Alternatives considered

- **Read-only list with inert buttons** (literal Phase 2) — rejected: it would ship a visibly
  broken panel between phases, contradicting the plan's "functional at every commit" goal.
- **Keeping the legacy card listeners and re-attaching them to React-rendered nodes** —
  rejected: two owners for one DOM subtree, guaranteed drift.
- **Porting drag & drop in the same change** — deferred: it is Phase 3's main item and would
  double the size of this change for no Phase 2 acceptance benefit.
