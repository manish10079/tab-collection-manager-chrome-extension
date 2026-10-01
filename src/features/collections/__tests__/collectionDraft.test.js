import { describe, expect, it } from 'vitest';
import {
  moveTabToCollection,
  moveTabToCollectionAtPosition,
  reorderCollections,
  reorderTabsWithinCollection,
} from '../lib/collectionDraft.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { LIMITS } from '../../../shared/constants.js';

/** @param {string} id @param {Partial<import('../../../store/schema.js').TabItem>} [extra] */
function tab(id, extra = {}) {
  return { id, title: id, url: `https://${id}.test`, pinned: false, ...extra };
}

/** @param {string} id @param {any[]} [tabs] @param {object} [extra] */
function collection(id, tabs = [], extra = {}) {
  return { id, name: id, tabs, updatedAt: 1, ...extra };
}

/** @param {any[]} collections @param {object} [settings] */
function draft(collections, settings = {}) {
  return {
    ready: true,
    error: null,
    collections,
    settings: { collectionSortType: 'custom', maxPinnedTabs: 3, ...settings },
    lastSessionBackup: null,
  };
}

/** @param {import('../../../store/schema.js').Collection[]} collections */
function ids(collections) {
  return collections.map((entry) => entry.id);
}

describe('reorderCollections', () => {
  it('moves the source collection onto the target position and keeps Current Session first', () => {
    const state = draft([
      collection(CURRENT_SESSION_ID),
      collection('a'),
      collection('b'),
      collection('c'),
    ]);

    reorderCollections(state, 'c', 'a');

    expect(ids(state.collections)).toEqual([CURRENT_SESSION_ID, 'c', 'a', 'b']);
  });

  it('forces the collection sort back to custom so the drop survives a re-render', () => {
    const state = draft([collection('a'), collection('b')], { collectionSortType: 'nameAsc' });

    reorderCollections(state, 'b', 'a');

    expect(state.settings.collectionSortType).toBe('custom');
  });

  it('ignores unknown ids and self-drops', () => {
    const state = draft([collection('a'), collection('b')]);
    const before = ids(state.collections);

    reorderCollections(state, 'a', 'a');
    reorderCollections(state, 'missing', 'a');
    reorderCollections(state, 'a', 'missing');

    expect(ids(state.collections)).toEqual(before);
  });
});

describe('reorderTabsWithinCollection', () => {
  it('moves a tab onto another tab position and stamps the collection', () => {
    const state = draft([collection('a', [tab('t1'), tab('t2'), tab('t3')])]);

    reorderTabsWithinCollection(state, 'a', 't3', 't1');

    expect(state.collections[0].tabs.map((entry) => entry.id)).toEqual(['t3', 't1', 't2']);
    expect(state.collections[0].tabSortType).toBe('custom');
    expect(state.collections[0].updatedAt).toBeGreaterThan(1);
  });

  it('still puts pinned tabs first after a manual reorder', () => {
    const state = draft([collection('a', [tab('t1', { pinned: true }), tab('t2'), tab('t3')])]);

    reorderTabsWithinCollection(state, 'a', 't2', 't3');

    expect(state.collections[0].tabs.map((entry) => entry.id)).toEqual(['t1', 't3', 't2']);
  });
});

describe('moveTabToCollection', () => {
  it('appends the tab to the target and stamps both collections', () => {
    const state = draft([collection('a', [tab('t1')]), collection('b', [tab('t2')])]);

    const result = moveTabToCollection(state, 't1', 'a', 'b');

    expect(result).toEqual({ moved: true });
    expect(state.collections[0].tabs).toEqual([]);
    expect(state.collections[1].tabs.map((entry) => entry.id)).toEqual(['t2', 't1']);
    expect(state.collections[0].updatedAt).toBeGreaterThan(1);
    expect(state.collections[1].updatedAt).toBeGreaterThan(1);
  });

  it('unpins an arriving pinned tab when the target is already at its pin limit', () => {
    const state = draft(
      [
        collection('a', [tab('t1', { pinned: true })]),
        collection('b', [tab('t2', { pinned: true }), tab('t3', { pinned: true }), tab('t4')]),
      ],
      { maxPinnedTabs: 2 }
    );

    moveTabToCollection(state, 't1', 'a', 'b');

    const moved = state.collections[1].tabs.find((entry) => entry.id === 't1');
    expect(moved?.pinned).toBe(false);
  });

  it('keeps the tab pinned while the target has room', () => {
    const state = draft(
      [
        collection('a', [tab('t1', { pinned: true })]),
        collection('b', [tab('t2'), tab('t3'), tab('t4')]),
      ],
      { maxPinnedTabs: 2 }
    );

    moveTabToCollection(state, 't1', 'a', 'b');

    expect(state.collections[1].tabs[0].id).toBe('t1');
    expect(state.collections[1].tabs[0].pinned).toBe(true);
  });

  it('refuses the move at the tab cap and leaves the tab where it was', () => {
    const full = Array.from({ length: LIMITS.MAX_TABS_PER_COLLECTION }, (_, index) =>
      tab(`f${index}`)
    );
    const state = draft([collection('a', [tab('t1')]), collection('b', full)]);

    const result = moveTabToCollection(state, 't1', 'a', 'b');

    expect(result.moved).toBe(false);
    expect(result.message).toContain(String(LIMITS.MAX_TABS_PER_COLLECTION));
    expect(state.collections[0].tabs.map((entry) => entry.id)).toEqual(['t1']);
  });

  it('refuses a move inside the same collection', () => {
    const state = draft([collection('a', [tab('t1'), tab('t2')])]);

    expect(moveTabToCollection(state, 't1', 'a', 'a')).toEqual({ moved: false });
    expect(state.collections[0].tabs.map((entry) => entry.id)).toEqual(['t1', 't2']);
  });
});

describe('moveTabToCollectionAtPosition', () => {
  it('inserts the tab at the target tab position and forces custom tab order', () => {
    const state = draft(
      [collection('a', [tab('t1')]), collection('b', [tab('t2'), tab('t3')])],
      {}
    );

    const result = moveTabToCollectionAtPosition(state, 't1', 'a', 'b', 't3');

    expect(result).toEqual({ moved: true });
    expect(state.collections[1].tabs.map((entry) => entry.id)).toEqual(['t2', 't1', 't3']);
    expect(state.collections[1].tabSortType).toBe('custom');
  });

  it('never loses the tab when the insertion point is unknown', () => {
    const state = draft([collection('a', [tab('t1')]), collection('b', [tab('t2')])]);

    const result = moveTabToCollectionAtPosition(state, 't1', 'a', 'b', 'gone');

    expect(result.moved).toBe(false);
    expect(state.collections[0].tabs.map((entry) => entry.id)).toEqual(['t1']);
    expect(state.collections[1].tabs.map((entry) => entry.id)).toEqual(['t2']);
  });
});
