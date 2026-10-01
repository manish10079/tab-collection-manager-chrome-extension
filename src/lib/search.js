// Pure search helpers. The legacy per-collection filter walked the rendered DOM and
// toggled classes; in React the same match rule filters the data before rendering.

/**
 * Case-insensitive match used by the per-collection tab search.
 *
 * @param {import('../store/schema.js').TabItem} tab
 * @param {string} query
 * @returns {boolean}
 */
export function tabMatchesQuery(tab, query) {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return true;
  const title = String(tab?.title ?? '').toLowerCase();
  const url = String(tab?.url ?? '').toLowerCase();
  return title.includes(needle) || url.includes(needle);
}

/**
 * @param {import('../store/schema.js').TabItem[]} tabs
 * @param {string} query
 * @returns {import('../store/schema.js').TabItem[]}
 */
export function filterTabsByQuery(tabs, query) {
  const needle = String(query ?? '').trim();
  if (!needle) return tabs;
  return tabs.filter((tab) => tabMatchesQuery(tab, needle));
}
