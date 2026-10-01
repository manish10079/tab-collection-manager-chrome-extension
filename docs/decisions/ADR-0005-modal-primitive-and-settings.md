# ADR-0005: One Modal primitive, and the settings modal as its first owner

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §5, §7 and §8, Phase 4 ("Modals & settings")
- Supersedes: —

## Context

Six modals live in `popup.html` (add-tabs, settings, duplicates, history, session details,
shortcuts help) plus the React grid-view collection modal. Every legacy one re-implements the same
lifecycle by hand: set `style.display = 'flex'`, a close button, an overlay-click handler, and an
entry in `MODAL_IDS` that the global Escape handler walks. The plan asks for the opposite — one
`Modal` primitive and a single portal root, with feature screens composing it.

The settings modal is the biggest of the six and the natural first consumer:

- It is the last place in `popup.js` that writes `chrome.storage.local` directly (the six settings
  writes and the two GDrive flags), which is the one remaining exception to ADR-0004's "one write
  queue" claim.
- Its `setupSettingsModal()` is ~300 lines of DOM wiring that duplicates the store's job.
- The keyboard-shortcut table it renders is static data, and the Limits section is the only place
  the pin-limit inputs live.

The GDrive flags are the awkward part: `gdriveBackupEnabled` / `gdriveAutoBackupEnabled` are read
by the service worker (`gdriveGetStatus`, the daily alarm) but written only by this UI. They sat
outside the store's contract precisely because the legacy modal wrote them.

## Decision

- **`src/components/Modal.jsx` is the only modal primitive**, with `src/components/portalRoot.js`
  owning the single `#tcm-modal-root` on `document.body` (not `#collectionsContainer`, which is a
  scroll container carrying grid/list classes). It reuses the legacy `.modal-overlay`,
  `.modal`, `.modal-header`, `.modal-body` and `.close-modal` classes, so no CSS was added.
- **Behaviour lives in the primitive, once**: `role="dialog"` + `aria-modal` labelled by the
  title, focus moved into the dialog on open and returned to the trigger on close, Tab cycling
  inside, Escape closes, overlay click closes (replaceable via `onOverlayClick`), and an optional
  `zIndex`. A module-level stack means **only the topmost dialog** answers Escape or traps Tab.
- **The settings modal is React-owned** (`src/features/settings`): Session, Performance,
  Appearance, Keyboard Shortcuts, Cloud Backup and Limits all render from the store and write
  through `mutate()`, with `useSettingsActions` holding the clamping rules and toast wording.
- **The two GDrive flags join the store's contract** (`DEFAULT_SETTINGS` + `STORAGE_KEYS`), because
  the React modal is now their only writer. Their names, shape and meaning are unchanged, the
  worker's reads are untouched, and no migration is needed: a missing key and `false` already mean
  the same thing to every reader. The worker keeps owning everything else about the feature —
  tokens, the alarm, and the three backup actions, which stay `chrome.runtime.sendMessage` calls.
- **Visibility is app state, reached from legacy markup**: `App` holds the open flag and registers
  its opener through `legacy-handle.js` (`window.__tcmReact.openSettings`), because the header's
  settings button is still legacy markup.
- **The legacy modal is deleted, not disabled**: the markup, `setupSettingsModal()`,
  `renderAutoSaveSelect()`, `updateAutoSaveConfig()` and the `settingsModal` entry in `MODAL_IDS`
  are gone. `isAnyModalOpen()` now asks the DOM for a visible `.modal-overlay`, so a React modal
  counts when deciding whether the `1`–`9` jump shortcut should fire.

## Consequences

- `popup.js` no longer writes storage at all. The state-contract test lost its "except the GDrive
  flags" carve-out and now asserts that flatly.
- A store mutation now persists thirteen keys instead of eleven (the two flags). Payload growth is
  a few bytes; `background.js` and the message protocol are unchanged.
- The theme is applied by `useThemeAttribute` in the shell instead of by the toggle, so a theme
  change from another panel or from storage reaches this one too. `popup.js` still sets the
  attribute once on `DOMContentLoaded` to avoid a flash before React mounts.
- The remaining five legacy modals keep their own Escape and overlay handling until they are
  ported. `isAnyModalOpen` covers both worlds meanwhile, and `closeTopModal()` still walks
  `MODAL_IDS` for the legacy ones.
- The grid-view collection modal renders its own `.modal-overlay` markup rather than the primitive
  (it is a panel whose open state *is* `collection.isExpanded`, ADR-0002). Converting it is a
  cleanup, not a behaviour change, and is now the obvious follow-up.
