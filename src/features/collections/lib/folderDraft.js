// Folder administration as store-draft mutators, mirroring `collectionAdmin.js`: pure, so the
// name-uniqueness rules and the "delete a folder, keep its collections" decision are unit-testable.
// Folders are one level deep — a collection points at one via `folderId`, and `null` is the root.
import { LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { partitionCollections } from '../../../lib/sort.js';
import { normalizeName } from './collectionAdmin.js';

/**
 * Whether a folder name is free. Case- and whitespace-insensitive; the folder being renamed is
 * excluded so re-committing the same name is not a clash. Folders and collections have separate
 * name spaces, so a folder may share a name with a collection.
 *
 * @param {import('../../../store/schema.js').Folder[]} folders
 * @param {string} name
 * @param {string|null} [excludeId]
 * @returns {boolean}
 */
export function isFolderNameUnique(folders, name, excludeId = null) {
  const target = normalizeName(name);
  return !folders.some(
    (folder) => folder.id !== excludeId && normalizeName(folder.name) === target
  );
}

/**
 * The next free "New folder" name, so the controls-bar button can create one without a prompt.
 *
 * @param {import('../../../store/schema.js').Folder[]} [folders]
 * @returns {string}
 */
export function nextFolderName(folders = []) {
  const taken = new Set(folders.map((folder) => normalizeName(folder.name)));
  if (!taken.has(normalizeName('New folder'))) return 'New folder';
  let index = 2;
  while (taken.has(normalizeName(`New folder ${index}`))) index += 1;
  return `New folder ${index}`;
}

/**
 * Expand or collapse a folder. The value is written, not toggled, so a late render cannot flip it.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} folderId
 * @param {boolean} expanded
 * @returns {void}
 */
export function setFolderExpanded(draft, folderId, expanded) {
  const folder = draft.folders.find((entry) => entry.id === folderId);
  if (folder) folder.isExpanded = !!expanded;
}

/**
 * Create a folder. New folders open expanded so the user can drop collections into them.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} name
 * @param {string} id
 * @returns {'created'|'empty'|'too-long'|'too-many'|'duplicate'}
 */
export function createFolder(draft, name, id) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > LIMITS.MAX_FOLDER_NAME_LENGTH) return 'too-long';
  if (draft.folders.length >= LIMITS.MAX_FOLDERS) return 'too-many';
  if (!isFolderNameUnique(draft.folders, trimmed)) return 'duplicate';

  draft.folders.push({
    id,
    name: trimmed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isExpanded: true,
  });
  return 'created';
}

/**
 * Rename a folder.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} folderId
 * @param {string} newName
 * @returns {'renamed'|'unchanged'|'empty'|'too-long'|'duplicate'|'missing'}
 */
export function renameFolder(draft, folderId, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > LIMITS.MAX_FOLDER_NAME_LENGTH) return 'too-long';

  const folder = draft.folders.find((entry) => entry.id === folderId);
  if (!folder) return 'missing';
  if (normalizeName(folder.name) === normalizeName(trimmed)) return 'unchanged';
  if (!isFolderNameUnique(draft.folders, trimmed, folderId)) return 'duplicate';

  folder.name = trimmed;
  folder.updatedAt = Date.now();
  return 'renamed';
}

/**
 * Delete a folder **and the collections inside it**. A folder is a container the user asked to
 * remove, so its contents go with it — the confirm dialog says so before anything is lost.
 *
 * Auto-Save is pointed at nothing when its target was inside the folder.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} folderId
 * @returns {{deleted: boolean, removedCollections: number}}
 */
export function deleteFolder(draft, folderId) {
  const index = draft.folders.findIndex((entry) => entry.id === folderId);
  if (index === -1) return { deleted: false, removedCollections: 0 };

  draft.folders.splice(index, 1);

  const removedCollections = [];
  draft.collections = draft.collections.filter((collection) => {
    if ((collection.folderId ?? null) !== folderId) return true;
    removedCollections.push(collection);
    return false;
  });
  draft.collections = partitionCollections(draft.collections);

  if (
    draft.settings.autoSaveCollectionId &&
    removedCollections.some((collection) => collection.id === draft.settings.autoSaveCollectionId)
  ) {
    draft.settings.autoSaveCollectionId = null;
  }

  return { deleted: true, removedCollections: removedCollections.length };
}

/**
 * Move a collection into a folder, or back to the root with `folderId = null`.
 *
 * Current Session is refused: it is a live mirror that always sits first at the root.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string|null} folderId
 * @returns {boolean} Whether the collection moved
 */
export function moveCollectionToFolder(draft, collectionId, folderId) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection || collection.id === CURRENT_SESSION_ID) return false;

  const next = folderId === null || folderId === undefined ? null : String(folderId);
  if (next !== null && !draft.folders.some((folder) => folder.id === next)) return false;
  if ((collection.folderId ?? null) === next) return false;

  collection.folderId = next;
  collection.updatedAt = Date.now();
  return true;
}
