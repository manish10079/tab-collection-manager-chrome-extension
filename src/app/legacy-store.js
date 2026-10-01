// Legacy -> store seam for the *state layer*. `popup.js` is a classic script, so it cannot
// import the store; it calls `window.__tcmStore` instead, published once on start-up below.
//
// Why this exists: the store's serialized `mutate()` queue and the legacy `updateQueue` both did
// read -> clone -> modify -> save over the same eleven keys, so a write from each in the same
// tick could lose one (the risk accepted in ADR-0002). `popup.js` now has no queue of its own —
// every mutation in the extension goes through this one, which closes that race.
//
// The legacy runtime still speaks the flat shape it persists (settings at the root), so the
// bridge translates in both directions. That shim is the whole reason this file is allowed to be
// as unglamorous as it is; delete it in Phase 5 together with the rest of `popup.js`.
import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSnapshot, hydrate, mutate } from '../store/store.js';

/** Settings keys the flat legacy shape keeps at the root, mirroring the persisted object. */
const FLAT_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

/**
 * The store snapshot reshaped like the object the legacy runtime reads from storage.
 *
 * Collections are cloned on purpose: legacy call sites still normalise them in place (collapse
 * everything on open, backfill `addedAt`), and those edits must not reach the snapshot React
 * renders from. Settings values are primitives, so a spread is enough for them.
 *
 * @param {import('../store/schema.js').AppState} snapshot
 * @returns {Record<string, unknown>} Flat legacy state
 */
function toLegacy(snapshot) {
  const { collections, lastSessionBackup } = structuredClone({
    collections: snapshot.collections,
    lastSessionBackup: snapshot.lastSessionBackup,
  });
  return { ...snapshot.settings, collections, lastSessionBackup };
}

/**
 * Copy a mutated flat state back onto the store draft. Only keys the store owns are applied —
 * `sessionHistory` stays worker-owned, and the GDrive flags are not part of this contract at all.
 *
 * @param {import('../store/schema.js').AppState} draft
 * @param {Record<string, unknown>} flat
 */
function applyLegacy(draft, flat) {
  draft.collections = flat.collections;
  draft.lastSessionBackup = flat.lastSessionBackup;
  for (const key of FLAT_SETTING_KEYS) {
    draft.settings[key] = flat[key];
  }
}

/**
 * Publish the state bridge the legacy runtime calls. Safe to call more than once.
 *
 * @returns {void}
 */
export function publishStoreBridge() {
  globalThis.__tcmStore = {
    /** Whether storage has been read at least once, so a read can skip the hydration await. */
    isReady: () => getSnapshot().ready,

    /** Re-read storage; shares the store's in-flight read. */
    hydrate,

    /**
     * Current state in the flat legacy shape. Cheap: it reshapes the snapshot, it does not read
     * storage again.
     *
     * @returns {Record<string, unknown>}
     */
    getLegacyState: () => toLegacy(getSnapshot()),

    /**
     * Persist a legacy mutation through the shared queue.
     *
     * The mutator receives the flat state and may edit it in place or replace fields on it, the
     * same contract the deleted legacy helper had. The fresh flat state is returned so callers
     * can refresh what they used to repaint from the write's result.
     *
     * @param {(state: Record<string, any>) => void} mutator
     * @returns {Promise<Record<string, unknown>>}
     */
    mutateLegacy: async (mutator) => {
      await mutate((draft) => {
        const flat = {
          ...draft.settings,
          collections: draft.collections,
          lastSessionBackup: draft.lastSessionBackup,
        };
        mutator(flat);
        applyLegacy(draft, flat);
      });
      return toLegacy(getSnapshot());
    },
  };
}
