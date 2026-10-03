// Pure ordering selectors. The legacy renderer sorted inside the DOM-building functions;
// here the same rules live as testable functions (react-migration-plan.md §7).
//
// Invariants preserved from popup.js:
//   - Current Session is always first and never participates in collection sorting.
//   - Pinned items stay on top; only unpinned items are re-ordered by the sort mode.
//   - Unknown sort modes fall back to custom order (the stored order).
import { CURRENT_SESSION_ID } from '../shared/storage-keys.js';

/** Collection sort modes offered by the controls bar. */
export const COLLECTION_SORT_TYPES = Object.freeze([
  'custom',
  'color',
  'lastModified',
  'nameAsc',
  'nameDesc',
  'dateCreated',
  'dateCreatedAsc',
  'tabCount',
  'tabCountAsc',
]);

/** Tab sort modes offered by a collection's sort menu. */
export const TAB_SORT_TYPES = Object.freeze([
  'custom',
  'dateAddedNewest',
  'dateAddedOldest',
  'titleAsc',
  'titleDesc',
]);

/**
 * Current Session first, then pinned, then everything else — the order the store persists.
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @returns {import('../store/schema.js').Collection[]}
 */
export function partitionCollections(collections = []) {
  const currentSession = collections.filter((collection) => collection.id === CURRENT_SESSION_ID);
  const pinned = collections.filter(
    (collection) => collection.pinned && collection.id !== CURRENT_SESSION_ID
  );
  const unpinned = collections.filter(
    (collection) => !collection.pinned && collection.id !== CURRENT_SESSION_ID
  );
  return [...currentSession, ...pinned, ...unpinned];
}

/**
 * Pinned tabs first, unpinned tabs after — the order persisted on every write.
 *
 * @param {import('../store/schema.js').TabItem[]} [tabs]
 * @returns {import('../store/schema.js').TabItem[]}
 */
export function partitionTabs(tabs = []) {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

/**
 * Apply a collection sort mode without mutating the input.
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @param {string} [sortType]
 * @returns {import('../store/schema.js').Collection[]}
 */
export function sortCollections(collections = [], sortType = 'custom') {
  const mode = COLLECTION_SORT_TYPES.includes(sortType) ? sortType : 'custom';
  const rest = collections.filter((collection) => collection.id !== CURRENT_SESSION_ID);
  const currentSession = collections.filter((collection) => collection.id === CURRENT_SESSION_ID);

  const pinned = rest.filter((collection) => collection.pinned);
  const unpinned = rest.filter((collection) => !collection.pinned);

  switch (mode) {
    case 'lastModified':
      unpinned.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      break;
    case 'nameAsc':
      unpinned.sort((a, b) => compareNames(a.name, b.name));
      break;
    case 'nameDesc':
      unpinned.sort((a, b) => compareNames(b.name, a.name));
      break;
    case 'dateCreated':
      unpinned.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      break;
    case 'dateCreatedAsc':
      unpinned.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      break;
    case 'tabCount':
      unpinned.sort((a, b) => countOf(b) - countOf(a));
      break;
    case 'tabCountAsc':
      unpinned.sort((a, b) => countOf(a) - countOf(b));
      break;
    default:
      break; // custom order — keep storage order
  }

  return [...currentSession, ...pinned, ...unpinned];
}

/**
 * Apply a tab sort mode without mutating the input.
 *
 * @param {import('../store/schema.js').TabItem[]} [tabs]
 * @param {string} [sortType]
 * @returns {import('../store/schema.js').TabItem[]}
 */
export function sortTabs(tabs = [], sortType = 'custom') {
  const mode = TAB_SORT_TYPES.includes(sortType) ? sortType : 'custom';
  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);

  switch (mode) {
    case 'dateAddedNewest':
      unpinned.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      break;
    case 'dateAddedOldest':
      unpinned.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
      break;
    case 'titleAsc':
      unpinned.sort((a, b) => compareNames(a.title, b.title));
      break;
    case 'titleDesc':
      unpinned.sort((a, b) => compareNames(b.title, a.title));
      break;
    default:
      break; // custom order — keep storage order
  }

  return [...pinned, ...unpinned];
}

/**
 * Case/diacritic-insensitive name comparison, matching the legacy `localeCompare` options.
 *
 * @param {string} [a]
 * @param {string} [b]
 * @returns {number}
 */
function compareNames(a = '', b = '') {
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

/**
 * @param {import('../store/schema.js').Collection} collection
 * @returns {number}
 */
function countOf(collection) {
  return Array.isArray(collection.tabs) ? collection.tabs.length : 0;
}
