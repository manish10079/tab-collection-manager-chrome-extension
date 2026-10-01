// Storage contract — the persisted keys are FROZEN (skill.md §2.3).
// Renaming a key requires a migration in src/store/migrations/ plus a schemaVersion bump.
export const STORAGE_KEYS = Object.freeze({
  collections: 'collections',
  autoSaveCollectionId: 'autoSaveCollectionId',
  lastSessionBackup: 'lastSessionBackup',
  ramSaverEnabled: 'ramSaverEnabled',
  collectionSortType: 'collectionSortType',
  layoutViewMode: 'layoutViewMode',
  theme: 'theme',
  enforceMaxPinnedTabs: 'enforceMaxPinnedTabs',
  maxPinnedTabs: 'maxPinnedTabs',
  enforceMaxPinnedCollections: 'enforceMaxPinnedCollections',
  maxPinnedCollections: 'maxPinnedCollections',
  sessionHistory: 'sessionHistory',
});

/** The always-present, auto-saved collection that mirrors the live browser session. */
export const CURRENT_SESSION_ID = 'current-session';

/** All persisted keys, in a stable order, for bulk reads. */
export const STORAGE_KEY_LIST = Object.freeze(Object.values(STORAGE_KEYS));
