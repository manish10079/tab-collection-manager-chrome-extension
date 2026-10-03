// Colour administration as store-draft mutators, mirroring `folderDraft.js`/`collectionAdmin.js`:
// pure, so the rules (which ids are assignable, what clearing looks like) are unit-testable.
//
// A colour is a shared grouping key: many folders and many collections may carry the same id, so
// nothing here is unique per colour. `null` means "no colour". A menu can also mint a brand-new
// colour and label its item with it in one step (`addAndAssignColor`), which is what keeps the
// palette and the label from drifting apart.
import { appendCustomColor, isAssignableColor } from '../../../lib/colors.js';

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

/**
 * Create a custom colour from a folder/collection menu and label that one item with it, in a single
 * draft. Adding the colour and applying it happen together so they cannot come apart: a colour made
 * from a menu always ends up on the item whose menu it came from, and the palette gains it exactly
 * once. The id is supplied by the caller (the action layer), keeping this pure.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {{kind: 'collection'|'folder', id: string}} target
 * @param {string} name
 * @param {unknown} value
 * @param {string} colorId
 * @returns {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'}
 */
export function addAndAssignColor(draft, target, name, value, colorId) {
  const outcome = appendCustomColor(draft, name, value, colorId);
  if (outcome !== 'added') return outcome;

  // The new palette entry is already on the draft, so the assignment below always accepts the id.
  if (target.kind === 'folder') setFolderColor(draft, target.id, colorId);
  else setCollectionColor(draft, target.id, colorId);

  return 'added';
}
