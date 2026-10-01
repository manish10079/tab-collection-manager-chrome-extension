// Draft mutators for the store's serialized write queue. Pure and explicit so the UI never
// touches storage directly (skill.md §2.2) and every rule can be unit tested.
//
// The reorder helpers below mirror the legacy drag-and-drop behaviour in popup.js exactly:
// a manual reorder forces the affected sort mode back to 'custom' (otherwise the list would
// snap away from where it was dropped), pinned items stay on top, and a tab moved into a
// collection that is already at its pinned limit arrives unpinned.
import { LIMITS } from '../../../shared/constants.js';
import { partitionCollections, partitionTabs } from '../../../lib/sort.js';

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

/**
 * Move a collection onto another one's position. The collection sort mode drops back to
 * custom, because a sorted list would immediately re-order the drop away.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {void}
 */
export function reorderCollections(draft, sourceId, targetId) {
  const from = draft.collections.findIndex((entry) => entry.id === sourceId);
  const to = draft.collections.findIndex((entry) => entry.id === targetId);
  if (from === -1 || to === -1 || from === to) return;

  draft.settings.collectionSortType = 'custom';
  const [moved] = draft.collections.splice(from, 1);
  draft.collections.splice(to, 0, moved);
  draft.collections = partitionCollections(draft.collections);
}

/**
 * Move a tab onto another tab's position inside the same collection.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string} sourceTabId
 * @param {string} targetTabId
 * @returns {void}
 */
export function reorderTabsWithinCollection(draft, collectionId, sourceTabId, targetTabId) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return;

  const from = collection.tabs.findIndex((tab) => tab.id === sourceTabId);
  const to = collection.tabs.findIndex((tab) => tab.id === targetTabId);
  if (from === -1 || to === -1 || from === to) return;

  collection.tabSortType = 'custom';
  const [moved] = collection.tabs.splice(from, 1);
  collection.tabs.splice(to, 0, moved);
  collection.tabs = partitionTabs(collection.tabs);
  collection.updatedAt = Date.now();
}

/**
 * Move a tab to another collection, appended at the end.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} tabId
 * @param {string} sourceCollectionId
 * @param {string} targetCollectionId
 * @returns {{moved: boolean, message?: string}}
 */
export function moveTabToCollection(draft, tabId, sourceCollectionId, targetCollectionId) {
  const pair = resolveTabMove(draft, tabId, sourceCollectionId, targetCollectionId);
  if ('moved' in pair) return pair; // refused — the tab was never removed

  const { source, target, tab } = pair;
  applyPinLimit(draft, target, tab);
  target.tabs.push(tab);
  commitTabMove(source, target);
  return { moved: true };
}

/**
 * Move a tab to another collection, inserted at another tab's position. Like the legacy
 * handler, this resets the target's tab sort to custom so the tab stays where it landed.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} tabId
 * @param {string} sourceCollectionId
 * @param {string} targetCollectionId
 * @param {string} targetTabId
 * @returns {{moved: boolean, message?: string}}
 */
export function moveTabToCollectionAtPosition(
  draft,
  tabId,
  sourceCollectionId,
  targetCollectionId,
  targetTabId
) {
  const pair = resolveTabMove(draft, tabId, sourceCollectionId, targetCollectionId, targetTabId);
  if ('moved' in pair) return pair; // refused — the tab was never removed

  const { source, target, tab, targetIndex } = pair;
  target.tabSortType = 'custom';
  applyPinLimit(draft, target, tab);
  target.tabs.splice(targetIndex, 0, tab);
  commitTabMove(source, target);
  return { moved: true };
}

/**
 * Shared preconditions for the two cross-collection tab moves: both collections exist, they
 * differ, the tab is in the source, the target is not already at the tab cap, and — for the
 * positional variant — the insertion point exists. Everything is validated before the tab is
 * removed, so a refused move can never lose it.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} tabId
 * @param {string} sourceCollectionId
 * @param {string} targetCollectionId
 * @param {string} [targetTabId] Required to insert at a position
 * @returns {{source: import('../../../store/schema.js').Collection, target: import('../../../store/schema.js').Collection, tab: import('../../../store/schema.js').TabItem, targetIndex: number} | {moved: false, message?: string}}
 */
function resolveTabMove(draft, tabId, sourceCollectionId, targetCollectionId, targetTabId) {
  if (sourceCollectionId === targetCollectionId) return { moved: false };

  const source = draft.collections.find((entry) => entry.id === sourceCollectionId);
  const target = draft.collections.find((entry) => entry.id === targetCollectionId);
  if (!source || !target) return { moved: false };

  if (target.tabs.length >= LIMITS.MAX_TABS_PER_COLLECTION) {
    return {
      moved: false,
      message: `Cannot move tab. Maximum ${LIMITS.MAX_TABS_PER_COLLECTION} tabs per collection.`,
    };
  }

  const index = source.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return { moved: false };

  let targetIndex = target.tabs.length;
  if (targetTabId !== undefined) {
    targetIndex = target.tabs.findIndex((entry) => entry.id === targetTabId);
    if (targetIndex === -1) return { moved: false };
  }

  const [tab] = source.tabs.splice(index, 1);
  return { source, target, tab, targetIndex };
}

/**
 * Pinned-first repartition plus a modified timestamp on both collections. The tab is already
 * inserted by the caller.
 */
function commitTabMove(source, target) {
  source.tabs = partitionTabs(source.tabs);
  target.tabs = partitionTabs(target.tabs);
  source.updatedAt = Date.now();
  target.updatedAt = Date.now();
}

/**
 * A tab arriving in a collection that already holds its pinned limit lands unpinned. The
 * legacy handler ignored `enforceMaxPinnedTabs` here, so this keeps the same behaviour.
 */
function applyPinLimit(draft, target, tab) {
  if (!tab.pinned) return;
  const limit = Number(draft.settings.maxPinnedTabs);
  if (!Number.isFinite(limit)) return; // no limit configured — keep the tab pinned
  const pinnedCount = target.tabs.filter((entry) => entry.pinned).length;
  if (pinnedCount >= limit) tab.pinned = false;
}
