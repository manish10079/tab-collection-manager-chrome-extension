// Chrome tab-group capture. The saved metadata is what lets a collection be restored with its
// groups intact; the pure presentation half lives in `src/lib/tabGroups.js`.
import { api } from './api.js';
import { normalizeGroupId } from '../src/lib/tabGroups.js';

/**
 * Read the title/color/collapsed metadata for every live tab group referenced by `tabs`.
 *
 * @param {Record<string, any>[]} tabs
 * @returns {Promise<Record<number, {title: string, color: string, collapsed: boolean}>>}
 */
export async function captureGroupMeta(tabs) {
  /** @type {Record<number, {title: string, color: string, collapsed: boolean}>} */
  const meta = {};
  if (!api.tabGroups || typeof api.tabGroups.get !== 'function') return meta;

  const ids = [
    ...new Set(
      (tabs || []).map((tab) => normalizeGroupId(tab.groupId)).filter((id) => id !== null)
    ),
  ];

  for (const id of ids) {
    try {
      const group = await api.tabGroups.get(id);
      meta[id] = {
        title: group.title || '',
        color: group.color || 'grey',
        collapsed: !!group.collapsed,
      };
    } catch {
      // The group disappeared between the query and this read — skip it.
    }
  }
  return meta;
}
