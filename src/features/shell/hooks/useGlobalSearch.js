import { useMemo } from 'react';
import { useCollections } from '../../../store/hooks.js';
import { searchCollections } from '../lib/globalSearch.js';

/**
 * Global search matches for a query, derived from the live collections. Recomputed only when the
 * collections or the query change, instead of the legacy re-read of storage on every keystroke.
 *
 * @param {string} query
 * @returns {import('../lib/globalSearch.js').SearchOutcome}
 */
export function useGlobalSearch(query) {
  const collections = useCollections();
  return useMemo(() => searchCollections(collections, query), [collections, query]);
}
