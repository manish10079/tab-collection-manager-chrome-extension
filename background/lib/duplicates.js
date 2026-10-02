// Pure duplicate detection for the context-menu path (skill.md §3.3).
// Current Session is excluded on purpose: it mirrors the live browser session, so every open tab
// necessarily appears there and flagging it would warn on every add.

/**
 * Normalise a URL for comparison: trim, lower-case and drop trailing slashes.
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  return String(url).trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Names of the collections that already hold `url`.
 *
 * @param {string} url
 * @param {Array<{id: string, name: string, tabs?: Array<{url: string}>}>} collections
 * @param {string} currentSessionId
 * @returns {string[]}
 */
export function findDuplicateCollections(url, collections, currentSessionId) {
  const normalizedUrl = normalizeUrl(url);
  const found = [];
  for (const collection of collections || []) {
    if (collection.id === currentSessionId) continue;
    if (!collection.tabs) continue;
    if (collection.tabs.some((tab) => normalizeUrl(tab.url) === normalizedUrl)) {
      found.push(collection.name);
    }
  }
  return found;
}
