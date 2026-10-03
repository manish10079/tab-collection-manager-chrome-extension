/**
 * Storage-schema version (skill.md §7.1). Bump it with every `store/migrations/` entry; the store
 * runs the migrations newer than the stored value once, then persists the new number.
 */
export const SCHEMA_VERSION = 3;

/** Limits shared by the UI and the service worker (`background/` imports this module). */
export const LIMITS = Object.freeze({
  MAX_TABS_PER_COLLECTION: 200,
  MAX_SESSION_HISTORY: 100,
  MAX_COLLECTION_NAME_LENGTH: 100,
  MAX_FOLDER_NAME_LENGTH: 100,
  MAX_FOLDERS: 200,
  MAX_CUSTOM_COLORS: 40,
  MAX_CUSTOM_COLOR_NAME_LENGTH: 40,
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
  // Colour labels the user has added on top of the ten built-ins (colours are a shared grouping
  // key, so the palette is stored once here rather than on each folder/collection).
  customColors: [],
});
