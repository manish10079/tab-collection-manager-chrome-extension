import { describe, expect, it } from 'vitest';
import { highlightSegments, normalizeQuery, searchCollections } from '../lib/globalSearch.js';

/** @param {string} id @param {string} name @param {object[]} [tabs] */
function collection(id, name, tabs = []) {
  return { id, name, tabs };
}

/** @param {string} id @param {string} [title] @param {string} [url] */
function tab(id, title = id, url = `https://${id}.test`) {
  return { id, title, url };
}

describe('normalizeQuery', () => {
  it('trims and lower-cases, and never builds a regex', () => {
    expect(normalizeQuery('  HeLLo  ')).toBe('hello');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery('a.*b')).toBe('a.*b');
  });
});

describe('searchCollections', () => {
  const collections = [
    collection('a', 'Research', [tab('t1', 'Docs', 'https://docs.test'), tab('t2', 'News')]),
    collection('b', 'News', [tab('t3', 'Docs', 'https://docs.test')]),
  ];

  it('is empty for a blank query', () => {
    const result = searchCollections(collections, '   ');
    expect(result.isEmpty).toBe(true);
    expect(result.nameMatches).toEqual([]);
    expect(result.tabMatchGroups).toEqual([]);
  });

  it('matches collection names case-insensitively', () => {
    const result = searchCollections(collections, 'RESEARCH');
    expect(result.nameMatches.map((entry) => entry.id)).toEqual(['a']);
  });

  it('matches tab titles and URLs, grouped by collection', () => {
    const result = searchCollections(collections, 'docs.test');

    expect(result.nameMatches).toEqual([]);
    expect(result.tabMatchGroups.map((group) => group.collection.id)).toEqual(['a', 'b']);
    expect(result.totalTabHits).toBe(2);
  });

  it('can match a name and a tab at once', () => {
    const result = searchCollections(collections, 'news');

    expect(result.nameMatches.map((entry) => entry.id)).toEqual(['b']);
    expect(result.tabMatchGroups.map((group) => group.collection.id)).toEqual(['a']);
    expect(result.totalTabHits).toBe(1);
  });
});

describe('highlightSegments', () => {
  it('returns one plain run without a query', () => {
    expect(highlightSegments('Docs', '')).toEqual([{ text: 'Docs', match: false }]);
  });

  it('marks the matched run and keeps the rest', () => {
    expect(highlightSegments('Research docs', 'sea')).toEqual([
      { text: 'Re', match: false },
      { text: 'sea', match: true },
      { text: 'rch docs', match: false },
    ]);
  });

  it('is case-insensitive and marks every occurrence', () => {
    expect(highlightSegments('abAB', 'ab')).toEqual([
      { text: 'ab', match: true },
      { text: 'AB', match: true },
    ]);
  });

  it('handles an empty string and a trailing match', () => {
    expect(highlightSegments('', 'x')).toEqual([]);
    expect(highlightSegments('xyz', 'yz')).toEqual([
      { text: 'x', match: false },
      { text: 'yz', match: true },
    ]);
  });
});