- GDrive toasts still go through the `window.TCMLegacyUI.toast` seam; Phase 5's `ToastProvider`
  replaces that.

## Alternatives considered

- **Leave the settings modal legacy and port a smaller modal first.** Rejected: it is the only
  modal that blocks the "one writer" claim, and porting the primitive with a trivial consumer
  would have left the hard integration untested.
- **Give the GDrive flags to the worker** (a new "set flag" message instead of a UI write).
  Rejected for now: it means editing `background.js`, which the plan's risk register forbids until
  Phase 6, and they are user settings the UI is the right owner of.
- **Keep a per-modal overlay/portal** instead of a primitive. Rejected: that is the duplication
  this phase exists to remove.
- **Render modals inside `#collectionsContainer`** to avoid a portal. Rejected: the container
  scrolls and carries layout classes applied by `useContainerClasses`; a fixed overlay inside it
  would clip and inherit the wrong box.
- **A focus-trap library.** Rejected: Tab cycling, initial focus and focus restore are ~25 lines
  against the legacy classes, and no dependency is warranted for one dialog shape.

## Update — the remaining dialogs ported to the primitive

Phase 4 is finished: the five remaining legacy modals and the grid-view collection modal are now
`Modal` consumers, so every dialog in the extension shares one focus and Escape implementation.

- **`src/features/dialogs` owns them all** — `AddTabsModal` (manual + multi-select via
  `ManualTabForm` / `OpenTabsPicker`), `DuplicateUrlDialog`, `HistoryModal`, `SessionDetailsModal`,
  `ShortcutsHelpModal` — rendered by one `DialogHost` from `useDialogs`, which holds every open
  flag. `DialogHost`'s render order is load-bearing: a later dialog mounts its portal later, so the
  duplicate prompt stacks above add-tabs and session details above history, and the Modal stack
  keeps Escape on the topmost one. Legacy stacking survives as `zIndex` 2000 / 3000 on the
  details and shortcuts dialogs.
- **The legacy markup and controllers are deleted, not hidden.** `popup.html` lost all five modal
  blocks and the `#openTabTemplate`; `popup.js` lost `renderOpenTabsList`, `openAddTabsModal`,
  `closeAddTabsModal`, `switchTabMode`, `showDuplicateUrlConfirm`, `findDuplicateUrlsAcrossCollections`,
  `addManualTab`, `addTabsFromSelection`, `importCollection`, `captureGroupMeta`, the whole
  session-history controller (`openHistoryModal` / `showSessionDetails`), `openShortcutsHelp`,
  `setupShortcutsHelpModal`, `MODAL_IDS` and `closeTopModal`. `scripts/build.mjs` now asserts each
  modal id and the template are absent from the composed page.
- **Tab intake is one write, not two.** `useTabIntake` funnels the manual form, the multi-select
  picker and the JSON import through `addTabsToCollection` + a single `mutate()`, so the 200-tab cap,
  the pinned-limit rule (a pinned tab past the limit lands unpinned) and `chromeGroups` merging
  exist once. The legacy `alert()`s became toasts, and the JSON import accepts both the bare-array
  and `{tabs:[...]}` formats.
- **The duplicate confirmation is a Promise.** `useDialogs` resolves it through a ref (never state)
  and the dialog settles it on Add Anyway, Cancel, Escape and the overlay alike, so the intake
  awaiting it can never hang.
- **Only Escape routing stayed in `popup.js`.** The `?` shortcut and the header's history button
  forward through `window.__tcmReact` (`openShortcuts` / `openHistory`, registered by `App`),
  and the global Escape handler now yields to a visible React dialog via `isAnyModalOpen()` and
  lets the primitive close it. `closeTopModal()` and `MODAL_IDS` had no remaining callers and are
  gone.
- **`sessionHistory` is read, never written.** `useSessionHistory` reads it (and
  `ramSaverEnabled`) straight from `chrome.storage.local` and follows `storage.onChanged`, because
  the key is worker-owned (ADR-0004); the UI only displays it and re-opens snapshots through
  `openSessionTabs`.
- **The grid-view modal is a `Modal` too**, which removes the last hand-rolled overlay and its
  private Escape listener; closing it still collapses the collection, which stays the single source
  of truth for whether it is open.
- `useCollectionActions` gained an `overrides` argument: adding and importing tabs are React-owned
  now, so `App` injects `useDialogs`' handlers instead of `popup.js`'s, and the two `legacyUi`
  entries were dropped.
