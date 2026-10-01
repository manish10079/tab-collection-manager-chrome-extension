# ADR-0007: The panel shell is React, and the legacy boot script is all that remains

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §7 and §8, Phase 5.2 ("Shell chrome → React")
- Supersedes: — (completes the reverse seam ADR-0002 introduced with `src/app/legacy-handle.js`)

## Context

After ADR-0006 the collection list, every dialog and every collection action were React-owned, but
the panel itself was still two half-worlds glued together:

- **Markup ownership was split.** `popup.html` held the header, the controls bar, the two input
  slides, the collections sort dropdown and the search-results container. React rendered only into
  `#collectionsContainer`, a sibling of the controls, so the layout existed in one place and the
  code that drove it in another.
- **Wiring was split.** `setupEventListeners()` bound all of it, and the global `keydown` handler
  toggled slides and dropdowns by class name. Each React feature that needed a shell interaction
  (the settings button, the history button, the `?` shortcut) reached back through
  `window.__tcmReact`, a reverse seam with its own registration dance.
- **Search was a string builder.** `filterResults()` fetched state, built four template strings and
  wrote them with `innerHTML`, then re-queried the DOM to attach listeners — the exact pattern the
  migration exists to remove.
- **Two DOM owners, one tree.** The controls bar's slides hid/showed the collection list by
  `style.display`, so React re-renders and legacy class toggles had to agree about who was visible.

## Decision

- **React owns the whole panel, through one root.** `popup.html` shrinks to `.container > #appRoot`
  plus the boot script. `main.jsx` mounts once into `#appRoot`; the header, controls bar, search
  results and collection list are all JSX.
- **A new `src/features/shell` feature owns the chrome**: `AppHeader`, `ControlsBar` (with
  `SearchSlide`, `CreateSlide`, `SortMenu`), `GlobalSearchResults`, and the hooks
  `useShellController`, `useGlobalSearch`, `useGlobalShortcuts`, `useManifestInfo`.
- **One controller holds the shell's UI state and actions.** `useShellController({ toast })` owns
  which slide is open, the query and the create draft, and every action the bar triggers — create
  collection, sort, layout, import, export, restore backup, expand all, Current Session only, jump,
  close panel. Data changes go through the store's `mutate()`; refusals are toasts, never `alert()`.
  It is a plain object, so `ControlsBar` and the shortcuts hook take it as a prop instead of each
  re-deriving state.
- **Search is data, not HTML.** `lib/globalSearch.js` returns the name matches and tab groups plus
  `highlightSegments`, and `GlobalSearchResults` renders them as elements. `useGlobalSearch` derives
  the matches from the store, so it re-computes on a store change instead of re-reading storage.
- **The keyboard shortcuts move to `useGlobalShortcuts`**, bound to `document` once, reading the
  controller from a ref so the listener never re-registers. Escape still defers to an open dialog
  (`isAnyModalOpen`) before closing a slide.
- **The reverse seam is deleted.** `src/app/legacy-handle.js` (`window.__tcmReact`) and
  `src/app/hooks/useContainerClasses.js` are gone; `App` sets the collections container's
  grid/sort classes in JSX. `tests/legacy-state-contract.test.js` now asserts `__tcmReact` cannot
  come back.
- **A shared `downloadJson` and `createCollection`.** The export helper `useCollectionActions` had
  inline moved to `lib/download.js` (both export paths use it), and creating a collection from the
  create slide reuses the pure `createCollection` mutator in `collectionAdmin.js`. `useDismissable`
  moved to `app/hooks` because the sort menu and the collection/tab menus both need it.
- **`popup.js` keeps only the boot sequence**: apply the persisted theme before React's first paint,
  send the worker `forceAutoSave` and re-read, then normalise the opened state (collapse all,
  backfill `addedAt`, drop a stale Auto-Save id) through the same write queue. It is 99 lines and
  disappears in Phase 5.3.

## Consequences

- `popup.html` is 18 lines with a single id; `popup.js` is 99 lines. `scripts/build.mjs` now asserts
  the legacy header, controls bar, slides and containers are absent from the composed page rather
  than preserved.
- The only remaining legacy-to-React dependency is the state bridge (`window.__tcmStore`), which is
  the boot script's whole reason to exist.
- The stylesheet is untouched: the React markup reuses the legacy class names, and the one new
  `.sort-collections-container` in `shell.css` exists only so the sort dropdown can close on an
  outside click while anchoring exactly where the legacy nested markup anchored it.
- Layout, search and shortcut behaviour is now testable with RTL: `ControlsBar.test.jsx` covers the
  slides, layout toggle, restore button and sort menu, `App.test.jsx` covers the header, search
  results flow and layout classes, and `globalSearch`/`globalBackup`/`useShellController` are unit
  tested (177 tests over 23 files).
- A collection jump or a search-result open scrolls the list via a guarded `scrollIntoView`, so the
  behaviour no longer depends on a browser layout engine being present.
- No storage key, message command, manifest entry or `background.js` line changes.

## Alternatives considered

- **Keep each legacy region and port it separately** (header, then controls, then search). Rejected:
  the regions share one controller (a slide hides the others, shortcuts drive all of them), so the
  partial states would have needed more seam code than the port removed.
- **Two React roots** (one for the shell, one for the list). Rejected: two roots mean two providers
  and two subscription trees over the same store, and the `ToastProvider` would have to be
  duplicated or hoisted anyway.
- **Keep `filterResults()` and mount React only into the results container.** Rejected: it leaves
  the string builder and its `innerHTML` writes, which is one of the migration's stated goals.
- **Keep `window.__tcmReact` for the shortcuts.** Rejected: the shortcuts are controls-bar
  behaviour, and every command they needed is on the controller; the seam had no remaining job.
- **Move the boot sequence into React too** (`useEffect` for theme, auto-save, normalisation).
  Deferred to Phase 5.3, when `popup.html` itself stops being composed; until then a synchronous
  boot script is what guarantees the theme is applied before the first paint.
