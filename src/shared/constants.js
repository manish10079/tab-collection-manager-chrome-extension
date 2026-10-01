/** Limits shared by the UI and the service worker. Keep in sync with background.js. */
export const LIMITS = Object.freeze({
  MAX_TABS_PER_COLLECTION: 200,
  MAX_SESSION_HISTORY: 100,
});

/** Default values applied when a persisted setting is missing. */
export const DEFAULT_SETTINGS = Object.freeze({
  autoSaveCollectionId: null,
  ramSaverEnabled: false,
  collectionSortType: 'custom',
  layoutViewMode: 'list',
  theme: 'dark',
  enforceMaxPinnedTabs: true,
  maxPinnedTabs: 3,
  enforceMaxPinnedCollections: true,
  maxPinnedCollections: 3,
});
