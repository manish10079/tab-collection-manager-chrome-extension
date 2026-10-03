// Colour administration as store-draft mutators, mirroring `folderDraft.js`/`collectionAdmin.js`:
// pure, so the rules (which ids are assignable, what clearing looks like) are unit-testable.
//
// A colour is a shared grouping key: many folders and many collections may carry the same id, so
// nothing here is unique per colour. `null` means "no colour".
import { isAssignableColor } from '../../../lib/colors.js';

/**
 * Normalise an incoming colour id to `null` (no colour) or the id itself as a string.
 *
 * @param {string|null|undefined} colorId
 * @returns {string|null}
 */
function resolveColor(colorId) {
  if (colorId === null || colorId === undefined || colorId === '') return null;
  return String(colorId);
}

/**
 * Whether `colorId` may be written onto an item in this draft.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string|null|undefined} colorId
 * @returns {boolean}
 */
export function canAssignColor(draft, colorId) {
  return isAssignableColor(resolveColor(colorId), draft.settings.customColors ?? []);
}

/**
 * Set (or clear) a collection's colour label.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} collectionId
 * @param {string|null} colorId
 * @returns {boolean} Whether anything changed
 */
export function setCollectionColor(draft, collectionId, colorId) {
  const collection = draft.collections.find((entry) => entry.id === collectionId);
  if (!collection) return false;

  const next = resolveColor(colorId);
  if (next !== null && !canAssignColor(draft, next)) return false;
  if ((collection.color ?? null) === next) return false;

  collection.color = next;
  collection.updatedAt = Date.now();
  return true;
}

/**
 * Set (or clear) a folder's colour label.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} folderId
 * @param {string|null} colorId
 * @returns {boolean} Whether anything changed
 */
export function setFolderColor(draft, folderId, colorId) {
  const folder = draft.folders.find((entry) => entry.id === folderId);
  if (!folder) return false;

  const next = resolveColor(colorId);
  if (next !== null && !canAssignColor(draft, next)) return false;
  if ((folder.color ?? null) === next) return false;

  folder.color = next;
  folder.updatedAt = Date.now();
  return true;
}
