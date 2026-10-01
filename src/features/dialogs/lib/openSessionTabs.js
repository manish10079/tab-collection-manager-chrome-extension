// Re-opening a saved snapshot as background tabs. This is the legacy history modal's "Open All"
// path, moved off `popup.js` (react-migration-plan.md §8, Phase 4).

/**
 * Discard a tab only once it has finished loading. Calling `chrome.tabs.discard()` right after
 * `chrome.tabs.create()` leaves the tab stuck in a loading spinner, so this waits for
 * `status === 'complete'` — or gives up after `timeoutMs`, and never discards a tab the user has
 * activated in the meantime. Ported verbatim from popup.js; the two copies disappear with it in
 * Phase 5.
 *
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function discardWhenLoaded(tabId, timeoutMs = 10000) {
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
        if (tab && !tab.active) chrome.tabs.discard(tabId).catch(() => {});
      } catch {
        // Tab might have been closed
      }
      resolve();
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;

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

/**
 * Open a snapshot's tabs in the last-focused window, in the background. Returns how many were
 * actually created so the caller can report it.
 *
 * @param {import('../../../store/schema.js').TabItem[]} [tabs]
 * @param {{ramSaverEnabled?: boolean}} [options]
 * @returns {Promise<number>}
 */
export async function openSessionTabs(tabs = [], { ramSaverEnabled = false } = {}) {
  if (!Array.isArray(tabs) || tabs.length === 0) return 0;

  let windowId;
  try {
    const current = await chrome.windows.getLastFocused();
    windowId = current ? current.id : undefined;
  } catch {
    windowId = undefined;
  }

  let opened = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      const value = String(tab?.url ?? '').trim();
      if (!value || value === 'about:blank') return;
      const url = /^https?:\/\//.test(value) ? value : `https://${value}`;

      try {
        const created = await chrome.tabs.create({
          windowId,
          url,
          pinned: Boolean(tab.pinned),
          active: false,
        });
        opened += 1;
        if (ramSaverEnabled && created && created.id) discardWhenLoaded(created.id);
      } catch (error) {
        console.error('[dialogs] failed to restore historical tab:', error);
      }
    })
  );

  return opened;
}
