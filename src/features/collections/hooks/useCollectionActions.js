import { getSnapshot, mutate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { downloadJson } from '../../../lib/download.js';
import { formatFileTimestamp } from '../../../lib/format.js';
import { deleteCollection, renameCollection } from '../lib/collectionAdmin.js';
import { reorderCollections, setCollectionExpanded } from '../lib/collectionDraft.js';
import { deleteSelection, describeSelection, summarizeSelection } from '../lib/bulkDelete.js';
import { useColorActions } from './useColorActions.js';
import { useFolderActions } from './useFolderActions.js';
import { usePinActions } from './usePinActions.js';
import { useTabActions } from './useTabActions.js';

/**
 * @typedef {object} CollectionActions
 * @property {(id: string, expanded: boolean) => Promise<void>} setExpanded
 * @property {(id: string, sortType: string) => Promise<void>} setTabSortType
 * @property {(id: string, expanded: boolean) => Promise<void>} setFolderExpanded
 * @property {(name: string) => Promise<'created'|'empty'|'too-long'|'too-many'|'duplicate'>} createFolder
 * @property {(id: string, name: string) => Promise<boolean>} renameFolder
 * @property {(id: string) => Promise<void>} deleteFolder
 * @property {(selection: import('../lib/bulkDelete.js').Selection) => Promise<boolean>} deleteMany
 * @property {(collectionId: string, folderId: string|null) => Promise<void>} moveCollectionToFolder
 * @property {(id: string, colorId: string|null) => Promise<void>} setCollectionColor
 * @property {(id: string, colorId: string|null) => Promise<void>} setFolderColor
 * @property {(kind: 'collection'|'folder', id: string, name: string, value: string) => Promise<'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'>} labelWithNewColor
 * @property {(id: string) => void} pinCollection
 * @property {(collectionId: string, tabId: string) => void} pinTab
 * @property {(id: string, name: string) => Promise<boolean>} renameCollection
 * @property {(id: string) => void} deleteCollection
 * @property {(id: string) => Promise<void>} openAllTabs
 * @property {(id: string) => void} addTabs
 * @property {(id: string) => Promise<void>} importTabs
 * @property {(collection: import('../../../store/schema.js').Collection) => void} exportCollection
 * @property {(collection: import('../../../store/schema.js').Collection) => Promise<void>} copyCollectionLinks
 * @property {(sourceId: string, targetId: string) => Promise<void>} moveCollection
 * @property {(collectionId: string, sourceTabId: string, targetTabId: string) => Promise<void>} reorderTabs
 * @property {(tabId: string, sourceCollectionId: string, targetCollectionId: string) => Promise<{moved: boolean}>} moveTab
 * @property {(tabId: string, sourceCollectionId: string, targetCollectionId: string, targetTabId: string) => Promise<{moved: boolean}>} moveTabToPosition
 * @property {(collectionId: string, tabId: string) => void} removeTab
 * @property {(collectionId: string, tabId: string, title: string) => void} renameTab
 * @property {(url: string, options?: {active?: boolean}) => Promise<void>} openTab
 * @property {(url: string) => Promise<void>} copyTabUrl
 * @property {(message: string, duration?: number) => void} toast
 */

/**
 * Actions available to the collections feature.
 *
 * The capability groups live in their own hooks — `useTabActions`, `useFolderActions`,
 * `useColorActions` and `usePinActions` — and this composes them with the collection-level actions
 * and the bulk delete, which spans folders and collections and so belongs to neither. Callers still
 * take one object, so the composition is invisible to them.
 *
 * Every action is React-owned since Phase 5.1: state changes go through the store's write queue,
 * opening and restoring tabs is a `chrome.tabs` / `chrome.runtime` call in `useTabActions`, and the
 * two handlers the app layer owns (`addTabs`, `importTabs` — they are dialogs) plus `toast` arrive
 * by injection. `src/app/legacy-ui.js` disappeared with this change.
 *
 * @param {object} deps Injected by the app layer
 * @param {(message: string, duration?: number) => void} deps.toast
 * @param {(id: string) => void} deps.addTabs
 * @param {(id: string) => Promise<void>} deps.importTabs
 * @returns {CollectionActions}
 */
export function useCollectionActions({ toast, addTabs, importTabs }) {
  const tabs = useTabActions({ toast, addTabs, importTabs });
  const folders = useFolderActions({ toast });
  const colors = useColorActions({ toast });
  const pins = usePinActions({ toast });

  return {
    setExpanded: (id, expanded) => mutate((draft) => setCollectionExpanded(draft, id, expanded)),

    setTabSortType: tabs.setTabSortType,

    setFolderExpanded: folders.setFolderExpanded,

    createFolder: folders.createFolder,

    renameFolder: folders.renameFolder,

    deleteFolder: folders.deleteFolder,

    /**
     * Delete everything the user checked in selection mode, in one write. A folder takes its
     * collections with it; the confirm names exactly what will go. It lives here rather than in
     * either group because a selection can mix both.
     *
     * @returns {Promise<boolean>} Whether anything was deleted.
     */
    deleteMany: async ({ folderIds = [], collectionIds = [] } = {}) => {
      const summary = summarizeSelection(getSnapshot(), { folderIds, collectionIds });
      if (summary.folders + summary.collections === 0) return false;
      if (!window.confirm(describeSelection(summary))) return false;

      let result = { removedFolders: 0, removedCollections: 0 };
      await mutate((draft) => {
        result = deleteSelection(draft, { folderIds, collectionIds });
      });
      const bits = [];
      if (result.removedFolders > 0)
        bits.push(`${result.removedFolders} folder${result.removedFolders === 1 ? '' : 's'}`);
      if (result.removedCollections > 0)
        bits.push(
          `${result.removedCollections} collection${result.removedCollections === 1 ? '' : 's'}`
        );
      toast(bits.length > 0 ? `Deleted ${bits.join(' and ')}` : 'Nothing to delete');
      return true;
    },

    moveCollectionToFolder: folders.moveCollectionToFolder,

    setCollectionColor: colors.setCollectionColor,

    setFolderColor: colors.setFolderColor,

    labelWithNewColor: colors.labelWithNewColor,

    pinCollection: pins.pinCollection,

    pinTab: pins.pinTab,

    /** @returns {Promise<boolean>} Whether the rename stuck — the card keeps its draft otherwise. */
    renameCollection: async (id, name) => {
      /** @type {'renamed'|'unchanged'|'current-session'|'empty'|'too-long'|'duplicate'|'missing'} */
      let outcome = 'missing';
      await mutate((draft) => {
        outcome = renameCollection(draft, id, name);
      });

      if (outcome === 'current-session') {
        toast('The Current Session collection cannot be renamed.');
        return false;
      }
      if (outcome === 'too-long') {
        toast(`Collection name cannot exceed ${LIMITS.MAX_COLLECTION_NAME_LENGTH} characters.`);
        return false;
      }
      if (outcome === 'duplicate') {
        toast(`Collection name "${String(name).trim()}" already exists.`);
        return false;
      }
      // 'empty' is already filtered by the card; 'missing'/'unchanged' need no message.
      return outcome === 'renamed' || outcome === 'unchanged';
    },

    deleteCollection: async (id) => {
      if (!window.confirm('Are you sure you want to remove this collection?')) return;
      await mutate((draft) => {
        deleteCollection(draft, id);
      });
    },

    openAllTabs: tabs.openAllTabs,

    addTabs: tabs.addTabs,

    importTabs: tabs.importTabs,

    exportCollection: (collection) => {
      const tabsInCollection = Array.isArray(collection.tabs) ? collection.tabs : [];
      if (tabsInCollection.length === 0) {
        toast('No tabs to export in this collection.');
        return;
      }

      const filename = `${String(collection.name)
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()}_tabs_${formatFileTimestamp()}.json`;
      downloadJson(
        {
          collectionId: collection.id,
          collectionName: collection.name,
          exportedAt: new Date().toISOString(),
          tabs: tabsInCollection,
        },
        filename
      );
      toast('Collection exported successfully');
    },

    copyCollectionLinks: async (collection) => {
      const tabsInCollection = Array.isArray(collection.tabs) ? collection.tabs : [];
      if (tabsInCollection.length === 0) {
        toast('Collection has no tabs to share');
        return;
      }
      const text = tabsInCollection.map((tab) => `${tab.title}\n${tab.url}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('Collection copied to clipboard', 1000);
      } catch (error) {
        console.error('[collections] failed to copy collection links:', error);
        toast('Failed to copy links');
      }
    },

    moveCollection: (sourceId, targetId) =>
      mutate((draft) => reorderCollections(draft, sourceId, targetId)),

    reorderTabs: tabs.reorderTabs,

    moveTab: tabs.moveTab,

    moveTabToPosition: tabs.moveTabToPosition,

    removeTab: tabs.removeTab,

    renameTab: tabs.renameTab,

    openTab: tabs.openTab,

    copyTabUrl: tabs.copyTabUrl,

    toast: (message, duration) => toast(message, duration),
  };
}
