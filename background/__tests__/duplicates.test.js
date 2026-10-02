import { describe, expect, it } from 'vitest';
import { findDuplicateCollections } from '../lib/duplicates.js';

const collection = (id, name, urls) => ({
  id,
  name,
  tabs: urls.map((url) => ({ url })),
});

describe('findDuplicateCollections', () => {
  it('ignores case, trailing slashes and surrounding whitespace', () => {
    const found = findDuplicateCollections(
      '  https://Example.com/Path/  ',
      [collection('c1', 'Work', ['https://example.com/path'])],
      'current-session'
    );
    expect(found).toEqual(['Work']);
  });

  it('reports every collection that already holds the URL', () => {
    const found = findDuplicateCollections(
      'https://dup.test',
      [
        collection('c1', 'One', ['https://dup.test']),
        collection('c2', 'Two', ['https://dup.test']),
      ],
      'current-session'
    );
    expect(found).toEqual(['One', 'Two']);
  });

  it('never flags Current Session even though it mirrors every open tab', () => {
    const found = findDuplicateCollections(
      'https://open.test',
      [collection('current-session', 'Current Session', ['https://open.test'])],
      'current-session'
    );
    expect(found).toEqual([]);
  });

  it('tolerates a collection with no tabs array', () => {
    expect(
      findDuplicateCollections('https://a.test', [{ id: 'c1', name: 'Empty' }], 'current-session')
    ).toEqual([]);
  });
});
