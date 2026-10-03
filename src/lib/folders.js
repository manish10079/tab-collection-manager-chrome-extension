// Pure folder grouping (skill.md §3.3 — `lib/` touches no `chrome.*`). Rendering needs a
// two-level view: the root collections and, for each folder, the collections that point at it.
// Folder membership is one level deep; a folder never contains another folder.
import { NO_COLOR } from './colors.js';
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

/**
 * The display view narrowed to the colour labels in `colorIds`, or the unfiltered view when the
 * filter is empty.
 *
 * A folder is shown when its own colour is selected, and a collection when its own colour is. A
 * matching collection whose folder is *not* part of the filter is promoted to the root rather than
 * hidden, so a colour never loses one of its own members — the colour is the grouping key, not the
 * folder. `NO_COLOR` in the set selects the unlabelled items.
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @param {import('../store/schema.js').Folder[]} [folders]
 * @param {Set<string>|null} [colorIds]
 * @param {string} [sortType]
 * @returns {{root: import('../store/schema.js').Collection[], groups: Array<{folder: import('../store/schema.js').Folder, collections: import('../store/schema.js').Collection[]}>}}
 */
export function filterByColor(collections = [], folders = [], colorIds, sortType = 'custom') {
  if (!colorIds || colorIds.size === 0) return groupCollections(collections, folders, sortType);

  const matches = (item) => colorIds.has(item.color ?? NO_COLOR);

  const visibleFolders = folders.filter(matches);
  const visibleFolderIds = new Set(visibleFolders.map((folder) => folder.id));
  const matchingCollections = collections.filter(matches);

  const groups = visibleFolders.map((folder) => ({
    folder,
    collections: sortCollections(
      matchingCollections.filter((collection) => (collection.folderId ?? null) === folder.id),
      sortType
    ),
  }));

  const root = sortCollections(
    matchingCollections.filter(
      (collection) => !collection.folderId || !visibleFolderIds.has(collection.folderId)
    ),
    sortType
  );

  return { root, groups };
}

/**
 * The list split into one cluster per colour label, in the given colour order, so every folder and
 * collection sharing a colour sits together. Empty colours are left out.
 *
 * Each cluster is exactly what the colour filter would show for that one colour — the folders
 * carrying it, their matching collections nested inside, and a matching collection whose folder is
 * not part of the group promoted to the cluster's root. Reusing the filter's rules means grouping
 * and filtering can never disagree about where a colour's members are.
 *
 * @param {import('../store/schema.js').Collection[]} [collections]
 * @param {import('../store/schema.js').Folder[]} [folders]
 * @param {string[]} [orderedColorIds] Colour ids in display order (built-ins, customs, then the
 *   unlabelled key)
 * @param {string} [sortType]
 * @returns {Array<{colorId: string, root: import('../store/schema.js').Collection[], groups: Array<{folder: import('../store/schema.js').Folder, collections: import('../store/schema.js').Collection[]}>}>}
 */
export function clusterByColor(
  collections = [],
  folders = [],
  orderedColorIds = [],
  sortType = 'custom'
) {
  const clusters = [];
  for (const colorId of orderedColorIds) {
    const view = filterByColor(collections, folders, new Set([colorId]), sortType);
    if (view.root.length === 0 && view.groups.length === 0) continue;
    clusters.push({ colorId, root: view.root, groups: view.groups });
  }
  return clusters;
}
