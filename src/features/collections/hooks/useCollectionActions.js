import { getSnapshot, mutate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { toOpenableUrl } from '../../../lib/url.js';
import { discardWhenLoaded } from '../../../lib/tabs.js';
import { formatFileTimestamp } from '../../../lib/format.js';
import {
  deleteCollection,
  removeTab,
  renameCollection,
  renameTab,
  toggleCollectionPin,
  toggleTabPin,
} from '../lib/collectionAdmin.js';
import {
  moveTabToCollection,
  moveTabToCollectionAtPosition,
  reorderCollections,
  reorderTabsWithinCollection,
  setCollectionExpanded,
  setTabSortType,
} from '../lib/collectionDraft.js';
import {
  createFolder,
  deleteFolder,
  moveCollectionToFolder,
  renameFolder,
  setFolderExpanded,
} from '../lib/folderDraft.js';
import { deleteSelection, describeSelection, summarizeSelection } from '../lib/bulkDelete.js';

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
 * Every action is React-owned since Phase 5.1: state changes go through the store's write queue,
 * opening and restoring tabs is a `chrome.tabs` / `chrome.runtime` call here, and the two handlers
 * the app layer owns (`addTabs`, `importTabs` — they are dialogs) plus `toast` arrive by injection.
 * `src/app/legacy-ui.js` disappeared with this change.
 *
 * @param {object} deps Injected by the app layer
 * @param {(message: string, duration?: number) => void} deps.toast
 * @param {(id: string) => void} deps.addTabs
 * @param {(id: string) => Promise<void>} deps.importTabs
 * @returns {CollectionActions}
 */
export function useCollectionActions({ toast, addTabs, importTabs }) {
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

  /**
   * Toggle a pin through the queue and report a refused limit. The mutator decides, so the rule
   * lives with the state rather than with the click.
   *
   * @param {(draft: import('../../../store/schema.js').AppState) => {changed: boolean, limitReached: boolean, limit: number}} mutator
   * @param {(limit: number) => string} limitMessage
   */
  async function runPinToggle(mutator, limitMessage) {
    let result = { changed: false, limitReached: false, limit: 0 };
    await mutate((draft) => {
      result = mutator(draft);
    });
    if (result.limitReached) toast(limitMessage(result.limit));
  }

  return {
    setExpanded: (id, expanded) => mutate((draft) => setCollectionExpanded(draft, id, expanded)),

    setTabSortType: (id, sortType) => mutate((draft) => setTabSortType(draft, id, sortType)),

    pinCollection: (id) =>
      runPinToggle(
        (draft) => toggleCollectionPin(draft, id),
        (limit) =>
          `Maximum of ${limit} pinned collections reached. Raise the limit or disable it in Settings.`
      ),

    pinTab: (collectionId, tabId) =>
      runPinToggle(
        (draft) => toggleTabPin(draft, collectionId, tabId),
        (limit) =>
          `Maximum of ${limit} pinned tabs per collection reached. Raise the limit or disable it in Settings.`
      ),

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

    exportCollection: (collection) => {
      const tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
      if (tabs.length === 0) {
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
          tabs,
        },
        filename
      );
      toast('Collection exported successfully');
    },

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

    moveCollection: (sourceId, targetId) =>
      mutate((draft) => reorderCollections(draft, sourceId, targetId)),

    setFolderExpanded: (id, expanded) => mutate((draft) => setFolderExpanded(draft, id, expanded)),

    /** @returns {Promise<'created'|'empty'|'too-long'|'too-many'|'duplicate'>} */
    createFolder: async (name) => {
      /** @type {'created'|'empty'|'too-long'|'too-many'|'duplicate'} */
      let outcome = 'empty';
      await mutate((draft) => {
        outcome = createFolder(draft, name, crypto.randomUUID());
      });
      return outcome;
    },

    /** @returns {Promise<boolean>} Whether the rename stuck — the section keeps its draft otherwise. */
    renameFolder: async (id, name) => {
      /** @type {'renamed'|'unchanged'|'empty'|'too-long'|'duplicate'|'missing'} */
      let outcome = 'missing';
      await mutate((draft) => {
        outcome = renameFolder(draft, id, name);
      });

      if (outcome === 'too-long') {
        toast(`Folder name cannot exceed ${LIMITS.MAX_FOLDER_NAME_LENGTH} characters.`);
        return false;
      }
      if (outcome === 'duplicate') {
        toast(`Folder name "${String(name).trim()}" already exists.`);
        return false;
      }
      return outcome === 'renamed' || outcome === 'unchanged';
    },

    deleteFolder: async (id) => {
      const folder = getSnapshot().folders.find((entry) => entry.id === id);
      if (!folder) return;
      const nested = getSnapshot().collections.filter((entry) => entry.folderId === id).length;
      const warning =
        nested > 0
          ? `Delete "${folder.name}" and the ${nested} collection${nested === 1 ? '' : 's'} inside it? This cannot be undone.`
          : `Delete the folder "${folder.name}"?`;
      if (!window.confirm(warning)) return;

      let removed = 0;
      await mutate((draft) => {
        removed = deleteFolder(draft, id).removedCollections;
      });
      toast(
        removed > 0
          ? `Folder deleted — ${removed} collection${removed === 1 ? '' : 's'} removed with it.`
          : 'Folder deleted'
      );
    },

    /**
     * Delete everything the user checked in selection mode, in one write. A folder takes its
     * collections with it; the confirm names exactly what will go.
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

    moveCollectionToFolder: (collectionId, folderId) =>
      mutate((draft) => moveCollectionToFolder(draft, collectionId, folderId)),

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

    copyCollectionLinks: async (collection) => {
      const tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
      if (tabs.length === 0) {
        toast('Collection has no tabs to share');
        return;
      }
      const text = tabs.map((tab) => `${tab.title}\n${tab.url}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('Collection copied to clipboard', 1000);
      } catch (error) {
        console.error('[collections] failed to copy collection links:', error);
        toast('Failed to copy links');
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

    toast: (message, duration) => toast(message, duration),
  };
}

/**
 * Save a JSON payload through a temporary object URL. The legacy code did this inline in two
 * places (`exportCollection`, `exportAllCollections`); it lives here because it touches `document`.
 *
 * @param {unknown} payload
 * @param {string} filename
 */
function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
