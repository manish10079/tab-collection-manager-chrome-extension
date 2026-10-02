import { useState } from 'react';
import { useDismissable } from '../../../app/hooks/useDismissable.js';

/** The icon shown on the trigger button per sort mode (the legacy `updateCollectionSortIcon`). */
const SORT_ICONS = {
  custom: 'fa-grip-vertical',
  lastModified: 'fa-clock',
  nameAsc: 'fa-sort-alpha-down',
  nameDesc: 'fa-sort-alpha-up',
  dateCreated: 'fa-calendar-plus',
  dateCreatedAsc: 'fa-calendar-minus',
  tabCount: 'fa-arrow-down-9-1',
  tabCountAsc: 'fa-arrow-up-1-9',
};

/** The same eight options and icons the legacy `#collectionsSortMenu` listed. */
const SORT_OPTIONS = [
  { value: 'custom', icon: 'fa-grip-vertical', label: 'Custom Order' },
  { value: 'lastModified', icon: 'fa-clock', label: 'Last Modified' },
  { value: 'nameAsc', icon: 'fa-sort-alpha-down', label: 'Name (A-Z)' },
  { value: 'nameDesc', icon: 'fa-arrow-down-z-a', label: 'Name (Z-A)' },
  { value: 'dateCreated', icon: 'fa-calendar-plus', label: 'Date Created (Newest)' },
  { value: 'dateCreatedAsc', icon: 'fa-calendar-plus', label: 'Date Created (Oldest)' },
  { value: 'tabCount', icon: 'fa-arrow-down-9-1', label: 'Tab Count (Highest)' },
  { value: 'tabCountAsc', icon: 'fa-arrow-down-1-9', label: 'Tab Count (Lowest)' },
];

/**
 * @typedef {object} SortMenuProps
 * @property {string} active   Current `collectionSortType`
 * @property {(sortType: string) => void} onSelect
 */

/**
 * The collections sort dropdown. Owns only the open/closed state; choosing an option writes the
 * setting through the controller and the list re-orders from the store.
 *
 * @param {SortMenuProps} props
 * @returns {import('react').ReactElement}
 */
export function SortMenu({ active, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  return (
    <div className="sort-collections-container" ref={ref}>
      <button
        type="button"
        className="icon-btn sort-collections-btn"
        id="collectionSortBtn"
        title="Sort Collections"
        aria-label="Sort collections"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i
          className={`fa-solid ${SORT_ICONS[active] || 'fa-arrow-up-wide-short'}`}
          aria-hidden="true"
        />
        <span className="sh-action-label">Sort</span>
      </button>

      <div
        className={`sort-dropdown-menu${open ? '' : ' ut-hidden'}`}
        id="collectionsSortMenu"
        role="menu"
        aria-labelledby="collectionSortBtn"
      >
        {SORT_OPTIONS.map((option) => (
          <div
            key={option.value}
            className={`sort-option${option.value === active ? ' ut-active' : ''}`}
            data-value={option.value}
            role="menuitem"
            tabIndex={0}
            onClick={() => {
              setOpen(false);
              if (option.value !== active) onSelect(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                setOpen(false);
                if (option.value !== active) onSelect(option.value);
              }
            }}
          >
            <i className={`fas ${option.icon}`} aria-hidden="true" /> {option.label}
          </div>
        ))}
      </div>
    </div>
  );
}
