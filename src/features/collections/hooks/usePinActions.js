import { mutate } from '../../../store/store.js';
import { toggleCollectionPin, toggleTabPin } from '../lib/collectionAdmin.js';

/**
 * @typedef {object} PinActions
 * @property {(id: string) => void} pinCollection
 * @property {(collectionId: string, tabId: string) => void} pinTab
 */

/**
 * Pinning a collection or a tab, plus the limit refusal the two share.
 *
 * A toggle can be refused (the pinned limits in Settings). The mutator decides that, so the rule
 * lives with the state rather than with the click, and a refusal surfaces as a toast instead of the
 * legacy `alert()` that used to block the side panel.
 *
 * @param {{toast: (message: string, duration?: number) => void}} deps Injected by the app layer
 * @returns {PinActions}
 */
export function usePinActions({ toast }) {
  /**
   * @param {(draft: import('../../../store/schema.js').AppState) => {changed: boolean, limitReached: boolean, limit: number}} mutator
   * @param {(limit: number) => string} limitMessage
   */
  async function runPinToggle(mutator, limitMessage) {
    let result = { changed: false, limitReached: false, limit: 0 };
    await mutate((draft) => {
      result = mutator(draft);
    });
    if (result.limitReached) toast(limitMessage(result.limit));
  }

  return {
    pinCollection: (id) =>
      runPinToggle(
        (draft) => toggleCollectionPin(draft, id),
        (limit) =>
          `Maximum of ${limit} pinned collections reached. Raise the limit or disable it in Settings.`
      ),

    pinTab: (collectionId, tabId) =>
      runPinToggle(
        (draft) => toggleTabPin(draft, collectionId, tabId),
        (limit) =>
          `Maximum of ${limit} pinned tabs per collection reached. Raise the limit or disable it in Settings.`
      ),
  };
}
