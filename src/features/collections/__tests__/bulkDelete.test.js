import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { deleteSelection, describeSelection, summarizeSelection } from '../lib/bulkDelete.js';

const folder = (id, name = id) => ({ id, name });
/** @param {string} id @param {string|null} [folderId] @param {number} [tabCount] */
const collection = (id, folderId = null, tabCount = 0) => ({
  id,
  name: id,
  folderId,
  tabs: Array.from({ length: tabCount }, (_, index) => ({ id: `${id}-t${index}` })),
});

/** @param {Record<string, unknown>} [overrides] */
function state(overrides = {}) {
  return {
    collections: [],
    folders: [],
    settings: { autoSaveCollectionId: null },
    ...overrides,
  };
}

describe('summarizeSelection', () => {
  it('counts a selected folder together with the collections inside it', () => {
    const draft = state({
      folders: [folder('f1')],
      collections: [collection('a', 'f1', 2), collection('b'), collection('c', 'f1')],
    });

    expect(summarizeSelection(draft, { folderIds: ['f1'] })).toEqual({
      folders: 1,
      collections: 2,
      tabs: 2,
    });
  });

  it('never counts the live Current Session', () => {
    const draft = state({
      collections: [collection(CURRENT_SESSION_ID), collection('a', null, 1)],
    });

    expect(summarizeSelection(draft, { collectionIds: [CURRENT_SESSION_ID, 'a'] })).toEqual({
      folders: 0,
      collections: 1,
      tabs: 1,
    });
  });

  it('is empty for an empty selection', () => {
    expect(summarizeSelection(state(), {})).toEqual({ folders: 0, collections: 0, tabs: 0 });
  });
});

describe('deleteSelection', () => {
  it('removes the folders with their collections and the selected collections', () => {
    const draft = state({
      folders: [folder('f1'), folder('f2')],
      collections: [collection('a', 'f1'), collection('b', 'f2'), collection('c')],
      settings: { autoSaveCollectionId: 'a' },
    });

    expect(deleteSelection(draft, { folderIds: ['f1'], collectionIds: ['c'] })).toEqual({
      removedFolders: 1,
      removedCollections: 2,
      removedTabs: 0,
    });
    expect(draft.folders.map((entry) => entry.id)).toEqual(['f2']);
    expect(draft.collections.map((entry) => entry.id)).toEqual(['b']);
    expect(draft.settings.autoSaveCollectionId).toBeNull();
  });

  it('keeps the Current Session even when it is in the selection', () => {
    const draft = state({ collections: [collection(CURRENT_SESSION_ID), collection('a')] });

    const result = deleteSelection(draft, { collectionIds: [CURRENT_SESSION_ID, 'a'] });

    expect(result.removedCollections).toBe(1);
    expect(draft.collections.map((entry) => entry.id)).toEqual([CURRENT_SESSION_ID]);
  });

  it('counts the tabs it removes', () => {
    const draft = state({ collections: [collection('a', null, 3)] });

    expect(deleteSelection(draft, { collectionIds: ['a'] }).removedTabs).toBe(3);
  });
});

describe('describeSelection', () => {
  it('names the folders, collections and tabs and warns about the cascade', () => {
    const message = describeSelection({ folders: 1, collections: 2, tabs: 5 });

    expect(message).toContain('1 folder and 2 collections');
    expect(message).toContain('(5 tabs)');
    expect(message).toContain('Collections inside a deleted folder are deleted too');
  });

  it('reads cleanly for a single collection', () => {
    expect(describeSelection({ folders: 0, collections: 1, tabs: 0 })).toBe(
      'Delete 1 collection? Collections inside a deleted folder are deleted too. This cannot be undone.'
    );
  });
});
