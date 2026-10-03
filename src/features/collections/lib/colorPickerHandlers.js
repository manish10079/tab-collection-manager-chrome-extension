// The two handlers a folder/collection colour menu needs, in one place so the card and the folder
// section cannot drift apart (skill.md §4.1 keeps both files small; the wiring is identical).
//
// A pure factory: it takes the actions, the item the menu belongs to, and the menu's close callback,
// and returns the props `ColorPicker` expects. No React and no `chrome.*` — `lib/` rules (§3.3).
/**
 * Build the `ColorPicker` handlers for one folder or collection.
 *
 * Picking a swatch, or minting a new custom colour, both label the item and close the menu. A
 * refusal is left to the picker to show, so the menu stays open on one.
 *
 * @param {import('../hooks/useCollectionActions.js').CollectionActions} actions
 * @param {'collection'|'folder'} kind
 * @param {string} id
 * @param {() => void} closeMenu
 * @returns {{
 *   onSelect: (colorId: string|null) => void,
 *   onCreateColor: (name: string, value: string) => Promise<string>,
 * }}
 */
export function colorPickerHandlers(actions, kind, id, closeMenu) {
  return {
    onSelect: (colorId) => {
      closeMenu();
      if (kind === 'folder') actions.setFolderColor(id, colorId);
      else actions.setCollectionColor(id, colorId);
    },

    onCreateColor: async (name, value) => {
      const outcome = await actions.labelWithNewColor(kind, id, name, value);
      if (outcome === 'added') closeMenu();
      return outcome;
    },
  };
}
