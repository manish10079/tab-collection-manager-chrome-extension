// Chrome tab-group presentation helpers (pure). Group metadata is captured by the
// autosave engine into `collection.chromeGroups` and referenced per tab via `chromeGroupId`.

/** Chrome's tab-group palette, as reported by `chrome.tabGroups`. */
export const TAB_GROUP_COLORS = Object.freeze({
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#fa903e',
});

/**
 * @param {string} [color] Colour name reported by Chrome
 * @returns {string} CSS colour
 */
export function resolveTabGroupColor(color) {
  return TAB_GROUP_COLORS[color] || TAB_GROUP_COLORS.grey;
}

/**
 * Everything the tab-row badge needs. Untitled groups show the colour dot only.
 *
 * @param {import('../../store/schema.js').TabItem} tab
 * @param {import('../../store/schema.js').Collection} [collection]
 * @returns {{visible: boolean, color: string, label: string, title: string}}
 */
export function resolveTabGroupBadge(tab, collection) {
  const groupId =
    tab && (tab.chromeGroupId === null || tab.chromeGroupId === undefined)
      ? null
      : tab?.chromeGroupId;
  const meta =
    groupId !== null && collection?.chromeGroups ? collection.chromeGroups[groupId] : null;

  if (!meta) {
    return { visible: false, color: TAB_GROUP_COLORS.grey, label: '', title: '' };
  }

  const label = String(meta.title || '').trim();
  return {
    visible: true,
    color: resolveTabGroupColor(meta.color),
    label,
    title: label ? `Chrome tab group: ${label}` : 'Chrome tab group',
  };
}
