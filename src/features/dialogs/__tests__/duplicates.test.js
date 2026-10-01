import { describe, expect, it } from 'vitest';
import {
  consolidateDuplicates,
  findDuplicateCollections,
  normalizeUrl,
} from '../lib/duplicates.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';

describe('normalizeUrl', () => {
  it('trims, lower-cases and drops trailing slashes', () => {
    expect(normalizeUrl('  HTTPS://Example.com/Path/  ')).toBe('https://example.com/path');
    expect(normalizeUrl(undefined)).toBe('');
  });
});

describe('findDuplicateCollections', () => {
  const collections = [
    {
      id: 'c1',
      name: 'Research',
      tabs: [{ id: 't1', title: 'A', url: 'https://example.com/' }],
    },
    {
      id: CURRENT_SESSION_ID,
      name: 'Current Session',
      tabs: [{ id: 't2', url: 'https://example.com' }],
    },
    { id: 'c2', name: 'Empty', tabs: [] },
  ];

  it('finds collections holding the URL regardless of case or trailing slash', () => {
    expect(findDuplicateCollections('https://Example.com', collections)).toEqual([
      { collectionId: 'c1', collectionName: 'Research' },
    ]);
  });

  it('never reports the Current Session mirror as a duplicate', () => {
    const onlyCurrentSession = [collections[1]];
    expect(findDuplicateCollections('https://example.com', onlyCurrentSession)).toEqual([]);
  });

  it('returns nothing for an empty or missing URL', () => {
    expect(findDuplicateCollections('', collections)).toEqual([]);
    expect(findDuplicateCollections(undefined, collections)).toEqual([]);
  });
});

describe('consolidateDuplicates', () => {
  it('de-duplicates the same collection+URL pair across several incoming tabs', () => {
    const entries = [
      {
        tab: { url: 'https://a.test' },
        duplicates: [{ collectionId: 'c1', collectionName: 'Research' }],
      },
      {
        tab: { url: 'https://a.test' },
        duplicates: [{ collectionId: 'c1', collectionName: 'Research' }],
      },
      {
        tab: { url: 'https://b.test' },
        duplicates: [{ collectionId: 'c2', collectionName: 'Work' }],
      },
    ];

    expect(consolidateDuplicates(entries)).toEqual([
      { collectionId: 'c1', collectionName: 'Research' },
      { collectionId: 'c2', collectionName: 'Work' },
    ]);
  });
});
