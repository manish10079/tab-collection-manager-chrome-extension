import { useMemo } from 'react';
import { useAppState } from '../../../store/hooks.js';
import { NO_COLOR, allColors } from '../../../lib/colors.js';
import { clusterByColor, filterByColor } from '../../../lib/folders.js';

/**
 * The shape of one colour cluster: the label it collects and the members carrying it.
 *
 * @typedef {object} ColorCluster
 * @property {string} colorId
 * @property {import('../../../store/schema.js').Collection[]} root
 * @property {Array<{folder: import('../../../store/schema.js').Folder, collections: import('../../../store/schema.js').Collection[]}>} groups
 */

/**
 * @typedef {object} CollectionView
 * @property {'grouped'|'color'} mode  `grouped` is Folders-then-Collections; `color` is colour clusters
 * @property {import('../../../store/schema.js').Collection[]} root
 * @property {Array<{folder: import('../../../store/schema.js').Folder, collections: import('../../../store/schema.js').Collection[]}>} groups
 * @property {ColorCluster[]} clusters
 */

/**
 * The collection list as it renders, driven by the sort mode and an optional colour filter.
 *
 * `collectionSortType === 'color'` switches to colour clusters: every folder and collection carrying
 * the same colour appears together, in palette order, with the unlabelled items last. The colour
 * filter still applies — it narrows which clusters are shown. Any other sort mode keeps the
 * Folders-then-Collections layout, narrowed by the filter.
 *
 * @param {Set<string>} [colorFilter]
 * @returns {CollectionView}
 */
export function useCollectionView(colorFilter) {
  const { collections, folders, settings } = useAppState();
  const sortType = settings.collectionSortType;
  const customColors = settings.customColors;

  return useMemo(() => {
    if (sortType === 'color') {
      const order = [...allColors(customColors ?? []).map((color) => color.id), NO_COLOR];
      const clusters = clusterByColor(collections, folders, order, 'custom').filter(
        (cluster) => !colorFilter || colorFilter.size === 0 || colorFilter.has(cluster.colorId)
      );
      return { mode: 'color', root: [], groups: [], clusters };
    }

    const grouped = filterByColor(collections, folders, colorFilter, sortType);
    return { mode: 'grouped', clusters: [], ...grouped };
  }, [collections, folders, sortType, customColors, colorFilter]);
}
