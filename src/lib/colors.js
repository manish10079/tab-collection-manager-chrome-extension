// Colour labels as pure data and rules (skill.md §3.3 — `lib/` touches no `chrome.*`).
//
// A colour is a shared grouping key, not a property of one item: the same colour id can label any
// number of folders and collections, and the panel can filter to every item carrying it. Ten
// built-in colours are always available and cannot be edited or removed; the user may add custom
// colours on top of them. Storage keeps only the colour *id* on a folder/collection, so the palette
// itself (names and swatch values) stays in one place.
import { LIMITS } from '../shared/constants.js';

/** The filter id an uncoloured folder or collection reports. */
export const NO_COLOR = 'none';

/**
 * The ten built-in colours. `token` is the `tokens.css` custom property a swatch paints with, so
 * these values never leak a literal outside the token file (css-migration-plan.md, §2).
 *
 * @type {ReadonlyArray<{id: string, name: string, token: string}>}
 */
export const BUILT_IN_COLORS = Object.freeze([
  { id: 'red', name: 'Red', token: '--swatch-red' },
  { id: 'orange', name: 'Orange', token: '--swatch-orange' },
  { id: 'amber', name: 'Amber', token: '--swatch-amber' },
  { id: 'green', name: 'Green', token: '--swatch-green' },
  { id: 'teal', name: 'Teal', token: '--swatch-teal' },
  { id: 'blue', name: 'Blue', token: '--swatch-blue' },
  { id: 'indigo', name: 'Indigo', token: '--swatch-indigo' },
  { id: 'purple', name: 'Purple', token: '--swatch-purple' },
  { id: 'pink', name: 'Pink', token: '--swatch-pink' },
  { id: 'gray', name: 'Gray', token: '--swatch-gray' },
]);

/** The fallback a swatch paints with when it has no colour of its own. */
export const NEUTRAL_SWATCH = 'var(--swatch-neutral)';

/**
 * A `#rrggbb` string, lower-cased, or `''` when the input is not a usable colour. Lower-casing means
 * two spellings of one colour compare equal.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHex(value) {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '';
}

/**
 * Coerce a persisted `customColors` value into well-formed entries. Anything unexpected is dropped
 * rather than trusted (skill.md §5.1).
 *
 * @param {unknown} value
 * @returns {Array<{id: string, name: string, value: string}>}
 */
export function normalizeCustomColors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: String(/** @type {Record<string, unknown>} */ (entry).id ?? ''),
      name: String(/** @type {Record<string, unknown>} */ (entry).name ?? '').trim(),
      value: normalizeHex(/** @type {Record<string, unknown>} */ (entry).value),
    }))
    .filter((entry) => entry.id !== '' && entry.name !== '' && entry.value !== '');
}

/** @param {string} id @returns {boolean} Whether the id names a built-in colour. */
export function isBuiltInColor(id) {
  return BUILT_IN_COLORS.some((color) => color.id === id);
}

/**
 * The built-in colours followed by the user's custom ones, in the order they are shown.
 *
 * @param {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @returns {Array<{id: string, name: string, value?: string, token?: string}>}
 */
export function allColors(customColors = []) {
  return [...BUILT_IN_COLORS, ...customColors];
}

/**
 * The colour a given id names, or null for `null`/`NO_COLOR`/an unknown id.
 *
 * @param {string|null|undefined} id
 * @param {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @returns {{id: string, name: string, value?: string, token?: string}|null}
 */
export function findColor(id, customColors = []) {
  if (!id || id === NO_COLOR) return null;
  return allColors(customColors).find((color) => color.id === id) ?? null;
}

/**
 * The CSS value a swatch for `id` paints with — the built-in token, a custom colour's hex, or the
 * neutral fallback for an id that is set but no longer exists.
 *
 * @param {string|null|undefined} id
 * @param {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @returns {string}
 */
export function swatchValue(id, customColors = []) {
  const color = findColor(id, customColors);
  if (!color) return NEUTRAL_SWATCH;
  return color.token ? `var(${color.token})` : (color.value ?? NEUTRAL_SWATCH);
}

/**
 * The display name of a colour id, for a tooltip. An unknown id reads as "No color".
 *
 * @param {string|null|undefined} id
 * @param {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @returns {string}
 */
