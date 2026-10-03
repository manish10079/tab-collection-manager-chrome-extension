// Custom colour management as store-draft mutators, pure so the add/remove rules are unit-testable.
// The palette is a single setting (`customColors`); removing an entry also clears it from every
// folder and collection that used it, so the list can never point at a colour that is gone.
import { clearColorEverywhere, normalizeHex, validateCustomColor } from '../../../lib/colors.js';

/**
 * Add a custom colour. `id` is supplied by the caller (the action layer), keeping this pure.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {string} name
 * @param {unknown} value
 * @param {string} id
 * @returns {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'}
 */
export function addCustomColor(draft, name, value, id) {
  const list = draft.settings.customColors ?? [];
  const outcome = validateCustomColor(list, name, value);
  if (outcome !== 'ok') return outcome;

  draft.settings.customColors = [
    ...list,
    { id, name: String(name).trim(), value: normalizeHex(value) },
  ];
  return 'added';
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
