// Pure URL helpers. The extension id is passed in so this stays free of `chrome.*`
// (skill.md §3.3 — lib/ is pure) and testable without a browser.

const FALLBACK_ICON = 'icons/icon16.png';

/**
 * Favicon URL for a saved tab: the extension's own `_favicon` endpoint for http(s),
 * the bundled icon otherwise (same rule as the legacy `getFaviconUrl`).
 *
 * @param {string} [url]
 * @param {string} [extensionId] `chrome.runtime.id`
 * @param {string} [fallback]
 * @returns {string}
 */
export function resolveFaviconUrl(url, extensionId, fallback = FALLBACK_ICON) {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    if (!extensionId) return fallback;
    return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
  } catch {
    return fallback;
  }
}

/**
 * Shorten a URL for display without breaking it in the middle of a word.
 *
 * @param {string} [url]
 * @param {number} [maxLength]
 * @param {string} [ellipsis]
 * @returns {string}
 */
export function truncateUrl(url, maxLength = 50, ellipsis = '...') {
  const value = String(url ?? '');
  return value.length > maxLength ? `${value.slice(0, maxLength)}${ellipsis}` : value;
}

/**
 * Make a stored URL openable. Returns null when there is nothing to open.
 *
 * @param {string} [url]
 * @returns {string|null}
 */
export function toOpenableUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `https://${value}`;
}
