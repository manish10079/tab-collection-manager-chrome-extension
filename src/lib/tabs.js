// Chrome tab helpers shared by the features that open tabs: the collections list (opening a saved
// tab) and the dialogs feature (restoring a saved snapshot). This module is deliberately impure —
// it calls `chrome.tabs` — and sits in `lib/` for exactly that reason: it is the only layer both
// features are allowed to import (skill.md §2.1 — features may not import each other). The
// purity rule for `lib/` and the amendment this needs are recorded in react-migration-plan.md §8.

// How long to wait for a tab to finish loading before deciding to discard it anyway.
const DISCARD_TIMEOUT_MS = 10000;

/**
 * RAM Saver: discard a tab only once it has finished loading.
 *
 * Calling `chrome.tabs.discard()` immediately after `chrome.tabs.create()` leaves the tab stuck on
 * a loading spinner, so this waits for `status === 'complete'` — gives up after `timeoutMs`, and
 * never discards a tab the user has activated in the meantime. Moved here from `popup.js` (and
 * from the dialogs feature's copy) so there is one implementation.
 *
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function discardWhenLoaded(tabId, timeoutMs = DISCARD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    const timer = setTimeout(async () => {
      if (settled) return;
      cleanup();
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && !tab.active) await chrome.tabs.discard(tabId).catch(() => {});
      } catch {
        // The tab was closed before it finished loading.
      }
      resolve();
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;

      // The user clicked the tab while it was loading — leave it alone.
      if (tab && tab.active) {
        cleanup();
        clearTimeout(timer);
        resolve();
        return;
      }

      if (changeInfo.status !== 'complete') return;

      cleanup();
      clearTimeout(timer);
      chrome.tabs.discard(tabId).catch(() => {});
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
