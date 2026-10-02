import { useCallback, useState } from 'react';
import { getSnapshot, mutate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { formatFileTimestamp } from '../../../lib/format.js';
import { downloadJson } from '../../../lib/download.js';
import {
  createCollection,
  createFolder,
  nextFolderName,
  setCollectionExpanded,
} from '../../collections/index.js';
import {
  buildCollectionsExport,
  extractImportedCollections,
  extractImportedFolders,
  isValidImportedCollection,
  mergeImportedCollections,
} from '../lib/globalBackup.js';
import { readJsonFile } from '../lib/readJsonFile.js';
import { scrollIntoView } from '../lib/scrollIntoView.js';

/**
 * @typedef {'search'|'create'|null} ShellSlide
 */

/**
 * @typedef {object} ShellController
 * @property {ShellSlide} slide            Which controls-bar input is open, if any
 * @property {string} query                Global search text
 * @property {string} createName           New-collection name draft
 * @property {() => void} toggleSearch
 * @property {() => void} closeSearch
 * @property {() => void} toggleCreate
 * @property {() => void} closeCreate
 * @property {(value: string) => void} setQuery
 * @property {(value: string) => void} setCreateName
 * @property {() => Promise<boolean>} submitCreate
 * @property {() => Promise<boolean>} createFolder
 * @property {() => void} toggleLayout
 * @property {(sortType: string) => void} setCollectionSort
 * @property {() => Promise<void>} exportAll
 * @property {() => Promise<void>} importAll
 * @property {() => Promise<void>} restoreBackup
 * @property {() => Promise<void>} expandAll
 * @property {() => Promise<void>} expandCurrentSession
 * @property {(n: number) => void} jumpToCollection
 * @property {(id: string) => void} openCollection
 * @property {() => boolean} closeOverlays
 * @property {() => void} closePanel
 */

/**
 * Everything the controls bar and the global shortcuts need. UI state (which slide is open, the
 * query, the create draft) lives here; every data change goes through the store's write queue, and
 * a refusal that used to be an `alert()` is a toast.
 *
 * @param {object} deps
 * @param {(message: string, duration?: number) => void} deps.toast
 * @returns {ShellController}
 */
export function useShellController({ toast }) {
  const [slide, setSlide] = useState(/** @type {ShellSlide} */ (null));
  const [query, setQuery] = useState('');
  const [createName, setCreateName] = useState('');

  const toggleSearch = useCallback(() => {
    if (slide === 'search') {
      setQuery('');
      setSlide(null);
    } else {
      setCreateName('');
      setSlide('search');
    }
  }, [slide]);

  const closeSearch = useCallback(() => {
    setQuery('');
    setSlide(null);
  }, []);

  const toggleCreate = useCallback(() => {
    if (slide === 'create') {
      setCreateName('');
      setSlide(null);
    } else {
      setQuery('');
      setSlide('create');
    }
  }, [slide]);

  const closeCreate = useCallback(() => {
    setCreateName('');
    setSlide(null);
  }, []);

  const submitCreate = useCallback(async () => {
    let outcome = /** @type {'created'|'empty'|'too-long'|'duplicate'} */ ('empty');
    const name = createName;
    await mutate((draft) => {
      outcome = createCollection(draft, name, crypto.randomUUID());
    });

    if (outcome === 'created') {
      setCreateName('');
      setSlide(null);
      return true;
    }
    if (outcome === 'too-long') {
      toast(`Collection name cannot exceed ${LIMITS.MAX_COLLECTION_NAME_LENGTH} characters.`);
    } else if (outcome === 'duplicate') {
      toast(`Collection name "${name.trim()}" already exists.`);
    }
    return false;
  }, [createName, toast]);

  /**
   * Create a folder straight away with the next free default name; the section opens expanded and
   * its name is edited inline, so there is no separate prompt or slide to build.
   */
  const createFolderAction = useCallback(async () => {
    let outcome = /** @type {'created'|'empty'|'too-long'|'too-many'|'duplicate'} */ ('empty');
    let name = '';
    await mutate((draft) => {
      name = nextFolderName(draft.folders);
      outcome = createFolder(draft, name, crypto.randomUUID());
    });

    if (outcome === 'created') {
      toast(`Folder "${name}" created`);
      return true;
    }
    if (outcome === 'too-many') toast(`Cannot add more than ${LIMITS.MAX_FOLDERS} folders.`);
    else if (outcome === 'duplicate') toast(`Folder "${name}" already exists.`);
    return false;
  }, [toast]);

  const toggleLayout = useCallback(() => {
    mutate((draft) => {
      draft.settings.layoutViewMode = draft.settings.layoutViewMode === 'grid' ? 'list' : 'grid';
    });
  }, []);

  const setCollectionSort = useCallback((sortType) => {
    mutate((draft) => {
      draft.settings.collectionSortType = sortType;
    });
  }, []);

  const exportAll = useCallback(async () => {
    const { collections, folders } = getSnapshot();
    if (collections.length === 0) {
      toast('No collections to export.');
      return;
    }
    downloadJson(
      buildCollectionsExport(collections, folders),
      `tab_collections_backup_${formatFileTimestamp()}.json`
    );
    toast('All collections exported successfully');
  }, [toast]);

  const importAll = useCallback(async () => {
    const result = await readJsonFile();
    if (!result) return;
    if (!result.ok) {
      toast('Failed to parse file. Make sure it is a valid JSON file.');
      return;
    }

    const imported = extractImportedCollections(result.data);
    if (!imported) {
      toast(
        'Invalid format. File must contain an array of collections or a collections backup object.'
      );
      return;
    }

    const valid = imported.filter(isValidImportedCollection);
    if (valid.length === 0) {
      toast('No valid collections found in the file.');
      return;
    }

    const importedFolders = extractImportedFolders(result.data);
    let outcome = { added: 0, merged: 0, skipped: 0 };
    await mutate((draft) => {
      outcome = mergeImportedCollections(draft, valid, importedFolders);
    });
    toast(`Import completed: Created ${outcome.added} and merged ${outcome.merged} collections.`);
  }, [toast]);

  const restoreBackup = useCallback(async () => {
    const backup = getSnapshot().lastSessionBackup;
    if (!backup || !Array.isArray(backup.tabs) || backup.tabs.length === 0) return;
    if (!window.confirm(`Restore ${backup.tabs.length} tabs from backup?`)) return;

    try {
      await chrome.runtime.sendMessage({
        command: 'restoreSession',
        collectionId: backup.collectionId,
        backupData: backup,
      });
      toast('Restoring session…');
    } catch (error) {
      console.error('[shell] failed to restore backup:', error);
      toast('Could not restore that session.');
    }
  }, [toast]);

  const expandAll = useCallback(async () => {
    const { collections } = getSnapshot();
    if (collections.length === 0) {
      toast('No collections to expand');
      return;
    }

    const expand = collections.some((collection) => !collection.isExpanded);
    await mutate((draft) => {
      draft.collections.forEach((collection) => {
        collection.isExpanded = expand;
      });
    });
    toast(expand ? 'All collections expanded' : 'All collections collapsed', 1500);
  }, [toast]);

  const expandCurrentSession = useCallback(async () => {
    const exists = getSnapshot().collections.some(
      (collection) => collection.id === CURRENT_SESSION_ID
    );
    if (!exists) {
      toast('Current Session not found');
      return;
    }

    await mutate((draft) => {
      draft.collections.forEach((collection) => {
        collection.isExpanded = collection.id === CURRENT_SESSION_ID;
      });
    });
    toast('Current Session expanded', 1200);
  }, [toast]);

  const jumpToCollection = useCallback(
    (n) => {
      const cards = Array.from(document.querySelectorAll('#collectionsContainer > .collection'));
      const target = cards[n - 1];
      if (!target) {
        toast(`Collection ${n} not found`);
        return;
      }

      const targetId = target.dataset.id;
      scrollIntoView(target, { behavior: 'smooth', block: 'nearest' });
      target.classList.add('shortcut-jump-highlight');
      // Re-query by id when removing, so the highlight survives a re-render in between.
      setTimeout(() => {
        const el = document.querySelector(
          `#collectionsContainer > .collection[data-id="${targetId}"]`
        );
        if (el) el.classList.remove('shortcut-jump-highlight');
      }, 1200);
    },
    [toast]
  );

  const openCollection = useCallback((id) => {
    setQuery('');
    setSlide(null);
    mutate((draft) => setCollectionExpanded(draft, id, true));
    setTimeout(() => {
      const el = document.querySelector(`#collectionsContainer > .collection[data-id="${id}"]`);
      scrollIntoView(el, { behavior: 'smooth', block: 'center' });
    }, 60);
  }, []);

  /** Escape: close the open slide first, then let the menus close themselves. */
  const closeOverlays = useCallback(() => {
    if (slide === null) return false;
    setSlide(null);
    setQuery('');
    setCreateName('');
    return true;
  }, [slide]);

  const closePanel = useCallback(() => {
    document.body.classList.add('panel-closing');
    setTimeout(() => window.close(), 220);
  }, []);

  return {
    slide,
    query,
    createName,
    toggleSearch,
    closeSearch,
    toggleCreate,
    closeCreate,
    setQuery,
    setCreateName,
    submitCreate,
    createFolder: createFolderAction,
    toggleLayout,
    setCollectionSort,
    exportAll,
    importAll,
    restoreBackup,
    expandAll,
    expandCurrentSession,
    jumpToCollection,
    openCollection,
    closeOverlays,
    closePanel,
  };
}
