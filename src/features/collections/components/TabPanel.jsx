import { useState } from 'react';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { useDismissable } from '../../../app/hooks/useDismissable.js';
import { TabList } from './TabList.jsx';

/** Legacy icon per tab sort mode (`updateTabSortIcon` in popup.js). */
const TAB_SORT_ICONS = {
  custom: 'fa-grip-vertical',
  titleAsc: 'fa-sort-alpha-down',
  titleDesc: 'fa-sort-alpha-up',
  dateAddedNewest: 'fa-calendar-plus',
  dateAddedOldest: 'fa-calendar-minus',
};

const TAB_SORT_OPTIONS = [
  { value: 'custom', icon: 'fa-grip-vertical', label: 'Custom Order' },
  { value: 'dateAddedNewest', icon: 'fa-calendar-alt', label: 'Date Added (Newest)' },
  { value: 'dateAddedOldest', icon: 'fa-calendar-day', label: 'Date Added (Oldest)' },
  { value: 'titleAsc', icon: 'fa-sort-alpha-down', label: 'Title (A-Z)' },
  { value: 'titleDesc', icon: 'fa-sort-alpha-up', label: 'Title (Z-A)' },
];

/**
 * @typedef {object} TabPanelProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 * @property {boolean} [forceExpanded] Grid view renders the panel already expanded
 */

/**
 * The `.collection-tabs` block: search box, import/export, tab sort menu and the tab list.
 * Owns only view state (the search text and the open menu) — every data change goes through
 * `actions`.
 *
 * @param {TabPanelProps} props
 * @returns {import('react').ReactElement}
 */
export function TabPanel({ collection, actions, forceExpanded = false }) {
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useDismissable(sortOpen, () => setSortOpen(false));

  const isCurrentSession = collection.id === CURRENT_SESSION_ID;
  const activeSort = collection.tabSortType || 'custom';
  const expanded = forceExpanded || !!collection.isExpanded;

  return (
    <div className={`tab-collection-tabs${expanded ? ' ut-expanded' : ''}`}>
      <div className="tab-collection-tab-search">
        <input
          type="text"
          className="tab-collection-tab-search-input"
          placeholder="Search tabs…"
          autoComplete="off"
          spellCheck="false"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />

        {isCurrentSession ? null : (
          <button
            type="button"
            className="sh-icon-btn tab-import-tabs-btn"
            title="Import tabs (JSON)"
            onClick={() => actions.importTabs(collection.id)}
          >
            <i className="fas fa-file-import" />
          </button>
        )}

        <button
          type="button"
          className="sh-icon-btn tab-export-tabs-btn"
          title="Export tabs (JSON)"
          onClick={() => actions.exportCollection(collection)}
        >
          <i className="fas fa-file-export" />
        </button>

        <div className="sh-sort-tabs-container" ref={sortRef}>
          <button
            type="button"
            className="sh-icon-btn sh-sort-tabs-btn"
            title="Sort Tabs"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((open) => !open)}
          >
            <i className={`fa-solid ${TAB_SORT_ICONS[activeSort] || 'fa-arrow-up-wide-short'}`} />
          </button>
          <div className={`sh-sort-dropdown-menu${sortOpen ? '' : ' ut-hidden'}`}>
            {TAB_SORT_OPTIONS.map((option) => (
              <div
                key={option.value}
                className={`sh-sort-option${option.value === activeSort ? ' ut-active' : ''}`}
                data-value={option.value}
                role="menuitem"
                tabIndex={0}
                onClick={() => {
                  setSortOpen(false);
                  if (option.value !== activeSort) {
                    actions.setTabSortType(collection.id, option.value);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    setSortOpen(false);
                    actions.setTabSortType(collection.id, option.value);
                  }
                }}
              >
                <i className={`fas ${option.icon}`} /> {option.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <TabList collection={collection} query={query} actions={actions} />
    </div>
  );
}
