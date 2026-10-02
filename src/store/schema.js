// Storage shapes as JSDoc (skill.md §5.1): the persisted contract, documented once
// and reused by the store, components and tests.
import { CURRENT_SESSION_ID } from '../shared/storage-keys.js';
import { DEFAULT_SETTINGS } from '../shared/constants.js';

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
 */

/**
 * @typedef {object} SessionBackup
 * @property {TabItem[]} tabs
 * @property {number} [timestamp]
 * @property {string} [collectionId]
 * @property {string} [name]
 */

/**
 * @typedef {object} AppState
 * @property {boolean} ready            True once storage has been read at least once.
 * @property {string|null} error        Human-readable storage error, or null.
 * @property {Collection[]} collections
 * @property {Record<string, unknown>} settings
 * @property {SessionBackup|null} lastSessionBackup  Written by the service worker; carried
 *   through mutations untouched so a store write cannot drop the restore point.
 */

/** @type {AppState} */
export const EMPTY_STATE = Object.freeze({
  ready: false,
  error: null,
  collections: [],
  settings: { ...DEFAULT_SETTINGS },
  lastSessionBackup: null,
});

/**
 * Coerce raw storage into a well-formed AppState. Never throws: anything unexpected
 * falls back to a safe default (skill.md §5.1 — never assume a stored field exists).
 *
 * @param {Record<string, unknown>} raw Value returned by chrome.storage.local.get
 * @returns {AppState}
 */
export function normalizeState(raw = {}) {
  const rawCollections = Array.isArray(raw.collections) ? raw.collections : [];

  /** @type {Collection[]} */
  const collections = rawCollections
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const collection = /** @type {Collection} */ ({ ...entry });
      collection.id = String(collection.id ?? '');
      collection.name = String(collection.name ?? 'Untitled');
      collection.tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
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

  return { ready: true, error: null, collections, settings, lastSessionBackup };
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
