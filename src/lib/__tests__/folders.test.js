import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_ID } from '../../shared/storage-keys.js';
import { NO_COLOR } from '../colors.js';
import {
  clusterByColor,
  collectionsInFolder,
  filterByColor,
  groupCollections,
} from '../folders.js';

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

describe('filterByColor', () => {
  const folders = [
    { id: 'f1', name: 'Work', color: 'blue' },
    { id: 'f2', name: 'Home', color: null },
  ];
  const collections = [
    collection('a', 'Blue root', null, { color: 'blue' }),
    collection('b', 'Nested blue', 'f1', { color: 'blue' }),
    collection('c', 'Nested red', 'f1', { color: 'red' }),
    collection('d', 'Unlabelled', null, { color: null }),
  ];

  it('returns the plain view when the filter is empty', () => {
    const view = filterByColor(collections, folders, new Set());

    expect(view.groups).toHaveLength(2);
    expect(view.root.map((entry) => entry.id)).toEqual(['a', 'd']);
  });

  it('keeps only the folders and collections carrying the colour', () => {
    const view = filterByColor(collections, folders, new Set(['blue']));

    expect(view.groups.map((group) => group.folder.id)).toEqual(['f1']);
    expect(view.groups[0].collections.map((entry) => entry.id)).toEqual(['b']);
    expect(view.root.map((entry) => entry.id)).toEqual(['a']);
  });

  it('promotes a matching collection whose folder is not part of the filter', () => {
    // 'b' is blue but lives in the unlabelled folder f2, which the blue filter does not show.
    const view = filterByColor(
      [collection('b', 'Nested blue', 'f2', { color: 'blue' })],
      folders,
      new Set(['blue'])
    );

    expect(view.root.map((entry) => entry.id)).toEqual(['b']);
    // It was promoted, not left nested under a folder the filter hid.
    expect(view.groups.every((group) => group.collections.length === 0)).toBe(true);
  });

  it('selects the unlabelled items with the none key', () => {
    const view = filterByColor(collections, folders, new Set([NO_COLOR]));

    expect(view.groups.map((group) => group.folder.id)).toEqual(['f2']);
    expect(view.root.map((entry) => entry.id)).toEqual(['d']);
  });

  it('shows nothing when no item matches', () => {
    const view = filterByColor(collections, folders, new Set(['purple']));

    expect(view).toEqual({ root: [], groups: [] });
  });
});

describe('clusterByColor', () => {
  const folders = [
    { id: 'f1', name: 'Work', color: 'blue' },
    { id: 'f2', name: 'Home', color: null },
  ];
  const collections = [
    collection('a', 'Blue root', null, { color: 'blue' }),
    collection('b', 'Nested blue', 'f1', { color: 'blue' }),
    collection('c', 'Red nested', 'f1', { color: 'red' }),
    collection('d', 'Unlabelled', null, { color: null }),
  ];

  it('collects every member of a colour into one cluster, in the given order', () => {
    const clusters = clusterByColor(collections, folders, ['blue', 'red', NO_COLOR]);

    expect(clusters.map((cluster) => cluster.colorId)).toEqual(['blue', 'red', NO_COLOR]);

    // Blue: its folder (with the nested blue collection) and the root blue collection.
    expect(clusters[0].groups.map((group) => group.folder.id)).toEqual(['f1']);
    expect(clusters[0].groups[0].collections.map((entry) => entry.id)).toEqual(['b']);
    expect(clusters[0].root.map((entry) => entry.id)).toEqual(['a']);

    // Red: no folder carries it, so its nested collection is promoted into the cluster.
    expect(clusters[1].groups).toEqual([]);
    expect(clusters[1].root.map((entry) => entry.id)).toEqual(['c']);

    // No color: the unlabelled folder and root collection.
    expect(clusters[2].groups.map((group) => group.folder.id)).toEqual(['f2']);
    expect(clusters[2].root.map((entry) => entry.id)).toEqual(['d']);
  });

  it('leaves out a colour nothing carries', () => {
    const clusters = clusterByColor(collections, folders, ['purple', 'blue']);

    expect(clusters.map((cluster) => cluster.colorId)).toEqual(['blue']);
  });

  it('defaults to an empty cluster list', () => {
    expect(clusterByColor()).toEqual([]);
  });
});
