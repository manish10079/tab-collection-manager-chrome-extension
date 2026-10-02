import { sortTabs } from '../../../lib/sort.js';
import { filterTabsByQuery } from '../../../lib/search.js';
import { TabRow } from './TabRow.jsx';

/**
 * @typedef {object} TabListProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {string} query             Per-collection search text
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Tabs of one collection: pinned first, then the saved sort mode, then the search filter.
 * Replaces the legacy `renderTabs` / `renderTab` template-cloning pair.
 *
 * @param {TabListProps} props
 * @returns {import('react').ReactElement}
 */
export function TabList({ collection, query, actions }) {
  const tabs = sortTabs(collection.tabs, collection.tabSortType);
  const visibleTabs = filterTabsByQuery(tabs, query);
  const sorted = (collection.tabSortType || 'custom') !== 'custom';

  return (
    <>
      <div className={`tabs-list${sorted ? ' ut-sort-active' : ''}`}>
        {tabs.length === 0 ? (
          <div className="empty-tabs-message">
            <i className="fas fa-info-circle" /> No tabs in this collection
          </div>
        ) : (
          visibleTabs.map((tab, index) => (
            <TabRow
              key={tab.id}
              tab={tab}
              number={index + 1}
              collection={collection}
              actions={actions}
            />
          ))
        )}
      </div>
      {tabs.length > 0 && visibleTabs.length === 0 ? (
        <div className="collection-tabs-no-results">No tabs match your search.</div>
      ) : null}
    </>
  );
}
