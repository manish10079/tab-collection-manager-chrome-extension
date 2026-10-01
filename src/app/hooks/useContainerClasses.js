import { useLayoutEffect } from 'react';

/**
 * The React tree renders *into* `#collectionsContainer` (a legacy element), so React cannot
 * own that element's className through JSX. This hook keeps the two layout classes the
 * stylesheet expects in sync with the store instead of with the legacy renderer:
 * `grid-view` (list/grid layout) and `sort-active` (hide drag handles while sorted).
 *
 * Retired in Phase 5, when the container itself moves into React.
 *
 * @param {HTMLElement|null} mountPoint Element React rendered into
 * @param {{isGrid: boolean, isSorted: boolean}} state
 * @returns {void}
 */
export function useContainerClasses(mountPoint, { isGrid, isSorted }) {
  useLayoutEffect(() => {
    const container =
      mountPoint && mountPoint.isConnected
        ? mountPoint
        : document.getElementById('collectionsContainer');
    if (!container) return;

    container.classList.toggle('grid-view', !!isGrid);
    container.classList.toggle('sort-active', !!isSorted);
  }, [mountPoint, isGrid, isSorted]);
}
