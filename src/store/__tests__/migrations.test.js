import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../shared/constants.js';
import { up as foldersUp } from '../migrations/0001-folders.js';
import { runMigrations } from '../migrations/index.js';
import { normalizeState } from '../schema.js';

describe('migration 0001 — folders', () => {
  it('introduces the folders array and pins folderId on every collection', () => {
    const migrated = foldersUp({
      collections: [
        { id: 'a', name: 'A', tabs: [] },
        { id: 'b', name: 'B', tabs: [] },
      ],
    });

    expect(migrated.folders).toEqual([]);
    expect(migrated.collections.map((collection) => collection.folderId)).toEqual([null, null]);
  });

  it('leaves existing folders and folder memberships alone', () => {
    const migrated = foldersUp({
      folders: [{ id: 'f1', name: 'Work' }],
      collections: [{ id: 'a', folderId: 'f1' }],
    });

    expect(migrated.folders).toEqual([{ id: 'f1', name: 'Work' }]);
    expect(migrated.collections[0].folderId).toBe('f1');
  });

  it('tolerates a missing collections array', () => {
    expect(foldersUp({}).collections).toEqual([]);
  });
});

describe('runMigrations', () => {
  it('migrates a pre-folders profile and stamps the current version', () => {
    const { data, from, changed } = runMigrations({ collections: [{ id: 'a', name: 'A' }] });

    expect(changed).toBe(true);
    expect(from).toBe(0);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.folders).toEqual([]);
    expect(data.collections[0].folderId).toBeNull();
  });

  it('is a no-op once storage is current', () => {
    const raw = { schemaVersion: SCHEMA_VERSION, folders: [], collections: [] };
    const { data, changed } = runMigrations(raw);

    expect(changed).toBe(false);
    expect(data).toBe(raw);
  });
});

describe('normalizeState folders', () => {
  it('treats a legacy profile as all-root collections', () => {
    const state = normalizeState({ collections: [{ id: 'a', name: 'A', tabs: [] }] });

    expect(state.folders).toEqual([]);
    expect(state.collections[0].folderId).toBeNull();
  });

  it('drops a folderId whose folder is gone', () => {
    const state = normalizeState({
      collections: [{ id: 'a', name: 'A', tabs: [], folderId: 'ghost' }],
      folders: [{ id: 'f1', name: 'Work' }],
    });

    expect(state.collections[0].folderId).toBeNull();
  });

  it('keeps a folderId that resolves and normalizes the folder', () => {
    const state = normalizeState({
      collections: [{ id: 'a', name: 'A', tabs: [], folderId: 'f1' }],
      folders: [{ id: 'f1' }],
    });

    expect(state.collections[0].folderId).toBe('f1');
    expect(state.folders[0].name).toBe('Folder');
    expect(state.folders[0].isExpanded).toBe(false);
  });
});
