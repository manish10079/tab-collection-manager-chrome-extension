// Re-opening a saved snapshot as background tabs. This is the legacy history modal's "Open All"
// path, moved off `popup.js` (react-migration-plan.md §8, Phase 4). The RAM-Saver discard rule is
// shared with the collections feature through `lib/tabs.js`.
import { discardWhenLoaded } from '../../../lib/tabs.js';

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
