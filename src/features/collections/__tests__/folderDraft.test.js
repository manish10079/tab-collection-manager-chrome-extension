import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { reorderCollections } from '../lib/collectionDraft.js';
import {
  createFolder,
  deleteFolder,
  isFolderNameUnique,
  moveCollectionToFolder,
  nextFolderName,
  renameFolder,
  setFolderExpanded,
} from '../lib/folderDraft.js';

/** @param {Record<string, unknown>} [overrides] */
function draft(overrides = {}) {
  return {
    collections: [],
    folders: [],
    settings: {},
    ...overrides,
  };
}

const folder = (id, name) => ({ id, name, createdAt: 0, updatedAt: 0, isExpanded: false });
const collection = (id, name, folderId = null) => ({ id, name, tabs: [], folderId });

describe('createFolder', () => {
  it('creates an expanded, timestamped folder', () => {
    const state = draft();
    expect(createFolder(state, '  Work  ', 'f1')).toBe('created');
    expect(state.folders[0]).toMatchObject({ id: 'f1', name: 'Work', isExpanded: true });
  });

  it('refuses empty, too-long and duplicate names', () => {
    const state = draft({ folders: [folder('f1', 'Work')] });
    expect(createFolder(state, '   ', 'f2')).toBe('empty');
    expect(createFolder(state, 'x'.repeat(101), 'f2')).toBe('too-long');
    expect(createFolder(state, '  work  ', 'f2')).toBe('duplicate');
    expect(state.folders).toHaveLength(1);
  });
});

describe('nextFolderName', () => {
  it('returns "New folder" then the first free numbered name', () => {
    expect(nextFolderName([])).toBe('New folder');
    expect(nextFolderName([folder('a', 'New folder')])).toBe('New folder 2');
    expect(nextFolderName([folder('a', 'New folder'), folder('b', 'New folder 2')])).toBe(
      'New folder 3'
    );
  });
});

describe('isFolderNameUnique', () => {
  it('ignores case and whitespace and excludes the folder being renamed', () => {
    const folders = [folder('f1', 'Work')];
    expect(isFolderNameUnique(folders, ' work ')).toBe(false);
    expect(isFolderNameUnique(folders, 'Work', 'f1')).toBe(true);
  });
});

describe('renameFolder', () => {
  it('reports the refusal reasons', () => {
    const state = draft({ folders: [folder('f1', 'Work'), folder('f2', 'Study')] });
    expect(renameFolder(state, 'f1', '')).toBe('empty');
    expect(renameFolder(state, 'nope', 'X')).toBe('missing');
    expect(renameFolder(state, 'f1', 'Study')).toBe('duplicate');
    expect(renameFolder(state, 'f1', 'work')).toBe('unchanged');
  });

  it('renames a folder', () => {
    const state = draft({ folders: [folder('f1', 'Work')] });
    expect(renameFolder(state, 'f1', 'Projects')).toBe('renamed');
    expect(state.folders[0].name).toBe('Projects');
  });
});

describe('setFolderExpanded', () => {
  it('writes the value rather than toggling', () => {
    const state = draft({ folders: [folder('f1', 'Work')] });
    setFolderExpanded(state, 'f1', true);
    expect(state.folders[0].isExpanded).toBe(true);
    setFolderExpanded(state, 'f1', false);
    expect(state.folders[0].isExpanded).toBe(false);
  });
});

describe('deleteFolder', () => {
  it('removes the folder and the collections inside it', () => {
    const state = draft({
      folders: [folder('f1', 'Work')],
      collections: [collection('a', 'A', 'f1'), collection('b', 'B', 'f1'), collection('c', 'C')],
    });

    expect(deleteFolder(state, 'f1')).toEqual({ deleted: true, removedCollections: 2 });
    expect(state.folders).toEqual([]);
    // The two nested collections go with the folder; the root one stays.
    expect(state.collections.map((entry) => entry.id)).toEqual(['c']);
  });

  it('clears Auto-Save when its target was inside the folder', () => {
    const state = draft({
      folders: [folder('f1', 'Work')],
      collections: [collection('a', 'A', 'f1')],
    });
    state.settings.autoSaveCollectionId = 'a';

    deleteFolder(state, 'f1');

    expect(state.settings.autoSaveCollectionId).toBeNull();
  });

  it('reports a missing folder without touching anything', () => {
    const state = draft({ folders: [folder('f1', 'Work')] });
    expect(deleteFolder(state, 'ghost')).toEqual({ deleted: false, removedCollections: 0 });
    expect(state.folders).toHaveLength(1);
  });
});

describe('moveCollectionToFolder', () => {
  it('moves a collection in and back out', () => {
    const state = draft({ folders: [folder('f1', 'Work')], collections: [collection('a', 'A')] });

    expect(moveCollectionToFolder(state, 'a', 'f1')).toBe(true);
    expect(state.collections[0].folderId).toBe('f1');
    expect(moveCollectionToFolder(state, 'a', null)).toBe(true);
    expect(state.collections[0].folderId).toBeNull();
  });

  it('refuses an unknown folder, a missing collection and a no-op', () => {
    const state = draft({ folders: [folder('f1', 'Work')], collections: [collection('a', 'A')] });
    expect(moveCollectionToFolder(state, 'a', 'ghost')).toBe(false);
    expect(moveCollectionToFolder(state, 'nope', 'f1')).toBe(false);
    expect(moveCollectionToFolder(state, 'a', null)).toBe(false); // already at the root
  });

  it('refuses to file Current Session into a folder', () => {
    const state = draft({
      folders: [folder('f1', 'Work')],
      collections: [collection(CURRENT_SESSION_ID, 'Current Session')],
    });
    expect(moveCollectionToFolder(state, CURRENT_SESSION_ID, 'f1')).toBe(false);
    expect(state.collections[0].folderId).toBeNull();
  });
});

describe('reorderCollections across folders', () => {
  it('adopts the target collection folder', () => {
    const state = draft({
      collections: [collection('a', 'A'), collection('b', 'B', 'f1')],
      folders: [folder('f1', 'Work')],
      settings: { collectionSortType: 'nameAsc' },
    });

    reorderCollections(state, 'a', 'b');

    expect(state.collections.find((entry) => entry.id === 'a').folderId).toBe('f1');
    expect(state.settings.collectionSortType).toBe('custom');
  });

  it('moves a folder-nested collection back to the root when dropped on a root one', () => {
    const state = draft({
      collections: [collection('a', 'A'), collection('b', 'B', 'f1')],
      folders: [folder('f1', 'Work')],
    });

    reorderCollections(state, 'b', 'a');

    expect(state.collections.find((entry) => entry.id === 'b').folderId).toBeNull();
  });
});
