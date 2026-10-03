import { mutate } from '../../../store/store.js';
import { addAndAssignColor, setCollectionColor, setFolderColor } from '../lib/colorDraft.js';

/**
 * @typedef {object} ColorActions
 * @property {(id: string, colorId: string|null) => Promise<void>} setCollectionColor
 * @property {(id: string, colorId: string|null) => Promise<void>} setFolderColor
 * @property {(kind: 'collection'|'folder', id: string, name: string, value: string) => Promise<'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'>} labelWithNewColor
 */

/**
 * Labelling a folder or collection with a colour from the palette, or minting a new colour and
 * labelling with it in the same write.
 *
 * @param {{toast: (message: string, duration?: number) => void}} deps Injected by the app layer
 * @returns {ColorActions}
 */
export function useColorActions({ toast }) {
  return {
    setCollectionColor: (id, colorId) => mutate((draft) => setCollectionColor(draft, id, colorId)),

    setFolderColor: (id, colorId) => mutate((draft) => setFolderColor(draft, id, colorId)),

    /**
     * Add a custom colour to the palette and label one folder/collection with it, from that item's
     * own menu — the same write, so the colour exists exactly when the label does. The refusal
     * reasons come back so the menu can show one instead of silently doing nothing.
     *
     * @param {'collection'|'folder'} kind
     * @param {string} id
     * @param {string} name
     * @param {string} value
     * @returns {Promise<'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'>}
     */
    labelWithNewColor: async (kind, id, name, value) => {
      /** @type {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'} */
      let outcome = 'invalid';
      await mutate((draft) => {
        outcome = addAndAssignColor(
          draft,
          { kind, id },
          name,
          value,
          `custom-${crypto.randomUUID()}`
        );
      });

      if (outcome === 'added') toast(`Color "${String(name).trim()}" added`);
      return outcome;
    },
  };
}
