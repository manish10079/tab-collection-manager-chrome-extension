# ADR-0003: Drag & drop is native HTML5 with a shared context, not a DnD library

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §7 ("keep native HTML5 DnD first"), Phase 3
- Supersedes: — (completes the item ADR-0002 deferred)

## Context

Phase 2 deleted the collection/tab renderers in `popup.js`, and the drag & drop handlers went
with them because they were attached per rendered node. Phase 3 has to bring reordering back,
now from React, with two levels of drag in one subtree:

1. A **collection card** dragged onto another card (reorder collections).
2. A **tab row** dragged onto another row (reorder within a collection) or onto a card or row
   of a different collection (move the tab, at a position).

Three constraints shaped the implementation:

- **Nothing may regress in the vanilla UI.** `popup.js` still renders the controls bar, the
  modals and the service-worker-backed features, so the DnD behaviour had to move to code both
  UIs can rely on — the pure mutators in `collectionDraft.js` behind the store's write queue.
- **Text selection has to keep working.** The legacy UI made the whole card non-draggable and
  armed the drag from a dedicated handle; an editable collection name or tab title must stay
  selectable.
- **`dragover` cannot read `dataTransfer`.** A drop target cannot inspect the payload mid-drag
  through the native API, yet a card must know whether the tab hovering over it comes from its
  own collection (reorder) or another one (move). The information has to be shared out of band.

## Decision

- **Native HTML5 drag events, no DnD dependency.** `draggable`, `dragstart`, `dragover`, `drop`
  and `dragend` are wired directly. Nothing was added to `package.json`.
- **Two small hooks plus one context.**
  - `DragAndDropContext.jsx` holds the item currently being dragged
    (`{type: 'collection' | 'tab', id, sourceCollectionId?}`). Outside a provider the hook
    returns a frozen no-op, so a card can be rendered alone in a component test.
  - `useDraggable(payload)` returns `{isDragging, dragProps, handleProps}`. The card/row keeps
    `draggable={armed}` and the handle's `onPointerDown` arms it, preserving the legacy
    "grab the handle" gesture and keeping inputs selectable.
  - `useDropZone({accepts, onDrop})` returns `{isDragOver, dropProps}`. `accepts` runs on every
    event (not once), because a card's answer depends on the payload being dragged.
- **Handlers stop propagation deliberately.** A tab row lives inside a card, so the row's drag
  start and drop both stop propagation; otherwise the card would drag or accept the same
  gesture.
- **Refusals are data, not alerts.** The mutators return `{moved: false, message?}`.
  `useCollectionActions` toasts the message and stays silent when a refusal needs no
  explanation (same-collection, unknown ids). The legacy `alert()` calls are gone.
- **Verification is DOM-level.** `dragAndDrop.test.jsx` fires the real drag sequence through a
  provider and asserts which action each gesture resolves to; `useCollectionActions.test.js`
  runs the actions against the real store and write queue, including the 200-tab refusal.

## Consequences

- Zero new runtime dependencies; the drag code is ~120 lines across three files.
- The payload lives in React state, so a drop target can only see drags started in the same
  React tree. That is exactly the scope of the extension's own list; dragging from other
  browser surfaces (files, text, other tabs) is neither accepted nor affected.
- `dragstart` sets a private MIME type (`application/x-tcm-item`) rather than `text/plain`.
  Some browsers cancel a drag with no data at all, but a text payload would be pasted into
  the search box, a collection name or a tab title if the drag ended on one of them.
- The hooks do not implement features the legacy UI never had: no auto-scroll while dragging,
  no drop indicator lines, no keyboard reordering. Arrow-key reordering is a Phase 5 a11y
  candidate, tracked in `missing_features.md`.
- `drag-over`/`dragging` classes reuse the existing stylesheet, so no CSS was written.
- If parity problems appear later, `useDraggable`/`useDropZone` are the only seam to replace;
  the mutators and their tests survive a switch to `dnd-kit`.

## Alternatives considered

- **`dnd-kit` (or any library).** Rejected: it would add a dependency and its own abstractions
  for a feature the platform provides, and the legacy behaviour had to be matched precisely
  (custom-sort forcing, pin-limit demotion, positional insert).
- **A module-scoped "currently dragged" variable instead of context.** Rejected: it works, but
  the payload never triggers a re-render and the drop-target highlight would be stale; context
  is also the documented React answer for cross-depth state.
- **Reading the payload from `dataTransfer` in `dragover`.** Rejected: the value is only
  readable in `drop`, too late to decide whether a target should highlight.
- **Custom pointer-event dragging (no native DnD).** Rejected for this phase: more code, and
  it would have to re-implement the browser's drag image and autoscroll.
