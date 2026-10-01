// Tab intake as a store-draft mutator: everything `addManualTab` and `addTabsFromSelection` used
// to do to a cloned state object, minus the DOM and the `alert()`s. Pure, so the caps and the pin
// rules can be unit tested (they are the part of the legacy code that was easiest to get wrong).
import { LIMITS } from '../../../shared/constants.js';
import { partitionTabs } from '../../../lib/sort.js';
import { normalizeGroupId } from '../../../lib/tabGroups.js';
import { isValidUrl } from '../../../lib/url.js';

/**
 * @typedef {object} TabIntakeOutcome
 * @property {number} added          Tabs that landed in the collection
 * @property {number} skippedByLimit Tabs refused because the collection is at its cap
 * @property {number} skippedInvalid Tabs refused because their URL does not parse
 */

/** @returns {TabIntakeOutcome} */
function emptyOutcome() {
  return { added: 0, skippedByLimit: 0, skippedInvalid: 0 };
}

/**
 * Append tabs to a collection at the end of the draft's write queue turn.
 *
 * Rules preserved from the legacy `addTabsFromSelection`: the 200-tab cap counts from the
 * collection's live length, a tab arriving past the pinned limit lands unpinned, `addedAt` is kept
 * when the imported data has one, and Chrome tab-group metadata referenced by the incoming tabs is
 * merged into `collection.chromeGroups` so the groups can be rebuilt on restore.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {{title?: string, url?: string, pinned?: boolean, addedAt?: number, groupId?: unknown}[]} tabs
 * @param {Record<string, import('../../../store/schema.js').ChromeGroupMeta>} [groupsMeta]
 * @returns {TabIntakeOutcome}
 */
export function addTabsToCollection(draft, collectionId, tabs = [], groupsMeta = {}) {
  const outcome = emptyOutcome();
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return outcome;

  const valid = [];
  for (const tab of tabs) {
    if (!isValidUrl(tab?.url)) {
      outcome.skippedInvalid += 1;
      continue;
    }
    valid.push(tab);
  }

  const referencedGroups = {};
  for (const tab of valid) {
    const groupId = normalizeGroupId(tab.groupId);
    if (groupId !== null && groupsMeta[groupId]) referencedGroups[groupId] = groupsMeta[groupId];
  }
  if (Object.keys(referencedGroups).length > 0) {
    collection.chromeGroups = { ...(collection.chromeGroups || {}), ...referencedGroups };
  }

  const maxPinnedTabs = Number(draft.settings.maxPinnedTabs);
  let pinnedCount = collection.tabs.filter((tab) => tab.pinned).length;

  for (const tab of valid) {
    if (collection.tabs.length >= LIMITS.MAX_TABS_PER_COLLECTION) {
      outcome.skippedByLimit += 1;
      continue;
    }

    let pinned = Boolean(tab.pinned);
    if (pinned && Number.isFinite(maxPinnedTabs) && pinnedCount >= maxPinnedTabs) pinned = false;
    if (pinned) pinnedCount += 1;

    collection.tabs.push({
      id: crypto.randomUUID(),
      title: String(tab.title ?? '').trim() || 'Untitled',
      url: tab.url,
      pinned,
      index: collection.tabs.length, // append at the end
      windowId: 0,
      active: false,
      discarded: false,
      highlighted: false,
      addedAt: tab.addedAt || Date.now(),
      chromeGroupId: normalizeGroupId(tab.groupId),
    });
    outcome.added += 1;
  }

  if (outcome.added > 0) {
    collection.tabs = partitionTabs(collection.tabs);
    collection.updatedAt = Date.now();
  }

  return outcome;
}
