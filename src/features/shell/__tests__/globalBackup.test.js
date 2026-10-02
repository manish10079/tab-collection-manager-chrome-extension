import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import {
  buildCollectionsExport,
  extractImportedCollections,
  extractImportedFolders,
  isValidImportedCollection,
  mergeImportedCollections,
} from '../lib/globalBackup.js';

/** @param {object[]} [collections] @param {Record<string, unknown>} [settings] */
function draft(collections = [], settings = {}) {
  return {
    ready: true,
    error: null,
    collections,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    lastSessionBackup: null,
  };
}

/** @param {string} id @param {string} [title] @param {string} [url] @param {boolean} [pinned] */
function importedTab(id, title = id, url = `https://${id}.test`, pinned = false) {
  return { id, title, url, pinned };
}

describe('buildCollectionsExport', () => {
  it('wraps the collections and folders with an export timestamp', () => {
    const collections = [{ id: 'a', name: 'A', tabs: [] }];
    const folders = [{ id: 'f1', name: 'Work' }];
    const payload = buildCollectionsExport(
      collections,
      folders,
      new Date('2026-10-01T12:00:00.000Z')
    );

    expect(payload.exportedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(payload.collections).toBe(collections);
    expect(payload.folders).toBe(folders);
  });

  it('defaults the folders to an empty list', () => {
    expect(buildCollectionsExport([], undefined).folders).toEqual([]);
  });
});

describe('extractImportedCollections', () => {
  it('accepts a bare array and the export object', () => {
    expect(extractImportedCollections([{ name: 'A', tabs: [] }])).toHaveLength(1);
    expect(extractImportedCollections({ collections: [{ name: 'A', tabs: [] }] })).toHaveLength(1);
  });

  it('rejects anything else', () => {
    expect(extractImportedCollections(null)).toBeNull();
    expect(extractImportedCollections({ foo: 1 })).toBeNull();
  });
});

describe('extractImportedFolders', () => {
  it('reads the folders from an export object', () => {
    expect(extractImportedFolders({ folders: [{ id: 'f1', name: 'Work' }] })).toHaveLength(1);
  });

  it('returns an empty list for a bare array or a missing field', () => {
    expect(extractImportedFolders([{ name: 'A', tabs: [] }])).toEqual([]);
    expect(extractImportedFolders({ collections: [] })).toEqual([]);
    expect(extractImportedFolders(null)).toEqual([]);
  });
});

describe('isValidImportedCollection', () => {
  it('requires a name and a tabs array', () => {
    expect(isValidImportedCollection({ name: 'A', tabs: [] })).toBe(true);
    expect(isValidImportedCollection({ name: '', tabs: [] })).toBe(false);
    expect(isValidImportedCollection({ name: 'A' })).toBe(false);
    expect(isValidImportedCollection(null)).toBe(false);
  });
});

describe('mergeImportedCollections', () => {
  it('adds a new collection with its valid tabs and skips the rest', () => {
    const target = draft();
    const outcome = mergeImportedCollections(target, [
      { name: 'Imported', tabs: [importedTab('t1'), { title: 'no url' }] },
      { id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [importedTab('t2')] },
      null,
    ]);

    expect(outcome).toEqual({ added: 1, merged: 0, skipped: 2 });
    expect(target.collections).toHaveLength(1);
    expect(target.collections[0].name).toBe('Imported');
    expect(target.collections[0].tabs).toHaveLength(1);
    // A fresh id is minted rather than reusing the imported one.
    expect(target.collections[0].tabs[0].id).not.toBe('t1');
  });

  it('merges into a same-named collection without duplicating URLs', () => {
    const target = draft([
      { id: 'a', name: 'Alpha', tabs: [{ id: 'e1', title: 'E', url: 'https://e.test' }] },
    ]);

    const outcome = mergeImportedCollections(target, [
      {
        name: 'alpha',
        tabs: [importedTab('dup', 'Dup', 'https://e.test/'), importedTab('new', 'New')],
      },
    ]);

    expect(outcome).toEqual({ added: 0, merged: 1, skipped: 0 });
    expect(target.collections[0].tabs.map((tab) => tab.title)).toEqual(['E', 'New']);
  });

  it('does not count a merge that added nothing', () => {
    const target = draft([
      { id: 'a', name: 'Alpha', tabs: [{ id: 'e1', title: 'E', url: 'https://e.test' }] },
    ]);
    const outcome = mergeImportedCollections(target, [
      { name: 'Alpha', tabs: [importedTab('dup', 'Dup', 'https://e.test')] },
    ]);

    expect(outcome).toEqual({ added: 0, merged: 0, skipped: 0 });
  });

  it('stops at the per-collection tab cap', () => {
    const full = Array.from({ length: LIMITS.MAX_TABS_PER_COLLECTION }, (_, index) =>
      importedTab(`f${index}`)
    );
    const target = draft([{ id: 'a', name: 'Alpha', tabs: full }]);

    mergeImportedCollections(target, [{ name: 'Alpha', tabs: [importedTab('extra')] }]);

    expect(target.collections[0].tabs).toHaveLength(LIMITS.MAX_TABS_PER_COLLECTION);
  });

  it('demotes tabs and collections past their pinned limits', () => {
    const target = draft(
      [
        {
          id: 'a',
          name: 'Alpha',
          pinned: true,
          tabs: [{ id: 'p1', title: 'P', url: 'https://p.test', pinned: true }],
        },
      ],
      { maxPinnedCollections: 1, maxPinnedTabs: 1 }
    );

    mergeImportedCollections(target, [
      {
        name: 'Beta',
        pinned: true,
        tabs: [
          importedTab('b1', 'B1', 'https://b1.test', true),
          importedTab('b2', 'B2', 'https://b2.test', true),
        ],
      },
    ]);

    const beta = target.collections.find((entry) => entry.name === 'Beta');
    expect(beta.pinned).toBe(false);
    // The first pinned tab is within the per-collection limit; the second is not.
    expect(beta.tabs.map((tab) => tab.pinned)).toEqual([true, false]);
  });

  it('restores folders and assigns an imported collection to its folder', () => {
    const target = draft();
    mergeImportedCollections(
      target,
      [{ name: 'Nested', tabs: [], folderId: 'f1' }],
      [{ id: 'f1', name: 'Work' }]
    );

    expect(target.folders.map((folder) => folder.name)).toEqual(['Work']);
    const nested = target.collections.find((entry) => entry.name === 'Nested');
    expect(nested.folderId).toBe(target.folders[0].id);
    // The imported folder id is remapped to a freshly minted one.
    expect(nested.folderId).not.toBe('f1');
  });

  it('reuses a same-named folder instead of duplicating it', () => {
    const target = draft([], {});
    target.folders = [{ id: 'existing', name: 'work' }];

    mergeImportedCollections(
      target,
      [{ name: 'Nested', tabs: [], folderId: 'f1' }],
      [{ id: 'f1', name: 'Work' }]
    );

    expect(target.folders).toHaveLength(1);
    expect(target.collections[0].folderId).toBe('existing');
  });

  it('leaves a collection at the root when its folder is missing from the file', () => {
    const target = draft();
    mergeImportedCollections(target, [{ name: 'Orphan', tabs: [], folderId: 'ghost' }], []);

    expect(target.folders).toEqual([]);
    expect(target.collections[0].folderId).toBeNull();
  });

  it('imports a legacy file without folders as all-root collections', () => {
    const target = draft();
    mergeImportedCollections(target, [{ name: 'Legacy', tabs: [], folderId: 'f1' }]);

    expect(target.folders).toEqual([]);
    expect(target.collections[0].folderId).toBeNull();
  });

  it('creates the folders array when the draft does not have one', () => {
    const legacyDraft = draft();
    delete legacyDraft.folders;

    mergeImportedCollections(legacyDraft, [], [{ id: 'f1', name: 'Work' }]);

    expect(legacyDraft.folders.map((folder) => folder.name)).toEqual(['Work']);
  });

  it('keeps Current Session first after re-partitioning', () => {
    const target = draft([
      { id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [] },
      { id: 'a', name: 'Alpha', tabs: [] },
    ]);

    mergeImportedCollections(target, [{ name: 'Alpha', tabs: [importedTab('t1')] }]);

    expect(target.collections[0].id).toBe(CURRENT_SESSION_ID);
  });
});
