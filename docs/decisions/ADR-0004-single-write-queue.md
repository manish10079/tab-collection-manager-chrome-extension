# ADR-0004: One write queue owns the whole storage contract

- Status: accepted
- Date: 2026-10-01
- Context: closes the risk accepted in ADR-0002; `react-migration-plan.md` §8, Phase 3
- Supersedes: the "two write queues" consequence of ADR-0002

## Context

ADR-0002 left the extension with two read-modify-write implementations over the same eleven
storage keys: the React store's serialized `mutate()` and `updateQueue` in `popup.js`. Both read
the whole key set, mutated a clone and wrote all eleven keys back, so a mutation from each in the
same tick could overwrite the other — the window of a single
`chrome.storage.local.get` round trip. It was accepted only because Phase 2 could not also port
every legacy mutator, and it was explicitly deferred to Phase 3.

By Phase 3 the React list owned reordering, expansion and tab sort, while `popup.js` still owned
collection CRUD, pinning, the settings modal, import/export, the tabs modal and the worker-backed
features. Sixteen mutation sites and ten single-key writes lived in the legacy file.

The obstacle is language-level, not conceptual: `popup.js` is a classic script loaded beside the
bundle, so it cannot `import` the store. Exposing the store through a global was already the
established pattern for the two directions of this migration (`window.TCMLegacyUI`,
`window.__tcmReact`).

## Decision

- **The store is the only writer.** `popup.js` keeps `getState()` / `updateState(mutator)` as its
  API — so the sixteen call sites and their flat, in-place mutation style are untouched — but
  both are now thin wrappers over `window.__tcmStore`, published by `src/app/legacy-store.js`.
  `updateQueue` and `setState` are deleted; there is no second queue to race with.
- **The bridge translates shapes, not semantics.** Legacy code reads and writes settings at the
  root (as persisted), the store keeps them under `settings`. `mutateLegacy` builds a flat object
  from the draft, lets the legacy mutator edit it in place, copies the store-owned keys back, and
  returns the fresh flat state — the same "read → clone → modify → save → render" contract the
  deleted helper offered.
- **Reads hand out a copy.** `getLegacyState()` clones `collections` and `lastSessionBackup`,
  because legacy call sites still normalise them in place (collapse everything on open, backfill
  `addedAt`). Those edits must never reach the snapshot React renders from.
- **Staleness is handled where it exists.** `getState()` reads the snapshot, which the store keeps
  current from `storage.onChanged`. The three reads that follow a write made *outside* this
  context (the worker's `forceAutoSave` on open, `gdriveRestore`, the `onChanged` handler itself)
  call `getFreshState()`, which awaits a re-read first.
- **The settings toggles join the queue too.** `ramSaverEnabled`, `theme`, both `enforce*` flags
  and both `max*` limits now go through `updateState` instead of a single-key
  `chrome.storage.local.set`, so every key in the contract has one writer.
- **No fallback path.** A missing bridge throws a scoped error instead of quietly restoring a
  second way to write state. That makes the React bundle load-bearing, so the plain copy build
  (`npm run build:legacy`, `scripts/copy-extension.mjs`) is deleted: it produced a side panel that
  could neither read nor write.

## Consequences

- The race ADR-0002 accepted is gone: a legacy action and a React action in the same tick are
  serialized by the same chain, and `src/app/__tests__/legacy-store.test.js` asserts it by
  interleaving both.
- `popup.js` no longer reads or writes the eleven keys itself — only the six GDrive flag writes
  remain direct, and only because those keys are outside the store's contract (the worker owns
  them, they are single-key with no read-modify-write, so they cannot clobber anything).
- `popup.js` now depends on the bundle to function at all. The repository root is no longer a
  loadable extension; `dist/` is, and the README says so.
- A storage write failure inside the queue is logged by the store and resolves, where the legacy
  helper rethrew. Callers that awaited a write now continue; the store's behaviour is unchanged
  from the React path.
- The bridge is temporary and joins the list of seams deleted in Phase 5, when `popup.js` goes.
  Until then two things describe the state layer — the store and this translation — and any new
  legacy mutation must use `updateState` to stay on the queue.
- The service worker keeps its own read-modify-write (a different context cannot share a promise
  chain). That was never the accepted risk; the store heals from `storage.onChanged`.

## Alternatives considered

- **A second Vite entry emitting the store as a module the legacy page loads separately.**
  Rejected: two bundles mean two module instances and therefore two queues whenever both load,
  which is the problem, not the fix.
- **Keeping a small serialized queue in `popup.js` as a fallback for the missing-bridge case.**
  Rejected: a fallback that silently reappears is how the race comes back, and the legacy-only
  build it would protect is already unable to render the list.
- **Rewriting the sixteen legacy call sites to the store's nested shape.** Rejected for this
  phase: it is a large, mechanical diff touching the riskiest code in the repository for no
  behavioural gain, and Phase 5 deletes that code outright.
- **Deep-comparing in `hydrate()` so it can emit only on real change**, which would have let
  `getState()` force a re-read on every call. Rejected: it puts a comparison cost in the React
  render path to save three call sites from being explicit.
