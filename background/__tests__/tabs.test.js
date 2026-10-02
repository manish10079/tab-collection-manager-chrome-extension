import { describe, expect, it } from 'vitest';
import {
  flattenAndCap,
  groupTabsByWindow,
  isSaveableUrl,
  mergePreservingIdentity,
  partitionPinnedFirst,
  shouldRefuseOverwrite,
  snapshotOpenTabs,
} from '../lib/tabs.js';

describe('isSaveableUrl', () => {
  it('accepts parseable web URLs and rejects internal schemes', () => {
    expect(isSaveableUrl('https://example.com')).toBe(true);
    expect(isSaveableUrl('http://example.com/a')).toBe(true);
    expect(isSaveableUrl('chrome://settings')).toBe(false);
    expect(isSaveableUrl('about:blank')).toBe(false);
    expect(isSaveableUrl('edge://settings')).toBe(false);
    expect(isSaveableUrl('')).toBe(false);
    expect(isSaveableUrl(undefined)).toBe(false);
    expect(isSaveableUrl('not a url')).toBe(false);
  });
});

describe('snapshotOpenTabs', () => {
  it('drops unsaveable tabs and defaults every field', () => {
    const tabs = snapshotOpenTabs([
      { url: 'https://a.test', title: '  A  ', index: 1, windowId: 7, pinned: true, groupId: 5 },
      { url: 'chrome://newtab', title: 'ignored' },
    ]);

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      title: 'A',
      url: 'https://a.test',
      pinned: true,
      index: 1,
      windowId: 7,
      chromeGroupId: 5,
    });
    expect(tabs[0].id).toEqual(expect.any(String));
  });

  it('names an untitled tab and nulls an ungrouped one', () => {
    const [tab] = snapshotOpenTabs([{ url: 'https://b.test', title: '   ', groupId: -1 }]);
    expect(tab.title).toBe('Untitled');
    expect(tab.chromeGroupId).toBeNull();
  });
});

describe('groupTabsByWindow', () => {
  it('buckets by window and orders each bucket by Chrome index', () => {
    const grouped = groupTabsByWindow([
      { windowId: 1, index: 2, url: 'c' },
      { windowId: 2, index: 0, url: 'd' },
      { windowId: 1, index: 0, url: 'a' },
      { windowId: 1, index: 1, url: 'b' },
    ]);

    expect(grouped[1].map((tab) => tab.url)).toEqual(['a', 'b', 'c']);
    expect(grouped[2].map((tab) => tab.url)).toEqual(['d']);
  });
});

describe('flattenAndCap', () => {
  it('flattens window buckets and caps the result', () => {
    const grouped = { 1: [{ url: 'a' }, { url: 'b' }], 2: [{ url: 'c' }, { url: 'd' }] };
    expect(flattenAndCap(grouped, 3).map((tab) => tab.url)).toEqual(['a', 'b', 'c']);
  });
});

describe('partitionPinnedFirst', () => {
  it('moves pinned tabs ahead of unpinned ones, preserving relative order', () => {
    const tabs = [
      { url: 'a', pinned: false },
      { url: 'b', pinned: true },
      { url: 'c', pinned: false },
      { url: 'd', pinned: true },
    ];
    expect(partitionPinnedFirst(tabs).map((tab) => tab.url)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('mergePreservingIdentity', () => {
  it('keeps the saved id and addedAt for a tab that is still open', () => {
    const merged = mergePreservingIdentity(
      [{ url: 'https://a.test', title: 'new', pinned: false }],
      [{ url: 'https://a.test', id: 'keep-me', addedAt: 42, pinned: true }],
      { now: 1000 }
    );

    expect(merged[0]).toMatchObject({ id: 'keep-me', addedAt: 42, title: 'new' });
  });

  it('stamps a new tab with `now` and keeps the id the snapshot gave it', () => {
    const merged = mergePreservingIdentity(
      [{ url: 'https://b.test', pinned: false, id: 'fresh' }],
      [],
      { now: 777 }
    );
    expect(merged[0]).toMatchObject({ addedAt: 777, id: 'fresh' });
  });

  it('caps the number of pinned tabs it preserves', () => {
    const newTabs = [
      { url: 'https://a.test', pinned: true },
      { url: 'https://b.test', pinned: true },
      { url: 'https://c.test', pinned: true },
    ];
    const merged = mergePreservingIdentity(newTabs, [], {
      enforceMaxPinnedTabs: true,
      maxPinnedTabs: 2,
    });

    expect(merged.map((tab) => tab.pinned)).toEqual([true, true, false]);
  });

  it('leaves pins alone when the limit is not enforced', () => {
    const newTabs = [
      { url: 'https://a.test', pinned: true },
      { url: 'https://b.test', pinned: true },
    ];
    const merged = mergePreservingIdentity(newTabs, [], {
      enforceMaxPinnedTabs: false,
      maxPinnedTabs: 1,
    });

    expect(merged.map((tab) => tab.pinned)).toEqual([true, true]);
  });
});

describe('shouldRefuseOverwrite', () => {
  it('refuses a drastic shrink inside the startup window', () => {
    expect(
      shouldRefuseOverwrite({
        previousTabCount: 20,
        nextTabCount: 2,
        now: 5000,
        startupTime: 1000,
      })
    ).toBe(true);
  });

  it('allows the write once the startup window has passed', () => {
    expect(
      shouldRefuseOverwrite({
        previousTabCount: 20,
        nextTabCount: 2,
        now: 100000,
        startupTime: 1000,
      })
    ).toBe(false);
  });

  it('is inert when the worker did not just start', () => {
    // `startupTime: 0` means `now - 0` is enormous, so the guard's window never matches.
    expect(
      shouldRefuseOverwrite({
        previousTabCount: 20,
        nextTabCount: 2,
        now: 1_700_000_000_000,
        startupTime: 0,
      })
    ).toBe(false);
  });

  it('only guards collections that hold more than five tabs', () => {
    expect(
      shouldRefuseOverwrite({
        previousTabCount: 5,
        nextTabCount: 1,
        now: 5000,
        startupTime: 1000,
      })
    ).toBe(false);
  });
});
