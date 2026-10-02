// Pure tab-shape helpers for the service worker (skill.md §3.3 — `lib/` touches no `chrome.*`).
// Everything the autosave engine decides about a set of raw Chrome tabs is here so it can be
// unit-tested without a browser.
import { normalizeGroupId } from '../../src/lib/tabGroups.js';

/**
 * The worker's own URL filter, preserved from the vanilla engine: it drops the internal schemes
 * Chrome reports for settings and new-tab pages, then requires the value to parse as an absolute
 * URL. It is deliberately not the UI's `isValidUrl` — the tab intake accepts anything that parses,
 * while the autosave engine skips these three schemes.
 *
 * @param {string} [url]
 * @returns {boolean}
 */
export function isSaveableUrl(url) {
  if (!url) return false;
  if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://')) {
    return false;
  }
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn one live Chrome tab into the persisted `TabItem` shape.
 *
 * @param {Record<string, any>} tab
 * @returns {Record<string, any>}
 */
export function snapshotTab(tab) {
  return {
    id: crypto.randomUUID(),
    title: (tab.title || '').trim() || 'Untitled',
    url: tab.url,
    pinned: tab.pinned || false,
    index: tab.index || 0,
    windowId: tab.windowId || 0,
    active: tab.active || false,
    discarded: tab.discarded || false,
    highlighted: tab.highlighted || false,
    chromeGroupId: normalizeGroupId(tab.groupId),
  };
}

/**
 * Snapshot every open tab whose URL the engine is willing to save.
 *
 * @param {Record<string, any>[]} tabs
 * @returns {Record<string, any>[]}
 */
export function snapshotOpenTabs(tabs) {
  return (tabs || []).filter((tab) => isSaveableUrl(tab.url)).map(snapshotTab);
}

/**
 * Bucket tabs by window id, each bucket ordered by its Chrome index.
 *
 * @param {Record<string, any>[]} tabs
 * @returns {Record<string, Record<string, any>[]>}
 */
export function groupTabsByWindow(tabs) {
  /** @type {Record<string, Record<string, any>[]>} */
  const byWindow = {};
  for (const tab of tabs) {
    const windowId = tab.windowId;
    if (!byWindow[windowId]) byWindow[windowId] = [];
    byWindow[windowId].push(tab);
  }
  for (const windowTabs of Object.values(byWindow)) {
    windowTabs.sort((a, b) => a.index - b.index);
  }
  return byWindow;
}

/**
 * Flatten window buckets back into one list, capping the collection size.
 *
 * @param {Record<string, Record<string, any>[]>} tabsByWindow
 * @param {number} max
 * @returns {Record<string, any>[]}
 */
export function flattenAndCap(tabsByWindow, max) {
  return Object.values(tabsByWindow).flat().slice(0, max);
}

/**
 * Pinned tabs sort before unpinned ones, preserving relative order within each group.
 *
 * @param {Record<string, any>[]} tabs
 * @returns {Record<string, any>[]}
 */
export function partitionPinnedFirst(tabs) {
  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);
  return [...pinned, ...unpinned];
}

/**
 * Reconcile a fresh snapshot against the tabs already saved, preserving each kept tab's identity
 * (`id`, `addedAt`) and honouring the max-pin limit.
 *
 * The vanilla engine did this inline; pulling it out makes the pin-limit rule — the reason a
 * restored session does not promote every tab to pinned — unit-testable.
 *
 * @param {Record<string, any>[]} newTabs Fresh snapshot, already ordered and capped
 * @param {Record<string, any>[]} [existingTabs]
 * @param {{enforceMaxPinnedTabs?: boolean, maxPinnedTabs?: number, now?: number}} [options]
 * @returns {Record<string, any>[]}
 */
export function mergePreservingIdentity(newTabs, existingTabs = [], options = {}) {
  const { enforceMaxPinnedTabs = true, maxPinnedTabs = 3, now = Date.now() } = options;
  const remaining = [...existingTabs];
  let preservedPinnedCount = 0;

  /** @param {boolean} wantsPinned */
  const claimPin = (wantsPinned) => {
    if (!wantsPinned) return false;
    if (!enforceMaxPinnedTabs) return true;
    if (preservedPinnedCount < maxPinnedTabs) {
      preservedPinnedCount += 1;
      return true;
    }
    return false;
  };

  return newTabs.map((newTab) => {
    const existingIndex = remaining.findIndex((existing) => existing.url === newTab.url);
    if (existingIndex !== -1) {
      const existing = remaining.splice(existingIndex, 1)[0];
      return {
        ...newTab,
        id: existing.id,
        addedAt: existing.addedAt || now,
        pinned: claimPin(existing.pinned || false),
      };
    }
    return { ...newTab, addedAt: now, pinned: claimPin(newTab.pinned || false) };
  });
}

/**
 * The partial-restore guard: refuse to overwrite a collection that still looks populated with a
 * far smaller snapshot during the startup window. `startupTime` of 0 disables it (the worker has
 * not just started), which is what made it inert after an install.
 *
 * @param {{previousTabCount: number, nextTabCount: number, now: number, startupTime: number}} input
 * @returns {boolean} True when the write should be skipped
 */
export function shouldRefuseOverwrite({ previousTabCount, nextTabCount, now, startupTime }) {
  return previousTabCount > 5 && nextTabCount < previousTabCount * 0.3 && now - startupTime < 30000;
}
