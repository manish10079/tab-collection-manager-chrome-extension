import { describe, expect, it } from 'vitest';
import { addTabsToCollection } from '../lib/tabIntake.js';
import { LIMITS } from '../../../shared/constants.js';
import { EMPTY_STATE } from '../../../store/schema.js';

/**
 * @param {object[]} tabs
 * @param {Partial<import('../../../store/schema.js').AppState>} [overrides]
 */
function makeDraft(tabs = [], overrides = {}) {
  return structuredClone({
    ...EMPTY_STATE,
    ready: true,
    collections: [{ id: 'c1', name: 'Research', tabs }],
    ...overrides,
  });
}

/** @param {string} id */
function existingTab(id) {
  return { id, title: id, url: `https://${id}.test`, pinned: false, index: 0, windowId: 0 };
}

describe('addTabsToCollection', () => {
  it('appends valid tabs and stamps the collection as updated', () => {
    const draft = makeDraft();

    const outcome = addTabsToCollection(draft, 'c1', [
      { title: 'Alpha', url: 'https://alpha.test' },
      { title: '', url: 'https://beta.test' },
    ]);

    expect(outcome).toEqual({ added: 2, skippedByLimit: 0, skippedInvalid: 0 });
    expect(draft.collections[0].tabs.map((tab) => tab.title)).toEqual(['Alpha', 'Untitled']);
    expect(draft.collections[0].updatedAt).toBeTypeOf('number');
    expect(draft.collections[0].tabs[0].addedAt).toBeTypeOf('number');
  });

  it('skips invalid URLs and keeps a provided addedAt', () => {
    const draft = makeDraft();
    const addedAt = 1_600_000_000_000;

    const outcome = addTabsToCollection(draft, 'c1', [
      { title: 'Bad', url: 'not-a-url' },
      { title: 'Good', url: 'https://good.test', addedAt },
    ]);

    expect(outcome.skippedInvalid).toBe(1);
    expect(outcome.added).toBe(1);
    expect(draft.collections[0].tabs[0].addedAt).toBe(addedAt);
  });

  it('refuses tabs once the collection reaches the cap', () => {
    const full = Array.from({ length: LIMITS.MAX_TABS_PER_COLLECTION }, (_, index) =>
      existingTab(`t${index}`)
    );
    const draft = makeDraft(full);

    const outcome = addTabsToCollection(draft, 'c1', [
      { title: 'Overflow', url: 'https://overflow.test' },
    ]);

    expect(outcome).toEqual({ added: 0, skippedByLimit: 1, skippedInvalid: 0 });
    expect(draft.collections[0].tabs).toHaveLength(LIMITS.MAX_TABS_PER_COLLECTION);
  });

  it('lands a pinned tab unpinned when the pinned limit is already full', () => {
    const draft = makeDraft([{ ...existingTab('p1'), pinned: true }], {
      settings: { ...EMPTY_STATE.settings, maxPinnedTabs: 1 },
    });

    addTabsToCollection(draft, 'c1', [{ title: 'P', url: 'https://p.test', pinned: true }]);

    expect(draft.collections[0].tabs[1].pinned).toBe(false);
  });

  it('merges the group metadata the incoming tabs refer to', () => {
    const draft = makeDraft();
    const meta = { 7: { title: 'Work', color: 'blue', collapsed: false } };

    addTabsToCollection(draft, 'c1', [{ title: 'G', url: 'https://g.test', groupId: 7 }], meta);

    expect(draft.collections[0].chromeGroups).toEqual(meta);
    expect(draft.collections[0].tabs[0].chromeGroupId).toBe(7);
  });

  it('does nothing when the collection does not exist', () => {
    const draft = makeDraft();

    expect(addTabsToCollection(draft, 'missing', [{ url: 'https://a.test' }])).toEqual({
      added: 0,
      skippedByLimit: 0,
      skippedInvalid: 0,
    });
    expect(draft.collections[0].tabs).toEqual([]);
  });
});
