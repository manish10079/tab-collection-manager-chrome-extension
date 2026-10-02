import { useAppState } from '../../../store/hooks.js';
import { groupCollections } from '../../../lib/folders.js';

/**
 * The collection list as it renders: the root collections and each folder with its own.
 *
 * @returns {{root: import('../../../store/schema.js').Collection[], groups: Array<{folder: import('../../../store/schema.js').Folder, collections: import('../../../store/schema.js').Collection[]}>}}
 */
export function useGroupedCollections() {
  const { collections, folders, settings } = useAppState();
  return groupCollections(collections, folders, settings.collectionSortType);
}
