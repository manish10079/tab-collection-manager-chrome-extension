import { describe, expect, it } from 'vitest';
import { partitionCollections, partitionTabs, sortCollections, sortTabs } from '../sort.js';
import { CURRENT_SESSION_ID } from '../../shared/storage-keys.js';

/** @param {Partial<import('../../store/schema.js').Collection>} overrides */
function collection(overrides) {
  return { id: 'c', name: 'Collection', tabs: [], ...overrides };
}

describe('partitionCollections', () => {
  it('puts Current Session first, then pinned, then the rest', () => {
    const result = partitionCollections([
      collection({ id: 'a' }),
      collection({ id: 'b', pinned: true }),
      collection({ id: CURRENT_SESSION_ID, pinned: true }),
      collection({ id: 'c' }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual([CURRENT_SESSION_ID, 'b', 'a', 'c']);
  });
});

describe('sortCollections', () => {
  const base = [
    collection({ id: 'old', name: 'Zebra', updatedAt: 10, createdAt: 10, tabs: [{}] }),
    collection({ id: 'new', name: 'apple', updatedAt: 30, createdAt: 30, tabs: [{}, {}, {}] }),
    collection({ id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [{}] }),
  ];

  it('keeps Current Session first for every mode', () => {
    for (const mode of ['custom', 'lastModified', 'nameAsc', 'tabCountAsc']) {
      expect(sortCollections(base, mode)[0].id).toBe(CURRENT_SESSION_ID);
    }
  });

  it('orders unpinned collections by the requested mode', () => {
    expect(sortCollections(base, 'nameAsc').map((c) => c.id)).toEqual([
      CURRENT_SESSION_ID,
      'new',
      'old',
    ]);
    expect(sortCollections(base, 'lastModified').map((c) => c.id)).toEqual([
      CURRENT_SESSION_ID,
      'new',
      'old',
    ]);
    expect(sortCollections(base, 'tabCountAsc').map((c) => c.id)).toEqual([
      CURRENT_SESSION_ID,
      'old',
      'new',
    ]);
  });

  it('keeps pinned collections above sorted unpinned ones', () => {
    const withPinned = [
      ...base,
      collection({ id: 'pinned', pinned: true, name: 'zzz', updatedAt: 1 }),
    ];
    expect(sortCollections(withPinned, 'nameAsc').map((c) => c.id)).toEqual([
      CURRENT_SESSION_ID,
      'pinned',
      'new',
      'old',
    ]);
  });

  it('falls back to custom order for an unknown mode and never mutates the input', () => {
    const input = [...base];
    expect(sortCollections(input, 'nope').map((c) => c.id)).toEqual([
      CURRENT_SESSION_ID,
      'old',
      'new',
    ]);
    expect(input.map((c) => c.id)).toEqual(['old', 'new', CURRENT_SESSION_ID]);
  });
});

describe('partitionTabs', () => {
  it('puts pinned tabs first', () => {
    const tabs = [{ id: '1' }, { id: '2', pinned: true }, { id: '3' }];
    expect(partitionTabs(tabs).map((tab) => tab.id)).toEqual(['2', '1', '3']);
  });
});

describe('sortTabs', () => {
  const tabs = [
    { id: 'b', title: 'Beta', addedAt: 20 },
    { id: 'a', title: 'alpha', addedAt: 10 },
    { id: 'p', title: 'Pinned', addedAt: 5, pinned: true },
  ];

  it('sorts unpinned tabs while keeping pinned tabs on top', () => {
    expect(sortTabs(tabs, 'titleAsc').map((tab) => tab.id)).toEqual(['p', 'a', 'b']);
    expect(sortTabs(tabs, 'titleDesc').map((tab) => tab.id)).toEqual(['p', 'b', 'a']);
    expect(sortTabs(tabs, 'dateAddedNewest').map((tab) => tab.id)).toEqual(['p', 'b', 'a']);
    expect(sortTabs(tabs, 'dateAddedOldest').map((tab) => tab.id)).toEqual(['p', 'a', 'b']);
  });

  it('keeps custom order untouched, with pinned tabs still first', () => {
    expect(sortTabs(tabs, 'custom').map((tab) => tab.id)).toEqual(['p', 'b', 'a']);
  });
});
