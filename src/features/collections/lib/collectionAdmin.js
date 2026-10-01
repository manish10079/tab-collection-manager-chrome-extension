// Collection and tab administration as store-draft mutators: everything `window.TCMLegacyUI` used
// to do to a cloned state object in `popup.js`, minus the DOM and the blocking `alert()`s. Pure, so
// the pin limits and the name rules can be unit tested (react-migration-plan.md §8, Phase 5.1).
import { LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { partitionCollections, partitionTabs } from '../../../lib/sort.js';

/**
 * The comparison key the legacy `isNameUnique` used: NFKC-normalised, whitespace collapsed,
 * trimmed, lower-cased.
 *
 * @param {string} [name]
 * @returns {string}
 */
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether a collection name is free. Case- and whitespace-insensitive, and the collection being
 * renamed is excluded so re-committing the same name is not a clash.
 *
 * @param {import('../../../store/schema.js').Collection[]} collections
 * @param {string} name
 * @param {string|null} [excludeId]
 * @returns {boolean}
 */
export function isNameUnique(collections, name, excludeId = null) {
  const target = normalizeName(name);
  return !collections.some(
    (collection) => collection.id !== excludeId && normalizeName(collection.name) === target
  );
}

/**
 * Remove a collection and re-partition the list. Auto-Save is pointed at Current Session (or off)
 * when its target disappears, exactly like the legacy action.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @returns {boolean} Whether a collection was removed
 */
export function deleteCollection(draft, collectionId) {
  const exists = draft.collections.some((collection) => collection.id === collectionId);
  if (!exists) return false;

  draft.collections = partitionCollections(
    draft.collections.filter((collection) => collection.id !== collectionId)
  );
  if (draft.settings.autoSaveCollectionId === collectionId) {
    draft.settings.autoSaveCollectionId = null;
  }
  return true;
}

/**
 * Rename a collection, returning why a rename was refused rather than alerting on the spot.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} newName
 * @returns {'renamed'|'unchanged'|'current-session'|'empty'|'too-long'|'duplicate'|'missing'}
 */
export function renameCollection(draft, collectionId, newName) {
  if (collectionId === CURRENT_SESSION_ID) return 'current-session';

  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > LIMITS.MAX_COLLECTION_NAME_LENGTH) return 'too-long';

  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return 'missing';
  if (collection.name.trim().toLowerCase() === trimmed.toLowerCase()) return 'unchanged';
  if (!isNameUnique(draft.collections, trimmed, collectionId)) return 'duplicate';

  collection.name = trimmed;
  collection.updatedAt = Date.now();
  draft.collections = partitionCollections(draft.collections);
  return 'renamed';
}

/**
 * Remove a tab from a collection.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} tabId
 * @returns {boolean}
 */
export function removeTab(draft, collectionId, tabId) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return false;

  const next = collection.tabs.filter((tab) => tab.id !== tabId);
  if (next.length === collection.tabs.length) return false;

  collection.tabs = partitionTabs(next);
  collection.updatedAt = Date.now();
  return true;
}

/**
 * Rename a tab. An empty title becomes "Untitled", matching the legacy `updateTabTitle`.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} tabId
 * @param {string} newTitle
 * @returns {boolean}
 */
export function renameTab(draft, collectionId, tabId, newTitle) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  const tab = collection?.tabs.find((entry) => entry.id === tabId);
  if (!collection || !tab) return false;

  tab.title = String(newTitle ?? '').trim() || 'Untitled';
  collection.updatedAt = Date.now();
  return true;
}

/**
 * Toggle a collection's pin, honouring the pinned-collection limit.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @returns {{changed: boolean, limitReached: boolean, limit: number}}
 */
export function toggleCollectionPin(draft, collectionId) {
  const limit = Number(draft.settings.maxPinnedCollections);
  const result = { changed: false, limitReached: false, limit };

  // Current Session is always first and is never pinnable.
  if (collectionId === CURRENT_SESSION_ID) return result;

  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return result;

  const pinned = !collection.pinned;
  if (pinned && draft.settings.enforceMaxPinnedCollections) {
    const pinnedCount = draft.collections.filter(
      (entry) => entry.pinned && entry.id !== CURRENT_SESSION_ID
    ).length;
    if (pinnedCount >= limit) {
      result.limitReached = true;
      return result;
    }
  }

  collection.pinned = pinned;
  collection.updatedAt = Date.now();
  draft.collections = partitionCollections(draft.collections);
  result.changed = true;
  return result;
}

/**
 * Toggle a tab's pin, honouring the per-collection pinned-tab limit.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} tabId
 * @returns {{changed: boolean, limitReached: boolean, limit: number}}
 */
export function toggleTabPin(draft, collectionId, tabId) {
  const limit = Number(draft.settings.maxPinnedTabs);
  const result = { changed: false, limitReached: false, limit };

  // The Current Session collection is a live mirror — its tabs are not editable.
  if (collectionId === CURRENT_SESSION_ID) return result;

  const collection = draft.collections.find((entry) => entry.id === collectionId);
  const tab = collection?.tabs.find((entry) => entry.id === tabId);
  if (!collection || !tab) return result;

  const pinned = !tab.pinned;
  if (pinned && draft.settings.enforceMaxPinnedTabs) {
    const pinnedCount = collection.tabs.filter((entry) => entry.pinned).length;
    if (pinnedCount >= limit) {
      result.limitReached = true;
      return result;
    }
  }

  tab.pinned = pinned;
  collection.updatedAt = Date.now();
  collection.tabs = partitionTabs(collection.tabs);
  result.changed = true;
  return result;
}
