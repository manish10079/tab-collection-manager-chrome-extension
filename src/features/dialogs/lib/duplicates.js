// Duplicate-URL detection, ported from `findDuplicateUrlsAcrossCollections` in popup.js. Pure and
// explicit so the rule can be unit tested without a browser.
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';

/**
 * The comparison key the legacy helper used: trimmed, lower-cased, without a trailing slash.
 *
 * @param {string} [url]
 * @returns {string}
 */
export function normalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

/**
 * Every collection already holding this URL.
 *
 * Current Session is skipped on purpose: it mirrors all open tabs, so any URL that is currently
 * open would always look like a duplicate and every add would warn.
 *
 * @param {string} url
 * @param {import('../../../store/schema.js').Collection[]} [collections]
 * @returns {{collectionId: string, collectionName: string}[]}
 */
export function findDuplicateCollections(url, collections = []) {
  const target = normalizeUrl(url);
  if (!target) return [];

  const duplicates = [];
  for (const collection of collections) {
    if (collection.id === CURRENT_SESSION_ID) continue;
    const held = (collection.tabs || []).some((tab) => normalizeUrl(tab.url) === target);
    if (held) {
      duplicates.push({ collectionId: collection.id, collectionName: collection.name });
    }
  }
  return duplicates;
}

/**
 * The flat, de-duplicated list the confirmation dialog lists when several tabs arrive at once.
 *
 * @param {{tab: {url?: string}, duplicates: {collectionId: string, collectionName: string}[]}[]} entries
 * @returns {{collectionId: string, collectionName: string}[]}
 */
export function consolidateDuplicates(entries = []) {
  const seen = new Set();
  const consolidated = [];
  for (const { tab, duplicates } of entries) {
    for (const duplicate of duplicates) {
      const key = `${duplicate.collectionId}-${tab.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      consolidated.push(duplicate);
    }
  }
  return consolidated;
}
