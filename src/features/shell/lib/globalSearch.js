// Global search as pure functions: the legacy `filterResults` built an HTML string and wired
// listeners after every render. Here the matching and the highlight segments are data, so the
// component can render them as React elements and the rules are testable without a DOM
// (react-migration-plan.md §8, Phase 5.2).

/**
 * @typedef {object} TabMatchGroup
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {import('../../../store/schema.js').TabItem[]} hits
 */

/**
 * @typedef {object} SearchOutcome
 * @property {string} query            Trimmed, lower-cased query ('' when inactive)
 * @property {import('../../../store/schema.js').Collection[]} nameMatches
 * @property {TabMatchGroup[]} tabMatchGroups
 * @property {number} totalTabHits
 * @property {boolean} isEmpty         True when there is nothing to search for
 */

/** The comparison query used for every match: trimmed and case-folded, never a regex. */
export function normalizeQuery(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Match collections by name and collections whose tabs match by title or URL.
 *
 * @param {import('../../../store/schema.js').Collection[]} [collections]
 * @param {string} [query]
 * @returns {SearchOutcome}
 */
export function searchCollections(collections = [], query = '') {
  const q = normalizeQuery(query);
  if (!q) {
    return { query: '', nameMatches: [], tabMatchGroups: [], totalTabHits: 0, isEmpty: true };
  }

  const nameMatches = collections.filter((collection) =>
    String(collection.name ?? '')
      .toLowerCase()
      .includes(q)
  );

  /** @type {TabMatchGroup[]} */
  const tabMatchGroups = [];
  for (const collection of collections) {
    const hits = (collection.tabs || []).filter(
      (tab) =>
        String(tab.title ?? '')
          .toLowerCase()
          .includes(q) ||
        String(tab.url ?? '')
          .toLowerCase()
          .includes(q)
    );
    if (hits.length > 0) tabMatchGroups.push({ collection, hits });
  }

  const totalTabHits = tabMatchGroups.reduce((sum, group) => sum + group.hits.length, 0);
  return { query: q, nameMatches, tabMatchGroups, totalTabHits, isEmpty: false };
}

/**
 * Split a string into highlighted and plain runs for a query. Case-insensitive, literal (never a
 * regex), and every occurrence is marked — the same result the legacy `highlightMatch` produced
 * with `<mark>`, minus the string building.
 *
 * @param {string} [text]
 * @param {string} [query]
 * @returns {{text: string, match: boolean}[]}
 */
export function highlightSegments(text, query) {
  const value = String(text ?? '');
  const needle = normalizeQuery(query);
  if (!needle) return [{ text: value, match: false }];

  const haystack = value.toLowerCase();
  /** @type {{text: string, match: boolean}[]} */
  const segments = [];
  let index = 0;

  while (index < value.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      segments.push({ text: value.slice(index), match: false });
      break;
    }
    if (found > index) segments.push({ text: value.slice(index, found), match: false });
    segments.push({ text: value.slice(found, found + needle.length), match: true });
    index = found + needle.length;
  }

  return segments;
}