export function colorName(id, customColors = []) {
  return findColor(id, customColors)?.name ?? 'No color';
}

/**
 * Whether a colour id may be written onto a folder/collection: nothing, a built-in, or a custom
 * colour that still exists. A removed custom colour can no longer be assigned.
 *
 * @param {string|null|undefined} id
 * @param {Array<{id: string, name: string}>} [customColors]
 * @returns {boolean}
 */
export function isAssignableColor(id, customColors = []) {
  // `null`/`''`/`NO_COLOR` all mean "no colour", which is always allowed.
  if (id === null || id === undefined || id === '' || id === NO_COLOR) return true;
  return isBuiltInColor(id) || customColors.some((color) => color.id === id);
}

/**
 * The filter key an item reports: its colour id, or `NO_COLOR` when it has none.
 *
 * @param {{color?: string|null}} item
 * @returns {string}
 */
export function colorKey(item) {
  return item?.color ?? NO_COLOR;
}

/**
 * Clear a colour id everywhere it is assigned, so deleting a custom colour cannot leave a folder or
 * collection pointing at a palette entry that no longer exists.
 *
 * @param {{collections: Array<{color?: string|null}>, folders: Array<{color?: string|null}>}} draft
 * @param {string} colorId
 * @returns {number} How many folders/collections were cleared
 */
export function clearColorEverywhere(draft, colorId) {
  let cleared = 0;
  for (const collection of draft.collections) {
    if (collection.color === colorId) {
      collection.color = null;
      cleared += 1;
    }
  }
  for (const folder of draft.folders) {
    if (folder.color === colorId) {
      folder.color = null;
      cleared += 1;
    }
  }
  return cleared;
}

/**
 * Why a new custom colour would be refused, or `'ok'`. Names are unique case-insensitively across
 * the built-ins and the custom list, so a picker can never show two identical labels.
 *
 * @param {Array<{id: string, name: string}>} customColors
 * @param {string} name
 * @param {unknown} value
 * @returns {'ok'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'}
 */
export function validateCustomColor(customColors, name, value) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > LIMITS.MAX_CUSTOM_COLOR_NAME_LENGTH) return 'too-long';
  if (!normalizeHex(value)) return 'invalid';
  const taken = allColors(customColors).some(
    (color) => color.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (taken) return 'duplicate';
  if (customColors.length >= LIMITS.MAX_CUSTOM_COLORS) return 'too-many';
  return 'ok';
}

/**
 * Append a custom colour to the palette, refusing one that fails validation. The id is supplied by
 * the caller (the action layer) so this stays deterministic and testable. Both the Settings card and
 * the folder/collection colour menus add through here, so the two can never disagree on the rules.
 *
 * @param {{settings: {customColors?: Array<{id: string, name: string, value: string}>}}} draft
 * @param {string} name
 * @param {unknown} value
 * @param {string} id
 * @returns {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'}
 */
export function appendCustomColor(draft, name, value, id) {
  const list = draft.settings.customColors ?? [];
  const outcome = validateCustomColor(list, name, value);
  if (outcome !== 'ok') return outcome;

  draft.settings.customColors = [
    ...list,
    { id, name: String(name).trim(), value: normalizeHex(value) },
  ];
  return 'added';
}

/** A short sentence explaining why a custom colour was refused, phrased for a form. */
const CUSTOM_COLOR_ERRORS = Object.freeze({
  empty: 'Give the color a name.',
  'too-long': `Names are limited to ${LIMITS.MAX_CUSTOM_COLOR_NAME_LENGTH} characters.`,
  invalid: 'Pick a valid color.',
  duplicate: 'A color with that name already exists.',
  'too-many': `You can add up to ${LIMITS.MAX_CUSTOM_COLORS} custom colors.`,
});

/**
 * The message for a `validateCustomColor`/`appendCustomColor` outcome, or `''` when there is
 * nothing to report (`'ok'`/`'added'` or an unknown outcome).
 *
 * @param {string} outcome
 * @returns {string}
 */
export function customColorErrorMessage(outcome) {
  return CUSTOM_COLOR_ERRORS[outcome] ?? '';
}
