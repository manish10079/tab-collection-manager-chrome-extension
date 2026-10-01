import { describe, expect, it } from 'vitest';
import {
  createCollection,
  deleteCollection,
  isNameUnique,
  normalizeName,
  removeTab,
  renameCollection,
  renameTab,
  toggleCollectionPin,
  toggleTabPin,
} from '../lib/collectionAdmin.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { EMPTY_STATE } from '../../../store/schema.js';

/** @param {object[]} collections @param {object} [settings] */
function makeDraft(collections = [], settings = {}) {
  return structuredClone({
    ...EMPTY_STATE,
    ready: true,
    collections: [
      { id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [], isCurrentSession: true },
      ...collections,
    ],
    settings: { ...EMPTY_STATE.settings, ...settings },
  });
}

/** @param {string} id @param {object} [overrides] */
function makeCollection(id, overrides = {}) {
  return {
    id,
    name: id.toUpperCase(),
    tabs: [{ id: `${id}-t1`, title: 'Alpha', url: 'https://alpha.test', pinned: false }],
    updatedAt: 1,
    ...overrides,
  };
}

/** @param {string} id @param {boolean} [pinned] */
function makeTab(id, pinned = false) {
  return { id, title: id, url: `https://${id}.test`, pinned };
}

describe('normalizeName / isNameUnique', () => {
  it('ignores case, surrounding and repeated whitespace', () => {
    expect(normalizeName('  My   Collection ')).toBe('my collection');
    expect(isNameUnique([{ id: 'a', name: 'My  Collection' }], ' my collection ')).toBe(false);
  });

  it('excludes the collection being renamed', () => {
    expect(isNameUnique([{ id: 'a', name: 'Research' }], 'Research', 'a')).toBe(true);
  });
});

describe('createCollection', () => {
  it('appends an unpinned, collapsed collection behind Current Session', () => {
    const draft = makeDraft([makeCollection('a')]);

    expect(createCollection(draft, '  Fresh  ', 'new-id')).toBe('created');
    expect(draft.collections.map((collection) => collection.id)).toEqual([
      CURRENT_SESSION_ID,
      'a',
      'new-id',
    ]);
    expect(draft.collections[2]).toMatchObject({ name: 'Fresh', tabs: [], isExpanded: false });
  });

  it('reports each refusal instead of alerting', () => {
    const draft = makeDraft([makeCollection('a', { name: 'Alpha' })]);

    expect(createCollection(draft, '   ', 'x')).toBe('empty');
    expect(createCollection(draft, 'x'.repeat(101), 'x')).toBe('too-long');
    expect(createCollection(draft, '  alpha ', 'x')).toBe('duplicate');
    expect(draft.collections).toHaveLength(2);
  });
});

describe('deleteCollection', () => {
  it('removes the collection and re-partitions the list', () => {
    const draft = makeDraft([makeCollection('a'), makeCollection('b', { pinned: true })]);

    expect(deleteCollection(draft, 'a')).toBe(true);
    expect(draft.collections.map((collection) => collection.id)).toEqual([CURRENT_SESSION_ID, 'b']);
  });

  it('turns Auto-Save off when its target is deleted', () => {
    const draft = makeDraft([makeCollection('a')], { autoSaveCollectionId: 'a' });

    deleteCollection(draft, 'a');

    expect(draft.settings.autoSaveCollectionId).toBeNull();
  });

  it('reports when there was nothing to delete', () => {
    expect(deleteCollection(makeDraft(), 'missing')).toBe(false);
  });
});

describe('renameCollection', () => {
  it('renames and re-partitions', () => {
    const draft = makeDraft([makeCollection('a', { name: 'Old' })]);

    expect(renameCollection(draft, 'a', '  New  ')).toBe('renamed');
    expect(draft.collections[1].name).toBe('New');
    expect(draft.collections[1].updatedAt).toBeGreaterThan(1);
  });

  it('reports each refusal instead of alerting', () => {
    const draft = makeDraft([
      makeCollection('a', { name: 'Alpha' }),
      makeCollection('b', { name: 'Taken' }),
    ]);

    expect(renameCollection(draft, CURRENT_SESSION_ID, 'Anything')).toBe('current-session');
    expect(renameCollection(draft, 'a', '   ')).toBe('empty');
    expect(renameCollection(draft, 'a', 'x'.repeat(101))).toBe('too-long');
    expect(renameCollection(draft, 'a', 'taken')).toBe('duplicate');
    expect(renameCollection(draft, 'a', 'Alpha')).toBe('unchanged');
    expect(renameCollection(draft, 'missing', 'Fresh')).toBe('missing');
    expect(draft.collections[1].name).toBe('Alpha');
  });
});

describe('removeTab / renameTab', () => {
  it('removes a tab and keeps pinned tabs first', () => {
    const draft = makeDraft([
      makeCollection('a', {
        tabs: [makeTab('t1', true), makeTab('t2'), makeTab('t3', true)],
      }),
    ]);

    expect(removeTab(draft, 'a', 't2')).toBe(true);
    expect(draft.collections[1].tabs.map((tab) => tab.id)).toEqual(['t1', 't3']);
    expect(removeTab(draft, 'a', 'nope')).toBe(false);
  });

  it('falls back to "Untitled" for an empty title', () => {
    const draft = makeDraft([makeCollection('a', { tabs: [makeTab('t1')] })]);

    renameTab(draft, 'a', 't1', '   ');

    expect(draft.collections[1].tabs[0].title).toBe('Untitled');
  });
});

describe('pin toggles', () => {
  it('pins a collection and moves it to the top of the unpinned group', () => {
    const draft = makeDraft([makeCollection('a'), makeCollection('b')]);

    expect(toggleCollectionPin(draft, 'a')).toMatchObject({ changed: true, limitReached: false });
    expect(draft.collections[1].id).toBe('a');
    expect(draft.collections[1].pinned).toBe(true);
  });

  it('refuses past the pinned-collection limit', () => {
    const draft = makeDraft([makeCollection('a', { pinned: true }), makeCollection('b')], {
      enforceMaxPinnedCollections: true,
      maxPinnedCollections: 1,
    });

    expect(toggleCollectionPin(draft, 'b')).toMatchObject({ limitReached: true, limit: 1 });
    expect(draft.collections.find((collection) => collection.id === 'b').pinned).toBeFalsy();
  });

  it('never pins the Current Session', () => {
    const draft = makeDraft();

    expect(toggleCollectionPin(draft, CURRENT_SESSION_ID).changed).toBe(false);
    expect(toggleTabPin(draft, CURRENT_SESSION_ID, 't1').changed).toBe(false);
  });

  it('refuses past the pinned-tab limit', () => {
    const draft = makeDraft([makeCollection('a', { tabs: [makeTab('t1', true), makeTab('t2')] })], {
      enforceMaxPinnedTabs: true,
      maxPinnedTabs: 1,
    });

    expect(toggleTabPin(draft, 'a', 't2')).toMatchObject({ limitReached: true, limit: 1 });
    expect(draft.collections[1].tabs.find((tab) => tab.id === 't2').pinned).toBe(false);
  });
});
