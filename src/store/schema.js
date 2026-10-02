// Storage shapes as JSDoc (skill.md §5.1): the persisted contract, documented once
// and reused by the store, components and tests.
import { CURRENT_SESSION_ID } from '../shared/storage-keys.js';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../shared/constants.js';

/**
 * @typedef {object} TabItem
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {boolean} pinned
 * @property {number} index
 * @property {number} windowId
 * @property {number} [addedAt]
 * @property {number|null} [chromeGroupId] Chrome tab-group id at save time (null when ungrouped)
 */

/**
 * @typedef {object} ChromeGroupMeta
 * @property {string} title
 * @property {string} color
 * @property {boolean} collapsed
 */

/**
 * A top-level container for collections (one level deep — folders do not nest).
 *
 * @typedef {object} Folder
 * @property {string} id
 * @property {string} name
 * @property {number} [createdAt]
 * @property {number} [updatedAt]
 * @property {boolean} [isExpanded]
 */

/**
 * @typedef {object} Collection
 * @property {string} id
 * @property {string} name
 * @property {TabItem[]} tabs
 * @property {number} [createdAt]
 * @property {number} [updatedAt]
 * @property {boolean} [isExpanded]
 * @property {boolean} [pinned]
 * @property {boolean} [isCurrentSession]
 * @property {string} [tabSortType]
 * @property {Record<string, ChromeGroupMeta>} [chromeGroups]
 * @property {string|null} [folderId] Owning folder, or null when the collection is at the root
 */

/**
 * @typedef {object} SessionBackup
 * @property {TabItem[]} tabs
 * @property {Record<string, ChromeGroupMeta>} [chromeGroups] The groups those tabs' `chromeGroupId`s
 *   point at. Written by the worker with the tabs, so every restore path can rebuild the groups
 *   rather than opening a flat list.
 * @property {number} [timestamp]
 * @property {string} [collectionId]
 * @property {string} [name]
 */

/**
 * @typedef {object} AppState
 * @property {boolean} ready            True once storage has been read at least once.
 * @property {string|null} error        Human-readable storage error, or null.
 * @property {Collection[]} collections
 * @property {Folder[]} folders         Top-level containers; a collection points at one via `folderId`.
 * @property {Record<string, unknown>} settings
 * @property {SessionBackup|null} lastSessionBackup  Written by the service worker; carried
 *   through mutations untouched so a store write cannot drop the restore point.
 * @property {number} schemaVersion     Persisted storage-schema version (skill.md §7.1)
 */

/** @type {AppState} */
export const EMPTY_STATE = Object.freeze({
  ready: false,
  error: null,
  collections: [],
  folders: [],
  settings: { ...DEFAULT_SETTINGS },
  lastSessionBackup: null,
  schemaVersion: SCHEMA_VERSION,
});

/**
 * Coerce raw storage into a well-formed AppState. Never throws: anything unexpected
 * falls back to a safe default (skill.md §5.1 — never assume a stored field exists).
 *
 * A collection whose `folderId` points at a folder that is gone is treated as a root
 * collection, so a half-applied edit can never orphan it out of the list.
 *
 * @param {Record<string, unknown>} raw Value returned by chrome.storage.local.get
 * @returns {AppState}
 */
export function normalizeState(raw = {}) {
  const rawCollections = Array.isArray(raw.collections) ? raw.collections : [];
  const rawFolders = Array.isArray(raw.folders) ? raw.folders : [];

  /** @type {Folder[]} */
  const folders = rawFolders
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const folder = /** @type {Folder} */ ({ ...entry });
      folder.id = String(folder.id ?? '');
      folder.name = String(folder.name ?? 'Folder');
      folder.createdAt = folder.createdAt ?? Date.now();
      folder.updatedAt = folder.updatedAt ?? folder.createdAt;
      folder.isExpanded = !!folder.isExpanded;
      return folder;
    })
    .filter((folder) => folder.id !== '');

  const folderIds = new Set(folders.map((folder) => folder.id));

  /** @type {Collection[]} */
  const collections = rawCollections
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const collection = /** @type {Collection} */ ({ ...entry });
      collection.id = String(collection.id ?? '');
      collection.name = String(collection.name ?? 'Untitled');
      collection.tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
      const folderId = typeof collection.folderId === 'string' ? collection.folderId : null;
      collection.folderId = folderId && folderIds.has(folderId) ? folderId : null;
      return collection;
    })
    // Current Session always sorts first, matching the service worker's invariant.
    .sort((a, b) => {
      if (a.id === CURRENT_SESSION_ID) return -1;
      if (b.id === CURRENT_SESSION_ID) return 1;
      return 0;
    });

  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] !== undefined) settings[key] = raw[key];
  }

  const backup = raw.lastSessionBackup;
  const lastSessionBackup =
    backup && typeof backup === 'object' && Array.isArray(backup.tabs) ? backup : null;

  return {
    ready: true,
    error: null,
    collections,
    folders,
    settings,
    lastSessionBackup,
    schemaVersion: Number.isFinite(raw.schemaVersion)
      ? /** @type {number} */ (raw.schemaVersion)
      : 0,
  };
}

/**
 * Count the tabs saved across every collection.
 *
 * @param {Collection[]} collections
 * @returns {number}
 */
export function countTabs(collections) {
  return collections.reduce((total, collection) => total + collection.tabs.length, 0);
}
