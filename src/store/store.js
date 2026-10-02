// Storage-backed store: chrome.storage.local is the single source of truth (skill.md §2.2).
// Reads hydrate the snapshot; writes go through a serialized queue that mirrors the legacy
// `updateState` discipline (read -> clone -> mutate -> persist). The UI re-renders from
// storage.onChanged, so React and the legacy popup code always see the same bytes.
import { STORAGE_KEYS, STORAGE_KEY_LIST } from '../shared/storage-keys.js';
import { EMPTY_STATE, normalizeState } from './schema.js';
import { runMigrations } from './migrations/index.js';

/** Every key the UI owns. `sessionHistory` is written by the service worker only. */
const WRITABLE_KEYS = Object.freeze(
  STORAGE_KEY_LIST.filter((key) => key !== STORAGE_KEYS.sessionHistory)
);

/** @type {import('./schema.js').AppState} */
let state = { ...EMPTY_STATE };

const listeners = new Set();
let inflight = null;
let writeChain = Promise.resolve();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Subscribe to snapshot changes.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Current snapshot. Stable between changes, as useSyncExternalStore requires.
 * @returns {import('./schema.js').AppState}
 */
export function getSnapshot() {
  return state;
}

/**
 * Read storage once and publish the normalized result.
 * Concurrent calls share a single read.
 * @returns {Promise<void>}
 */
export function hydrate() {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const raw = await chrome.storage.local.get(STORAGE_KEY_LIST);
      // Migrate before normalizing, and write the result back so the upgrade is a one-time cost
      // (the next read sees the current schemaVersion and skips it).
      const migrated = runMigrations(raw);
      state = normalizeState(migrated.data);
      if (migrated.changed) {
        await chrome.storage.local.set(toPersistedKeys(state));
        console.log(`[store] migrated storage schema ${migrated.from} → ${state.schemaVersion}`);
      }
    } catch (error) {
      state = {
        ...state,
        ready: true,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      inflight = null;
      emit();
    }
  })();

  return inflight;
}

/**
 * Persist a change. The mutator receives a fresh, normalized draft — read straight from
 * storage, exactly like the legacy `updateState` — so two writers never fight over a stale
 * snapshot. Nothing is published here: the write triggers `storage.onChanged`, which
 * hydrates once and re-renders every subscriber.
 *
 * @param {(draft: import('./schema.js').AppState) => void} mutator
 * @returns {Promise<void>}
 */
export function mutate(mutator) {
  writeChain = writeChain
    .then(async () => {
      const raw = await chrome.storage.local.get(WRITABLE_KEYS);
      const draft = normalizeState(raw);
      mutator(draft);
      await chrome.storage.local.set(toPersistedKeys(draft));
      // Keep the snapshot fresh even if this context is not the one that hears the change.
      await hydrate();
    })
    .catch((error) => {
      console.error('[store] mutation failed:', error);
    });

  return writeChain;
}

/**
 * The exact key set legacy `setState` writes — no more, so worker-owned keys stay intact.
 *
 * @param {import('./schema.js').AppState} draft
 * @returns {Record<string, unknown>}
 */
function toPersistedKeys(draft) {
  return {
    [STORAGE_KEYS.collections]: draft.collections,
    [STORAGE_KEYS.folders]: draft.folders,
    [STORAGE_KEYS.schemaVersion]: draft.schemaVersion,
    [STORAGE_KEYS.lastSessionBackup]: draft.lastSessionBackup,
    ...draft.settings,
  };
}

/**
 * Re-read storage whenever anything changes, so the React UI stays live alongside the
 * legacy popup code and the service worker.
 */
export function startStorageSync() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.keys(changes).length) return;
    hydrate();
  });
}
