import { mutate } from '../../../store/store.js';
import { setCollectionExpanded, setTabSortType } from '../lib/collectionDraft.js';

/**
 * @typedef {object} CollectionActions
 * @property {(id: string, expanded: boolean) => Promise<void>} setExpanded
 * @property {(id: string, sortType: string) => Promise<void>} setTabSortType
 * @property {(id: string) => void} pinCollection
 * @property {(collectionId: string, tabId: string) => void} pinTab
 * @property {(id: string, name: string) => Promise<boolean>} renameCollection
 * @property {(id: string) => void} deleteCollection
 * @property {(id: string) => void} openAllTabs
 * @property {(id: string) => void} addTabs
 * @property {(id: string) => void} importTabs
 * @property {(collection: import('../../../store/schema.js').Collection) => void} exportCollection
 * @property {(collection: import('../../../store/schema.js').Collection) => Promise<void>} copyCollectionLinks
 * @property {(collectionId: string, tabId: string) => void} removeTab
 * @property {(collectionId: string, tabId: string, title: string) => void} renameTab
 * @property {(url: string, options?: {active?: boolean}) => void} openTab
 * @property {(url: string) => Promise<void>} copyTabUrl
 * @property {(message: string, duration?: number) => void} toast
 */

/**
 * Actions available to the collections feature. Membership changes (expand, tab sort) go
 * straight to the store's write queue; everything that still lives in the legacy runtime is
 * delegated to the injected adapter, which is the only seam between the two UIs
 * (docs/decisions/ADR-0002-collections-list-react.md).
 *
 * @param {Record<string, (...args: any[]) => any>} legacy Adapter injected by the app layer
 * @returns {CollectionActions}
 */
export function useCollectionActions(legacy) {
  return {
    setExpanded: (id, expanded) => mutate((draft) => setCollectionExpanded(draft, id, expanded)),

    setTabSortType: (id, sortType) => mutate((draft) => setTabSortType(draft, id, sortType)),

    pinCollection: (id) => legacy.toggleCollectionPin(id),

    pinTab: (collectionId, tabId) => legacy.toggleTabPin(collectionId, tabId),

    renameCollection: (id, name) => legacy.renameCollection(id, name),

    deleteCollection: (id) => legacy.deleteCollection(id),

    openAllTabs: (id) => legacy.openAllTabs(id),

    addTabs: (id) => legacy.openAddTabs(id),

    importTabs: (id) => legacy.importTabs(id),

    exportCollection: (collection) => legacy.exportCollection(collection),

    removeTab: (collectionId, tabId) => legacy.removeTab(collectionId, tabId),

    renameTab: (collectionId, tabId, title) => legacy.renameTab(collectionId, tabId, title),

    openTab: (url, options) => legacy.openSavedTab(url, options),

    toast: (message, duration) => legacy.toast(message, duration),

    copyCollectionLinks: async (collection) => {
      const tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
      if (tabs.length === 0) {
        legacy.toast('Collection has no tabs to share');
        return;
      }
      const text = tabs.map((tab) => `${tab.title}\n${tab.url}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        legacy.toast('Collection copied to clipboard', 1000);
      } catch (error) {
        console.error('[collections] failed to copy collection links:', error);
        legacy.toast('Failed to copy links');
      }
    },

    copyTabUrl: async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        legacy.toast('Link copied to clipboard', 500);
      } catch (error) {
        console.error('[collections] failed to copy tab link:', error);
        legacy.toast('Failed to copy link');
      }
    },
  };
}
