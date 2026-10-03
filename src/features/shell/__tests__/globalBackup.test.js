import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import {
  buildCollectionsExport,
  extractImportedCollections,
  extractImportedCustomColors,
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
  it('wraps the collections, folders and palette with an export timestamp', () => {
    const collections = [{ id: 'a', name: 'A', tabs: [] }];
    const folders = [{ id: 'f1', name: 'Work' }];
    const palette = [{ id: 'custom-1', name: 'Ocean', value: '#0088ff' }];
    const payload = buildCollectionsExport(
      collections,
      folders,
      palette,
      new Date('2026-10-01T12:00:00.000Z')
    );

    expect(payload.exportedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(payload.collections).toBe(collections);
    expect(payload.folders).toBe(folders);
    expect(payload.customColors).toBe(palette);
  });

  it('defaults the folders and palette to empty lists', () => {
    const payload = buildCollectionsExport([], undefined);

    expect(payload.folders).toEqual([]);
    expect(payload.customColors).toEqual([]);
  });
});

describe('extractImportedCustomColors', () => {
  it('reads and sanitizes the palette from an export object', () => {
    expect(
      extractImportedCustomColors({
        customColors: [
          { id: 'c1', name: 'Ocean', value: '#00FF88' },
          { id: '', name: 'bad' },
        ],
      })
    ).toEqual([{ id: 'c1', name: 'Ocean', value: '#00ff88' }]);
  });

  it('returns an empty list for a bare array or a missing field', () => {
    expect(extractImportedCustomColors([{ name: 'A', tabs: [] }])).toEqual([]);
    expect(extractImportedCustomColors({ collections: [] })).toEqual([]);
    expect(extractImportedCustomColors(null)).toEqual([]);
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

/**
 * Colour labels and the custom palette through export/import. A label is shared across folders and
 * collections, and a custom label is only meaningful against the palette that defines it, so the
 * palette has to travel with the file and the label has to be remapped onto the merged palette.
 */
describe('mergeImportedCollections colours', () => {
  const sun = { id: 'custom-1', name: 'Sunset', value: '#ff8800' };

  it('imports the palette and restores labels on new folders and collections', () => {
    const target = draft();
    mergeImportedCollections(
      target,
      [{ name: 'Blue one', tabs: [], color: 'blue' }],
      [{ id: 'f1', name: 'Work', color: 'custom-1' }],
      [sun]
    );

    expect(target.settings.customColors).toEqual([sun]);
    expect(target.folders[0].color).toBe('custom-1');
    expect(target.collections[0].color).toBe('blue');
  });

  it('reuses an existing same-named colour and remaps the label onto its id', () => {
    const target = draft([], {
      customColors: [{ id: 'existing', name: 'sunset', value: '#ff8800' }],
    });

    mergeImportedCollections(
      target,
      [{ name: 'Labelled', tabs: [], color: 'custom-1' }],
      [],
      [sun]
    );

    // The palette is not duplicated and the label points at the id that already exists.
    expect(target.settings.customColors).toHaveLength(1);
    expect(target.collections[0].color).toBe('existing');
  });

  it('drops a custom label the file did not carry, keeping the built-in ones', () => {
    const target = draft();
    mergeImportedCollections(
      target,
      [
        { name: 'Dangling', tabs: [], color: 'custom-9' },
        { name: 'Built-in', tabs: [], color: 'red' },
      ],
      [{ id: 'f1', name: 'Work', color: 'custom-9' }]
    );

    expect(target.collections.find((c) => c.name === 'Dangling').color).toBeNull();
    expect(target.collections.find((c) => c.name === 'Built-in').color).toBe('red');
    expect(target.folders[0].color).toBeNull();
  });

  it('adopts an imported label on a merge only when the existing item has none', () => {
    const target = draft([
      { id: 'a', name: 'Alpha', tabs: [], color: null },
      { id: 'b', name: 'Beta', tabs: [], color: 'green' },
    ]);

    mergeImportedCollections(target, [
      { name: 'Alpha', tabs: [importedTab('t1')], color: 'red' },
      { name: 'Beta', tabs: [importedTab('t2')], color: 'red' },
    ]);

    expect(target.collections.find((c) => c.name === 'Alpha').color).toBe('red');
    expect(target.collections.find((c) => c.name === 'Beta').color).toBe('green');
  });

  it('round-trips colours and the palette through build then merge', () => {
    const payload = buildCollectionsExport(
      [{ id: 'a', name: 'Labeled', tabs: [], color: 'custom-1' }],
      [{ id: 'f1', name: 'Work', color: 'blue' }],
      [sun]
    );

    const target = draft();
    mergeImportedCollections(
      target,
      extractImportedCollections(payload) ?? [],
      extractImportedFolders(payload),
      extractImportedCustomColors(payload)
    );

    expect(target.settings.customColors).toEqual([sun]);
    expect(target.collections[0].color).toBe('custom-1');
    expect(target.folders[0].color).toBe('blue');
  });
});

/**
 * Chrome tab groups through export/import. A saved tab references its group by number, so the
 * group's metadata has to travel with the collection — the importer used to drop both, which
 * silently flattened every group in a backup and left the tabs pointing at ids that resolved to
 * nothing.
 */
describe('mergeImportedCollections tab groups', () => {
  const docs = { title: 'Docs', color: 'blue', collapsed: false };
  const research = { title: 'Research', color: 'green', collapsed: true };

  /** A tab that belongs to a group. @param {string} id @param {number} groupId */
  function groupedTab(id, groupId) {
    return { ...importedTab(id), chromeGroupId: groupId };
  }

  it('restores the groups of an imported collection', () => {
    const target = draft();
    mergeImportedCollections(target, [
      {
        name: 'Work',
        tabs: [groupedTab('t1', 7), groupedTab('t2', 7), importedTab('t3')],
        chromeGroups: { 7: docs },
      },
    ]);

    const collection = target.collections[0];
    expect(collection.chromeGroups).toEqual({ 7: docs });
    expect(collection.tabs.map((tab) => tab.chromeGroupId)).toEqual([7, 7, null]);
  });

  it('drops a group reference the file did not carry, keeping the tab', () => {
    const target = draft();
    mergeImportedCollections(target, [
      { name: 'Work', tabs: [groupedTab('t1', 3)], chromeGroups: { 8: docs } },
    ]);

    expect(target.collections[0].tabs).toHaveLength(1);
    expect(target.collections[0].tabs[0].chromeGroupId).toBeNull();
    expect(target.collections[0].chromeGroups).toEqual({});
  });

  it('ignores a malformed group map instead of failing the import', () => {
    const target = draft();
    mergeImportedCollections(target, [
      { name: 'Work', tabs: [groupedTab('t1', 1)], chromeGroups: 'not-a-map' },
    ]);
    mergeImportedCollections(target, [
      {
        name: 'Other',
        tabs: [groupedTab('t2', 2)],
        // Only integer keys are reachable by a tab's numeric `chromeGroupId`.
        chromeGroups: { 2: research, nonsense: docs, 3: { title: 5 } },
      },
    ]);

    expect(target.collections[0].chromeGroups).toEqual({});
    expect(target.collections[1].chromeGroups).toEqual({ 2: research });
    expect(target.collections[1].tabs[0].chromeGroupId).toBe(2);
  });

  it('keeps an appended tab in its group when merging into an existing collection', () => {
    const target = draft([
      {
        id: 'a',
        name: 'Alpha',
        tabs: [{ id: 'old', title: 'old', url: 'https://old.test', chromeGroupId: 1 }],
        chromeGroups: { 1: research },
      },
    ]);

    mergeImportedCollections(target, [
      { name: 'Alpha', tabs: [groupedTab('t1', 1)], chromeGroups: { 1: docs } },
    ]);

    const collection = target.collections[0];
    // The file's group 1 differs from the collection's group 1, so it takes a free key rather than
    // overwriting the group the existing tab still points at.
    expect(collection.chromeGroups).toEqual({ 1: research, 2: docs });
    expect(collection.tabs.map((tab) => tab.chromeGroupId)).toEqual([1, 2]);
  });

  it('reuses an identical group rather than duplicating it on a re-import', () => {
    const target = draft([
      {
        id: 'a',
        name: 'Alpha',
        tabs: [{ id: 'old', title: 'old', url: 'https://old.test', chromeGroupId: 1 }],
        chromeGroups: { 1: docs },
      },
    ]);

    mergeImportedCollections(target, [
      { name: 'Alpha', tabs: [groupedTab('t1', 1)], chromeGroups: { 1: docs } },
    ]);

    const collection = target.collections[0];
    expect(collection.chromeGroups).toEqual({ 1: docs });
    expect(collection.tabs.map((tab) => tab.chromeGroupId)).toEqual([1, 1]);
  });

  it("numbers an imported collection's tabs sequentially", () => {
    const target = draft();
    mergeImportedCollections(target, [
      { name: 'Work', tabs: [importedTab('t1'), importedTab('t2'), importedTab('t3')] },
    ]);

    // `index` is the tab's position; a constant 0 for every tab was metadata that lied.
    expect(target.collections[0].tabs.map((tab) => tab.index)).toEqual([0, 1, 2]);
  });
});
