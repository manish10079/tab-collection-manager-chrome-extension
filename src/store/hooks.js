import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store.js';
import { countTabs } from './schema.js';
import { CURRENT_SESSION_ID } from '../shared/storage-keys.js';

/**
 * The whole app snapshot.
 * @returns {import('./schema.js').AppState}
 */
export function useAppState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * All collections, Current Session first.
 * @returns {import('./schema.js').Collection[]}
 */
export function useCollections() {
  return useAppState().collections;
}

/**
 * Persisted settings with defaults applied.
 * @returns {Record<string, unknown>}
 */
export function useSettings() {
  return useAppState().settings;
}

/**
 * Derived header numbers for the shell.
 * @returns {{collections: number, tabs: number, currentSessionTabs: number, autoSaveName: string}}
 */
export function useShellStats() {
  const { collections, settings } = useAppState();
  const currentSession = collections.find((collection) => collection.id === CURRENT_SESSION_ID);
  const autoSaveId = /** @type {string|null} */ (settings.autoSaveCollectionId ?? null);
  const autoSaveTarget = collections.find((collection) => collection.id === autoSaveId);

  return {
    collections: collections.length,
    tabs: countTabs(collections),
    currentSessionTabs: currentSession ? currentSession.tabs.length : 0,
    autoSaveName: autoSaveTarget ? autoSaveTarget.name : 'off',
  };
}
