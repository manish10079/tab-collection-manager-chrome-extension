// Re-exported from `shared/` now that more than one feature needs the id (the collections list
// resolves favicons, and so do the session-history dialogs).
import { EXTENSION_ID } from '../../../shared/extension-id.js';

/**
 * @returns {string} This extension's id, or an empty string outside an extension context.
 */
export function useExtensionId() {
  return EXTENSION_ID;
}
