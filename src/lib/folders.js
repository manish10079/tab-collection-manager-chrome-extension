// Pure folder grouping (skill.md §3.3 — `lib/` touches no `chrome.*`). Rendering needs a
// two-level view: the root collections and, for each folder, the collections that point at it.
// Folder membership is one level deep; a folder never contains another folder.
import { sortCollections } from './sort.js';

/**
 * The collections that belong to a folder (`null` means the root).
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @param {string|null} folderId
 * @returns {import('../store/schema.js').Collection[]}
 */
export function collectionsInFolder(collections = [], folderId) {
  return collections.filter((collection) => (collection.folderId ?? null) === folderId);
}

/**
 * The display view of the collection list: root collections first, then each folder with its own
 * collections. Both levels go through the same sort mode, so a folder's contents honour the
 * Collections sort the same way the root does.
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @param {import('../store/schema.js').Folder[]} [folders]
 * @param {string} [sortType]
 * @returns {{root: import('../store/schema.js').Collection[], groups: Array<{folder: import('../store/schema.js').Folder, collections: import('../store/schema.js').Collection[]}>}}
 */
export function groupCollections(collections = [], folders = [], sortType = 'custom') {
  return {
    root: sortCollections(collectionsInFolder(collections, null), sortType),
    groups: folders.map((folder) => ({
      folder,
      collections: sortCollections(collectionsInFolder(collections, folder.id), sortType),
    })),
  };
}
