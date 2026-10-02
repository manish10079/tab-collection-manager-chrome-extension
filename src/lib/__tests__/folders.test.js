import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_ID } from '../../shared/storage-keys.js';
import { collectionsInFolder, groupCollections } from '../folders.js';

/** @param {Record<string, unknown>} [extra] */
const collection = (id, name, folderId = null, extra = {}) => ({
  id,
  name,
  tabs: [],
  folderId,
  ...extra,
});

describe('collectionsInFolder', () => {
  it('splits by folder id, treating a missing folderId as the root', () => {
    const collections = [{ id: 'a' }, { id: 'b', folderId: 'f1' }, { id: 'c', folderId: null }];

    expect(collectionsInFolder(collections, null).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(collectionsInFolder(collections, 'f1').map((entry) => entry.id)).toEqual(['b']);
  });

  it('returns nothing for an unknown folder', () => {
    expect(collectionsInFolder([{ id: 'a' }], 'ghost')).toEqual([]);
  });
});

describe('groupCollections', () => {
  it('returns the root (Current Session first, then pinned) and each folder group', () => {
    const collections = [
      collection(CURRENT_SESSION_ID, 'Current Session'),
      collection('a', 'Pinned', null, { pinned: true }),
      collection('b', 'Nested', 'f1'),
    ];

    const { root, groups } = groupCollections(collections, [{ id: 'f1', name: 'Work' }], 'custom');

    expect(root.map((entry) => entry.id)).toEqual([CURRENT_SESSION_ID, 'a']);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder.id).toBe('f1');
    expect(groups[0].collections.map((entry) => entry.id)).toEqual(['b']);
  });

  it('applies the sort mode inside a folder', () => {
    const collections = [
      collection('a', 'Zeta', 'f1'),
      collection('b', 'Alpha', 'f1'),
      collection('c', 'Root'),
    ];

    const { root, groups } = groupCollections(collections, [{ id: 'f1', name: 'Work' }], 'nameAsc');

    expect(groups[0].collections.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(root.map((entry) => entry.id)).toEqual(['c']);
  });

  it('defaults to an empty view', () => {
    expect(groupCollections()).toEqual({ root: [], groups: [] });
  });
});
