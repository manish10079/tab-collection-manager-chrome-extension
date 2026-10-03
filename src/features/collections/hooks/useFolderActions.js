import { getSnapshot, mutate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { useConfirm } from '../../../app/providers/useConfirm.js';
import {
  createFolder,
  deleteFolder,
  moveCollectionToFolder,
  renameFolder,
  setFolderExpanded,
} from '../lib/folderDraft.js';

/**
 * @typedef {object} FolderActions
 * @property {(id: string, expanded: boolean) => Promise<void>} setFolderExpanded
 * @property {(name: string) => Promise<'created'|'empty'|'too-long'|'too-many'|'duplicate'>} createFolder
 * @property {(id: string, name: string) => Promise<boolean>} renameFolder
 * @property {(id: string) => Promise<void>} deleteFolder
 * @property {(collectionId: string, folderId: string|null) => Promise<void>} moveCollectionToFolder
 */

/**
 * Folders: expanding one, creating, renaming and deleting, and moving a collection in or out.
 *
 * A create or rename can be refused (the name rules), so those return the mutator's verdict for the
 * caller to show; a delete asks first and reports how many collections went with it.
 *
 * @param {{toast: (message: string, duration?: number) => void}} deps Injected by the app layer
 * @returns {FolderActions}
 */
export function useFolderActions({ toast }) {
  const confirm = useConfirm();

  return {
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
      const proceed = await confirm({
        title: 'Delete Folder',
        message: warning,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!proceed) return;

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

    moveCollectionToFolder: (collectionId, folderId) =>
      mutate((draft) => moveCollectionToFolder(draft, collectionId, folderId)),
  };
}
