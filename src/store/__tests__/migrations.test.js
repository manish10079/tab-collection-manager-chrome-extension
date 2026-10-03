import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../shared/constants.js';
import { up as foldersUp } from '../migrations/0001-folders.js';
import { up as sessionGroupsUp } from '../migrations/0002-session-groups.js';
import { up as colorsUp } from '../migrations/0003-colors.js';
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

describe('migration 0002 — session snapshot tab groups', () => {
  it('gives a pre-migration restore point and history entries an empty group map', () => {
    // A real pre-2.3 fixture: the worker wrote these before it carried the metadata its own tabs
    // reference, which is why their groups could never be rebuilt.
    const migrated = sessionGroupsUp({
      schemaVersion: 1,
      lastSessionBackup: {
        tabs: [{ id: 't1', url: 'https://a.test', chromeGroupId: 4 }],
        timestamp: 1,
        collectionId: 'auto',
        name: 'Auto',
      },
      sessionHistory: [
        { id: 'h1', timestamp: 2, tabs: [{ id: 't2', url: 'https://b.test', chromeGroupId: 4 }] },
        'not-an-object',
      ],
    });

    expect(migrated.lastSessionBackup.chromeGroups).toEqual({});
    expect(migrated.lastSessionBackup.tabs).toHaveLength(1);
    expect(migrated.sessionHistory[0].chromeGroups).toEqual({});
    // The junk entry is passed through rather than crashing the migration.
    expect(migrated.sessionHistory[1]).toBe('not-an-object');
  });

  it('leaves a snapshot that already has groups alone, and is idempotent', () => {
    const groups = { 4: { title: 'Docs', color: 'blue', collapsed: false } };
    const once = sessionGroupsUp({
      lastSessionBackup: { tabs: [], chromeGroups: groups },
      sessionHistory: [{ id: 'h1', tabs: [], chromeGroups: groups }],
    });
    const twice = sessionGroupsUp(once);

    expect(once.lastSessionBackup.chromeGroups).toEqual(groups);
    expect(twice).toEqual(once);
  });

  it('replaces a malformed map instead of trusting it', () => {
    const migrated = sessionGroupsUp({
      lastSessionBackup: { tabs: [], chromeGroups: ['nope'] },
      sessionHistory: [{ id: 'h1', tabs: [], chromeGroups: 'nope' }],
    });

    expect(migrated.lastSessionBackup.chromeGroups).toEqual({});
    expect(migrated.sessionHistory[0].chromeGroups).toEqual({});
  });

  it('tolerates storage with no snapshots at all', () => {
    const migrated = sessionGroupsUp({ collections: [] });

    expect(migrated.lastSessionBackup).toBeUndefined();
    expect(migrated.sessionHistory).toBeUndefined();
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

  it('brings a folders-era profile up to the current version too', () => {
    // The realistic upgrade path for an existing user: schemaVersion 1, snapshots without groups.
    const { data, from, changed } = runMigrations({
      schemaVersion: 1,
      collections: [{ id: 'a', name: 'A', tabs: [] }],
      folders: [],
      lastSessionBackup: { tabs: [{ id: 't1', url: 'https://a.test', chromeGroupId: 9 }] },
    });

    expect(changed).toBe(true);
    expect(from).toBe(1);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.lastSessionBackup.chromeGroups).toEqual({});
    // The folders migration is not re-applied to data that already has folders.
    expect(data.folders).toEqual([]);
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

describe('migration 0003 — colors', () => {
  it('pins a null colour on every collection and folder', () => {
    const migrated = colorsUp({
      collections: [{ id: 'a' }, { id: 'b', color: 'blue' }],
      folders: [{ id: 'f1' }],
    });

    expect(migrated.collections.map((entry) => entry.color)).toEqual([null, 'blue']);
    expect(migrated.folders[0].color).toBeNull();
  });

  it('replaces a malformed colour and is idempotent', () => {
    const once = colorsUp({
      collections: [{ id: 'a', color: 42 }, 'not-an-object'],
      folders: [],
    });
    const twice = colorsUp(once);

    expect(once.collections[0].color).toBeNull();
    expect(once.collections[1]).toBe('not-an-object');
    expect(twice).toEqual(once);
  });

  it('tolerates storage with no collections or folders', () => {
    expect(colorsUp({})).toEqual({});
  });
});

describe('normalizeState colors', () => {
  it('defaults a missing colour to null on both items', () => {
    const state = normalizeState({
      collections: [{ id: 'a', name: 'A', tabs: [] }],
      folders: [{ id: 'f1', name: 'Work' }],
    });

    expect(state.collections[0].color).toBeNull();
    expect(state.folders[0].color).toBeNull();
  });

  it('keeps a colour id and normalizes the stored palette', () => {
    const state = normalizeState({
      collections: [{ id: 'a', name: 'A', tabs: [], color: 'blue' }],
      customColors: [
        { id: 'c1', name: 'Ocean', value: '#00FF88' },
        { id: '', name: 'bad' },
      ],
    });

    expect(state.collections[0].color).toBe('blue');
    expect(state.settings.customColors).toEqual([{ id: 'c1', name: 'Ocean', value: '#00ff88' }]);
  });
});
