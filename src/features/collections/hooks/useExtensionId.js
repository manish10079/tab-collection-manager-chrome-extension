// The extension id never changes for the life of a page, so read it once and hand it to
// `resolveFaviconUrl` (keeps lib/ free of chrome.* — skill.md §3.3).
const EXTENSION_ID =
  typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime.id : '';

/**
 * @returns {string} This extension's id, or an empty string outside an extension context.
 */
export function useExtensionId() {
  return EXTENSION_ID;
}
