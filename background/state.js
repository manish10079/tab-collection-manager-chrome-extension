// Worker-side storage access: a typed read, a whole-state write, and the serialized update queue
// that keeps concurrent auto-saves from clobbering each other (skill.md §2.2). The storage keys
// come from the frozen shared contract, so a rename cannot drift between the worker and the UI.
import { api } from './api.js';
import { STORAGE_KEYS } from './constants.js';

/**
 * Read the persisted state the worker needs, defaulting every field (skill.md §5.1 — never assume
 * a stored field exists).
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function getState() {
  const result = await api.storage.local.get([
    STORAGE_KEYS.collections,
    STORAGE_KEYS.autoSaveCollectionId,
    STORAGE_KEYS.lastSessionBackup,
    STORAGE_KEYS.ramSaverEnabled,
    STORAGE_KEYS.enforceMaxPinnedTabs,
    STORAGE_KEYS.maxPinnedTabs,
    STORAGE_KEYS.enforceMaxPinnedCollections,
    STORAGE_KEYS.maxPinnedCollections,
    STORAGE_KEYS.sessionHistory,
  ]);
  return {
    collections: result[STORAGE_KEYS.collections] || [],
    autoSaveCollectionId: result[STORAGE_KEYS.autoSaveCollectionId] || null,
    lastSessionBackup: result[STORAGE_KEYS.lastSessionBackup] || null,
    ramSaverEnabled: !!result[STORAGE_KEYS.ramSaverEnabled],
    enforceMaxPinnedTabs: result[STORAGE_KEYS.enforceMaxPinnedTabs] !== false,
    maxPinnedTabs: result[STORAGE_KEYS.maxPinnedTabs] ?? 3,
    enforceMaxPinnedCollections: result[STORAGE_KEYS.enforceMaxPinnedCollections] !== false,
    maxPinnedCollections: result[STORAGE_KEYS.maxPinnedCollections] ?? 3,
    sessionHistory: result[STORAGE_KEYS.sessionHistory] || [],
  };
}

/**
 * Persist a whole state object.
 *
 * @param {Record<string, any>} state
 * @returns {Promise<void>}
 */
export async function setState(state) {
  await api.storage.local.set(state);
}

/** Chained promise that serializes every read-modify-write. */
let updateQueue = Promise.resolve();

/**
 * Run a mutator against a private clone of the state, then persist it — chained after every other
 * update so two writers can never interleave.
 *
 * The failure semantics are the vanilla engine's, preserved deliberately: a rejected update stays
 * on the chain, so the queue is not silently reordered.
 *
 * @param {(state: Record<string, any>) => void} mutator
 * @returns {Promise<Record<string, any>>}
 */
export function updateState(mutator) {
  updateQueue = updateQueue
    .then(async () => {
      const state = await getState();
      const newState = structuredClone(state);
      mutator(newState);
      await setState(newState);
      return newState;
    })
    .catch((error) => {
      console.error('Error in updateState:', error);
      throw error;
    });
  return updateQueue;
}
