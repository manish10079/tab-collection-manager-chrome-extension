// Reading the live browser: the open-tabs picker's list and the tab-group metadata that has to
// travel with the tabs it imports. Ported from `renderOpenTabsList` / `captureGroupMeta`.
import { normalizeGroupId } from '../../../lib/tabGroups.js';

/**
 * Title/colour/collapsed for every live tab group referenced by these tabs, keyed by group id.
 * A group that disappears between the query and this read is skipped rather than fatal.
 *
 * @param {{groupId?: unknown}[]} [tabs]
 * @returns {Promise<Record<string, import('../../../store/schema.js').ChromeGroupMeta>>}
 */
export async function captureGroupMeta(tabs = []) {
  const meta = {};
  if (!chrome.tabGroups || typeof chrome.tabGroups.get !== 'function') return meta;

  const ids = [
    ...new Set(tabs.map((tab) => normalizeGroupId(tab?.groupId)).filter((id) => id !== null)),
  ];

  for (const id of ids) {
    try {
      const group = await chrome.tabGroups.get(id);
      meta[id] = {
        title: group.title || '',
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed),
      };
    } catch {
      // The group vanished — skip it.
    }
  }
  return meta;
}

/**
 * The tabs of the current window, newest query each time it is called.
 *
 * @returns {Promise<{tabs: any[], groupsMeta: Record<string, import('../../../store/schema.js').ChromeGroupMeta>}>}
 */
export async function listOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groupsMeta = await captureGroupMeta(tabs);
  return { tabs, groupsMeta };
}
