import { getSnapshot, mutate } from '../../../store/store.js';
import { toOpenableUrl } from '../../../lib/url.js';
import { discardWhenLoaded } from '../../../lib/tabs.js';
import { removeTab, renameTab } from '../lib/collectionAdmin.js';
import {
  moveTabToCollection,
  moveTabToCollectionAtPosition,
  reorderTabsWithinCollection,
  setTabSortType,
} from '../lib/collectionDraft.js';

/**
 * @typedef {object} TabActions
 * @property {(id: string, sortType: string) => Promise<void>} setTabSortType
 * @property {(id: string) => Promise<void>} openAllTabs
 * @property {(id: string) => void} addTabs
 * @property {(id: string) => Promise<void>} importTabs
 * @property {(collectionId: string, sourceTabId: string, targetTabId: string) => Promise<void>} reorderTabs
 * @property {(tabId: string, sourceCollectionId: string, targetCollectionId: string) => Promise<{moved: boolean}>} moveTab
 * @property {(tabId: string, sourceCollectionId: string, targetCollectionId: string, targetTabId: string) => Promise<{moved: boolean}>} moveTabToPosition
 * @property {(collectionId: string, tabId: string) => void} removeTab
 * @property {(collectionId: string, tabId: string, title: string) => void} renameTab
 * @property {(url: string, options?: {active?: boolean}) => Promise<void>} openTab
 * @property {(url: string) => Promise<void>} copyTabUrl
 */

/**
 * Everything done to the tabs inside a collection: sorting, opening, adding, importing, removing,
 * renaming, copying and moving between collections.
 *
 * Opening and restoring are `chrome.*` calls here, and the two dialog handlers the app layer owns
 * (`addTabs`, `importTabs`) arrive by injection.
 *
 * @param {object} deps Injected by the app layer
 * @param {(message: string, duration?: number) => void} deps.toast
 * @param {(id: string) => void} deps.addTabs
 * @param {(id: string) => Promise<void>} deps.importTabs
 * @returns {TabActions}
 */
export function useTabActions({ toast, addTabs, importTabs }) {
  /**
   * A cross-collection tab move can be refused (the 200-tab cap). The mutator's verdict comes
   * back through the write queue and surfaces as a toast instead of the legacy alert().
   *
   * @param {(draft: import('../../../store/schema.js').AppState) => {moved: boolean, message?: string}} mutator
   * @returns {Promise<{moved: boolean, message?: string}>}
   */
  async function runTabMove(mutator) {
    let result = { moved: true };
    await mutate((draft) => {
      result = mutator(draft);
    });
    if (!result.moved && result.message) toast(result.message);
    return result;
  }

  return {
    setTabSortType: (id, sortType) => mutate((draft) => setTabSortType(draft, id, sortType)),

    openAllTabs: async (id) => {
      // The service worker owns restore: it opens the tabs in a new window, rebuilds Chrome tab
      // groups and applies RAM Saver. The legacy fallback that duplicated that logic is gone.
      try {
        const response = await chrome.runtime.sendMessage({
          command: 'restoreSession',
          collectionId: id,
        });
        if (response && response.success) toast('All tabs opened in background');
        else toast('Could not restore that collection.');
      } catch (error) {
        console.error('[collections] failed to restore collection:', error);
        toast('Could not restore that collection.');
      }
    },

    addTabs: (id) => addTabs(id),

    importTabs: (id) => importTabs(id),

    reorderTabs: (collectionId, sourceTabId, targetTabId) =>
      mutate((draft) => reorderTabsWithinCollection(draft, collectionId, sourceTabId, targetTabId)),

    moveTab: (tabId, sourceCollectionId, targetCollectionId) =>
      runTabMove((draft) =>
        moveTabToCollection(draft, tabId, sourceCollectionId, targetCollectionId)
      ),

    moveTabToPosition: (tabId, sourceCollectionId, targetCollectionId, targetTabId) =>
      runTabMove((draft) =>
        moveTabToCollectionAtPosition(
          draft,
          tabId,
          sourceCollectionId,
          targetCollectionId,
          targetTabId
        )
      ),

    removeTab: (collectionId, tabId) =>
      mutate((draft) => {
        removeTab(draft, collectionId, tabId);
      }),

    renameTab: (collectionId, tabId, title) =>
      mutate((draft) => {
        renameTab(draft, collectionId, tabId, title);
      }),

    openTab: async (url, options = {}) => {
      const target = toOpenableUrl(url);
      if (!target) return;

      // `active` defaults to true, so clicking a tab row loads it straight away.
      const active = options.active !== false;
      try {
        const created = await chrome.tabs.create({ url: target, active });
        if (active) return;

        if (getSnapshot().settings.ramSaverEnabled && created && created.id) {
          discardWhenLoaded(created.id);
          toast('Tab opened (RAM Saver — loads on click)');
        } else {
          toast('Tab opened in background');
        }
      } catch (error) {
        console.error('[collections] failed to open tab:', target, error);
        toast('Could not open that tab.');
      }
    },

    copyTabUrl: async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied to clipboard', 500);
      } catch (error) {
        console.error('[collections] failed to copy tab link:', error);
        toast('Failed to copy link');
      }
    },
  };
}
