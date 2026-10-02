// The Current Session invariant: exactly one auto-saved collection, first in the list. Both the
// install and the startup path need it; the vanilla file duplicated the creation block.
import { CURRENT_SESSION_ID } from '../src/shared/storage-keys.js';

/**
 * Build the Current Session collection. `windowGroups` is initialised so the autosave write has a
 * stable shape from the first run.
 *
 * @returns {Record<string, any>}
 */
export function createCurrentSessionCollection() {
  return {
    id: CURRENT_SESSION_ID,
    name: 'Current Session',
    tabs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isExpanded: false,
    isCurrentSession: true,
    windowGroups: {},
  };
}

/**
 * Ensure the state has a Current Session collection at the front.
 *
 * @param {Record<string, any>} state
 * @returns {boolean} True when the state needs persisting
 */
export function ensureCurrentSession(state) {
  if (state.collections.some((collection) => collection.id === CURRENT_SESSION_ID)) {
    return false;
  }
  state.collections.unshift(createCurrentSessionCollection());
  return true;
}
