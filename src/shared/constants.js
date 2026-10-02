/**
 * Storage-schema version (skill.md §7.1). Bump it with every `store/migrations/` entry; the store
 * runs the migrations newer than the stored value once, then persists the new number.
 */
export const SCHEMA_VERSION = 2;

/** Limits shared by the UI and the service worker (`background/` imports this module). */
export const LIMITS = Object.freeze({
  MAX_TABS_PER_COLLECTION: 200,
  MAX_SESSION_HISTORY: 100,
  MAX_COLLECTION_NAME_LENGTH: 100,
  MAX_FOLDER_NAME_LENGTH: 100,
  MAX_FOLDERS: 200,
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
  // Cloud Backup (Google Drive). The worker reads these flags; the settings modal is their only
  // writer since Phase 4, which is why they joined the store's contract (ADR-0005).
  gdriveBackupEnabled: false,
  gdriveAutoBackupEnabled: false,
});
