// Draft mutators for the store's serialized write queue. Pure and explicit so the UI never
// touches storage directly (skill.md §2.2) and every rule can be unit tested.

/**
 * Expand or collapse a collection. The value is written, not toggled, so a late render can
 * never flip the wrong way (same reasoning as the legacy `isExpanding` capture).
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {boolean} expanded
 * @returns {void}
 */
export function setCollectionExpanded(draft, collectionId, expanded) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (collection) collection.isExpanded = !!expanded;
}

/**
 * Change a collection's tab sort mode. Touching `updatedAt` matches the legacy behaviour so
 * "Last Modified" ordering stays consistent across both UIs.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} sortType
 * @returns {void}
 */
export function setTabSortType(draft, collectionId, sortType) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return;
  collection.tabSortType = sortType;
  collection.updatedAt = Date.now();
}
