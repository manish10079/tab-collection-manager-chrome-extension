// Restore: rebuild a saved collection's tabs in the focused window, then recreate the Chrome tab
// groups it was saved with. The RAM-Saver path discards each tab only after it finishes loading.
import { api } from './api.js';
import { getState } from './state.js';

/**
 * Discard a tab only once it has fully loaded and is not active.
 *
 * Calling `api.tabs.discard()` straight after `api.tabs.create()` races the load and can leave the
 * tab stuck on a spinner, so this waits for `status === 'complete'`, and cancels if the user
 * activates the tab first.
 *
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function discardWhenLoaded(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return false;
      settled = true;
      api.tabs.onUpdated.removeListener(onUpdated);
      return true;
    };

    const timer = setTimeout(async () => {
      if (!finish()) return;
      try {
        const tab = await api.tabs.get(tabId);
        if (tab && !tab.active) api.tabs.discard(tabId).catch(() => {});
      } catch {
        // The tab may already be closed.
      }
      resolve();
    }, timeoutMs);

    /**
     * @param {number} updatedTabId
     * @param {Record<string, any>} changeInfo
     * @param {Record<string, any>} tab
     */
    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;

      // If the user activated the tab while it loaded, cancel the discard.
      if (tab && tab.active) {
        finish();
        clearTimeout(timer);
        resolve();
        return;
      }

      if (changeInfo.status !== 'complete') return;
      finish();
      clearTimeout(timer);
      api.tabs.discard(tabId).catch(() => {});
      resolve();
    }

    api.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Rebuild the Chrome tab groups a collection was saved with. Saved group ids are stale, so each
 * saved group is recreated fresh and then updated with its saved title/color/collapsed state.
 *
 * @param {Record<string, any>} collection Collection with `tabs[].chromeGroupId` + `chromeGroups`
 * @param {Array<Record<string, any>|undefined>} createdTabs Created tabs, index-aligned with `collection.tabs`
 * @param {number|undefined} targetWindowId
 * @returns {Promise<void>}
 */
export async function restoreTabGroups(collection, createdTabs, targetWindowId) {
  if (!api.tabs.group || !api.tabGroups) return;
  const savedGroups = collection.chromeGroups;
  if (!savedGroups || typeof savedGroups !== 'object') return;

  /** @type {Map<number, number[]>} saved group id -> created chrome tab ids */
  const groupedTabIds = new Map();
  collection.tabs.forEach((tab, index) => {
    const created = createdTabs[index];
    if (!created || !created.id) return;
    if (tab.pinned) return; // Chrome cannot group pinned tabs
    const savedGroupId = tab.chromeGroupId;
    if (savedGroupId === null || savedGroupId === undefined) return;
    if (!savedGroups[savedGroupId]) return; // group metadata was lost
    if (!groupedTabIds.has(savedGroupId)) groupedTabIds.set(savedGroupId, []);
    groupedTabIds.get(savedGroupId).push(created.id);
  });

  for (const [savedGroupId, tabIds] of groupedTabIds) {
    if (!tabIds.length) continue;
    try {
      const meta = savedGroups[savedGroupId] || {};
      const createProperties = targetWindowId !== undefined ? { windowId: targetWindowId } : {};
      const newGroupId = await api.tabs.group({ tabIds, createProperties });
      await api.tabGroups.update(newGroupId, {
        ...(meta.title ? { title: meta.title } : {}),
        color: meta.color || 'grey',
        collapsed: !!meta.collapsed,
      });
    } catch (error) {
      console.warn('Failed to restore tab group:', savedGroupId, error);
    }
  }
}

/**
 * Restore a collection (or a provided backup) into the currently focused window.
 *
 * @param {string} collectionId
 * @param {Record<string, any>|null} [backupData]
 * @returns {Promise<void>}
 */
export async function restoreSession(collectionId, backupData = null) {
  const state = await getState();
  const collection = backupData || state.collections.find((c) => c.id === collectionId);

  if (!collection || !collection.tabs || collection.tabs.length === 0) {
    console.error('No tabs to restore in collection:', collectionId);
    return;
  }

  console.log(
    `Restoring ${collection.tabs.length} tabs from ${backupData ? 'backup' : 'collection ' + collectionId}`
  );

  try {
    const currentWindow = await api.windows.getLastFocused();
    const targetWindowId = currentWindow ? currentWindow.id : undefined;

    console.log(`Restoring all ${collection.tabs.length} tabs into window ${targetWindowId}`);

    const tabPromises = collection.tabs.map((tab) => {
      let url = tab.url;
      if (!url || url === 'about:blank') return Promise.resolve(undefined);
      if (!url.startsWith('http')) url = 'https://' + url;

      return api.tabs
        .create({
          windowId: targetWindowId,
          url,
          pinned: !!tab.pinned,
          active: false, // Don't focus newly opened tabs to avoid flickering
          index: undefined, // Let Chrome append them to the end
        })
        .then((createdTab) => {
          if (state.ramSaverEnabled && createdTab && createdTab.id) {
            discardWhenLoaded(createdTab.id);
          }
          return createdTab;
        })
        .catch((error) => console.error(`Failed to create tab: ${url}`, error));
    });

    const createdTabs = await Promise.all(tabPromises);
    await restoreTabGroups(collection, createdTabs, targetWindowId);
    console.log('Session restored successfully into current window');
  } catch (error) {
    console.error('Error during restoration into current window:', error);
    // Fallback: just open the tabs.
    for (const tab of collection.tabs) {
      api.tabs
        .create({ url: tab.url, active: false })
        .then((createdTab) => {
          if (state.ramSaverEnabled && createdTab && createdTab.id) {
            discardWhenLoaded(createdTab.id);
          }
        })
        .catch(() => {});
    }
  }
}
