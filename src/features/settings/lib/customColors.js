// Custom colour management as store-draft mutators, pure so the add/remove rules are unit-testable.
// The palette is a single setting (`customColors`); removing an entry also clears it from every
// folder and collection that used it, so the list can never point at a colour that is gone.
import { appendCustomColor, clearColorEverywhere } from '../../../lib/colors.js';

/**
 * Add a custom colour to the palette. `id` is supplied by the caller (the action layer), keeping
 * this pure. The rules live in `lib/colors.js` so the folder/collection colour menus can add through
 * the same code path.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} name
 * @param {unknown} value
 * @param {string} id
 * @returns {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'}
 */
export function addCustomColor(draft, name, value, id) {
  return appendCustomColor(draft, name, value, id);
}

/**
 * Remove a custom colour and unlabel everything that carried it.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} id
 * @returns {boolean} Whether a colour was removed
 */
export function removeCustomColor(draft, id) {
  const list = draft.settings.customColors ?? [];
  if (!list.some((color) => color.id === id)) return false;

  draft.settings.customColors = list.filter((color) => color.id !== id);
  clearColorEverywhere(draft, id);
  return true;
}
