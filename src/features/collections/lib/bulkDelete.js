// Bulk deletion as pure draft mutators, so the confirmation numbers and the "a folder takes its
// collections with it" rule are unit-testable (skill.md §3.3 — `lib/` touches no `chrome.*`).
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { partitionCollections } from '../../../lib/sort.js';

/**
 * @typedef {object} Selection
 * @property {string[]} [folderIds]
 * @property {string[]} [collectionIds]
 */

/**
 * @typedef {object} SelectionSummary
 * @property {number} folders      Folders that will be removed
 * @property {number} collections  Collections that will be removed (selected + nested in a folder)
 * @property {number} tabs         Tabs those collections hold
 */

/**
 * What a selection would actually remove. A selected folder takes its collections with it, and the
 * live Current Session is never deletable, so both are folded in here rather than at the call site.
 *
 * @param {import('../../../store/schema.js').AppState} state
 * @param {Selection} [selection]
 * @returns {SelectionSummary}
 */
export function summarizeSelection(state, selection = {}) {
  const folderIds = new Set(selection.folderIds ?? []);
  const doomed = new Set(selection.collectionIds ?? []);
  doomed.delete(CURRENT_SESSION_ID);

  const folders = (state.folders ?? []).filter((folder) => folderIds.has(folder.id));
  const collections = (state.collections ?? []).filter(
    (collection) =>
      doomed.has(collection.id) ||
      (collection.folderId != null && folderIds.has(collection.folderId))
  );

  return {
    folders: folders.length,
    collections: collections.length,
    tabs: collections.reduce(
      (total, collection) => total + (Array.isArray(collection.tabs) ? collection.tabs.length : 0),
      0
    ),
  };
}

/**
 * Delete every selected collection and folder in one draft mutation. A selected folder cascades:
 * its collections are removed too. Current Session is always kept.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {Selection} [selection]
 * @returns {{removedFolders: number, removedCollections: number, removedTabs: number}}
 */
export function deleteSelection(draft, selection = {}) {
  const folderIds = new Set(selection.folderIds ?? []);
  const doomed = new Set(selection.collectionIds ?? []);
  doomed.delete(CURRENT_SESSION_ID);

  const removedCollections = (draft.collections ?? []).filter(
    (collection) =>
      doomed.has(collection.id) ||
      (collection.folderId != null && folderIds.has(collection.folderId))
  );
  const removedFolders = (draft.folders ?? []).filter((folder) => folderIds.has(folder.id));

  const removedIds = new Set(removedCollections.map((collection) => collection.id));
  draft.collections = partitionCollections(
    draft.collections.filter((collection) => !removedIds.has(collection.id))
  );
  draft.folders = draft.folders.filter((folder) => !folderIds.has(folder.id));

  if (draft.settings.autoSaveCollectionId && removedIds.has(draft.settings.autoSaveCollectionId)) {
    draft.settings.autoSaveCollectionId = null;
  }

  return {
    removedFolders: removedFolders.length,
    removedCollections: removedCollections.length,
    removedTabs: removedCollections.reduce(
      (total, collection) => total + (Array.isArray(collection.tabs) ? collection.tabs.length : 0),
      0
    ),
  };
}

/**
 * The wording the confirm dialog uses, so a cascade is never a surprise.
 *
 * @param {SelectionSummary} summary
 * @returns {string}
 */
export function describeSelection(summary) {
  const parts = [];
  if (summary.folders > 0) {
    parts.push(`${summary.folders} folder${summary.folders === 1 ? '' : 's'}`);
  }
  if (summary.collections > 0) {
    parts.push(`${summary.collections} collection${summary.collections === 1 ? '' : 's'}`);
  }
  const tabs = summary.tabs > 0 ? ` (${summary.tabs} tab${summary.tabs === 1 ? '' : 's'})` : '';
  return `Delete ${parts.join(' and ')}${tabs}? Collections inside a deleted folder are deleted too. This cannot be undone.`;
}
