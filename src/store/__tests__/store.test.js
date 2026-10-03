import { describe, expect, it } from 'vitest';
import { getSnapshot, hydrate, mutate } from '../store.js';
import { installChromeMock } from '../../../tests/mocks/chrome.js';

/**
 * Keys the UI owns. All but the first two are the legacy `setState` set; `folders` and
 * `schemaVersion` joined it with the folder feature (skill.md §7.1).
 */
const WRITABLE_KEYS = [
  'collections',
  'folders',
  'schemaVersion',
  'autoSaveCollectionId',
  'lastSessionBackup',
  'ramSaverEnabled',
  'collectionSortType',
  'layoutViewMode',
  'theme',
  'enforceMaxPinnedTabs',
  'maxPinnedTabs',
  'enforceMaxPinnedCollections',
  'maxPinnedCollections',
  'gdriveBackupEnabled',
  'gdriveAutoBackupEnabled',
  'customColors',
];

describe('store hydration', () => {
  it('coerces broken storage into a safe snapshot', async () => {
    installChromeMock({ collections: [{ id: 'a', name: 'A', tabs: 'nope' }] });

    await hydrate();

    expect(getSnapshot().collections).toHaveLength(1);
    expect(getSnapshot().collections[0].tabs).toEqual([]);
    expect(getSnapshot().collections[0].name).toBe('A');
    expect(getSnapshot().ready).toBe(true);
  });

  it('applies setting defaults for missing keys', async () => {
    installChromeMock({});

    await hydrate();

    expect(getSnapshot().settings.collectionSortType).toBe('custom');
    expect(getSnapshot().settings.maxPinnedTabs).toBe(3);
    expect(getSnapshot().lastSessionBackup).toBeNull();
  });
});

describe('store mutations', () => {
  it('writes exactly the legacy key set and preserves the session backup', async () => {
    const backup = { tabs: [{ id: 'x1' }], name: 'Backup' };
    const { store } = installChromeMock({
      collections: [{ id: 'a', name: 'A', tabs: [] }],
      lastSessionBackup: backup,
      sessionHistory: [{ id: 'h1' }],
    });
    await hydrate();

    await mutate((draft) => {
      draft.collections[0].name = 'Renamed';
    });

    expect(store.collections[0].name).toBe('Renamed');
    // Carried through untouched apart from the migration's group map, which is additive: a snapshot
    // that predates it gains an empty one so its tabs still restore (ungrouped) as before.
    expect(store.lastSessionBackup).toEqual({ ...backup, chromeGroups: {} });
    // The service worker owns sessionHistory — a UI write must not touch it.
    expect(store.sessionHistory).toEqual([{ id: 'h1' }]);
    expect(Object.keys(store).sort()).toEqual([...WRITABLE_KEYS, 'sessionHistory'].sort());
  });

  it('serializes concurrent mutations so none is lost', async () => {
    const { store } = installChromeMock({
      collections: [{ id: 'a', name: 'A', tabs: [], isExpanded: false }],
    });
    await hydrate();

    await Promise.all([
      mutate((draft) => {
        draft.collections[0].isExpanded = true;
      }),
      mutate((draft) => {
        draft.collections[0].name = 'Second';
      }),
    ]);

    expect(store.collections[0].isExpanded).toBe(true);
    expect(store.collections[0].name).toBe('Second');
  });
});
