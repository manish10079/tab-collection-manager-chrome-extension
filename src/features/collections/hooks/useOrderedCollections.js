import { useAppState } from '../../../store/hooks.js';
import { sortCollections } from '../../../lib/sort.js';

/**
 * The collections in display order for a saved sort mode: Current Session first, pinned
 * next, then the unpinned collections in the requested order.
 *
 * @returns {import('../../../store/schema.js').Collection[]}
 */
export function useOrderedCollections() {
  const { collections, settings } = useAppState();
  return sortCollections(collections, settings.collectionSortType);
}
