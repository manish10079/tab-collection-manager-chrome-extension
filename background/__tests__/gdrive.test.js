import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../../tests/mocks/chrome.js';
import { CURRENT_SESSION_ID } from '../../src/shared/storage-keys.js';
import { buildBackupPayload, restoreFromGDrive } from '../gdrive.js';

/**
 * The Drive backup is the other way data leaves the extension. The payload and the restore are
 * driven here with a stubbed `fetch` and identity so the round trip is asserted end to end: the
 * colour labels on folders/collections and the custom palette they resolve against.
 */

/** @param {Record<string, unknown>} [storage] */
function setup(storage = {}) {
  const { store, chrome } = installChromeMock(storage);
  chrome.identity = {
    getAuthToken: (_options, callback) => callback('test-token'),
    removeCachedAuthToken: (_options, callback) => callback(),
  };
  return { store, chrome };
}

/** @param {Record<string, unknown>|unknown} backup */
function stubDriveFetch(backup) {
  globalThis.fetch = vi.fn(async (url) => {
    const target = String(url);
    if (target.includes('alt=media')) {
      return { ok: true, json: async () => backup };
    }
    return {
      ok: true,
      json: async () => ({ files: [{ id: 'file-1', modifiedTime: '2026-10-01T00:00:00.000Z' }] }),
    };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error the test removes the stub it installed
  delete globalThis.fetch;
});

describe('buildBackupPayload', () => {
  it('carries the collections, folders and custom palette', async () => {
    setup({
      collections: [{ id: 'a', name: 'A', tabs: [], color: 'custom-1' }],
      folders: [{ id: 'f1', name: 'Work', color: 'blue' }],
      customColors: [{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }],
    });

    const payload = await buildBackupPayload();

    expect(payload.folders[0].color).toBe('blue');
    expect(payload.collections[0].color).toBe('custom-1');
    expect(payload.customColors).toEqual([{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }]);
  });

  it('defaults a profile without a palette to an empty list', async () => {
    setup({ collections: [] });

    expect((await buildBackupPayload()).customColors).toEqual([]);
  });
});

describe('restoreFromGDrive colours', () => {
  it('restores the palette and the labels that resolve against it', async () => {
    const { store } = setup({
      collections: [{ id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [] }],
      folders: [],
      customColors: [],
    });
    stubDriveFetch({
      exportedAt: '2026-10-01T00:00:00.000Z',
      collections: [
        { id: 'x', name: 'Restored', tabs: [], color: 'custom-1' },
        { id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [{ id: 'live' }] },
      ],
      folders: [{ id: 'f1', name: 'Work', color: 'blue' }],
      customColors: [{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }],
      settings: {},
    });

    await restoreFromGDrive();

    expect(store.customColors).toEqual([{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }]);
    expect(store.folders[0].color).toBe('blue');
    // Current Session stays the live one, and the restored label comes with the collection.
    expect(store.collections[0].id).toBe(CURRENT_SESSION_ID);
    expect(store.collections.find((c) => c.name === 'Restored').color).toBe('custom-1');
  });

  it('drops a label whose custom colour the backup did not carry', async () => {
    const { store } = setup({ collections: [], folders: [], customColors: [] });
    stubDriveFetch({
      collections: [{ id: 'x', name: 'Dangling', tabs: [], color: 'custom-9' }],
      folders: [{ id: 'f1', name: 'Work', color: 'custom-9' }],
      customColors: [],
      settings: {},
    });

    await restoreFromGDrive();

    expect(store.collections.find((c) => c.name === 'Dangling').color).toBeNull();
    expect(store.folders[0].color).toBeNull();
  });

  it('keeps a built-in label even when the backup has no palette', async () => {
    const { store } = setup({ collections: [], folders: [], customColors: [] });
    stubDriveFetch({
      collections: [{ id: 'x', name: 'Red one', tabs: [], color: 'red' }],
      folders: [],
      settings: {},
    });

    await restoreFromGDrive();

    expect(store.collections.find((c) => c.name === 'Red one').color).toBe('red');
  });

  it('merges unique Current Session tabs and skips URLs already present', async () => {
    const { store } = setup({
      collections: [
        {
          id: CURRENT_SESSION_ID,
          name: 'Current Session',
          tabs: [{ id: 'live', url: 'https://already.example/' }],
        },
      ],
      folders: [],
    });
    stubDriveFetch({
      collections: [
        {
          id: CURRENT_SESSION_ID,
          name: 'Current Session',
          tabs: [
            { id: 'a', url: 'https://already.example/' },
            { id: 'b', url: 'https://from-drive.example/' },
            { id: 'c', url: 'https://from-drive.example/' },
            { id: 'd', url: '  ' },
          ],
        },
      ],
      folders: [],
      settings: {},
    });

    await restoreFromGDrive();

    expect(store.collections).toHaveLength(1);
    expect(store.collections[0].id).toBe(CURRENT_SESSION_ID);
    expect(store.collections[0].tabs.map((tab) => tab.url)).toEqual([
      'https://already.example/',
      'https://from-drive.example/',
    ]);
  });

  it('merges same-named collections and keeps collections not in the backup', async () => {
    const { store } = setup({
      collections: [
        {
          id: CURRENT_SESSION_ID,
          name: 'Current Session',
          tabs: [],
        },
        {
          id: 'work-local',
          name: 'Work',
          tabs: [{ id: 't1', url: 'https://keep.example/' }],
        },
        { id: 'only-here', name: 'Local Only', tabs: [] },
      ],
      folders: [{ id: 'f-local', name: 'Inbox', color: 'red' }],
    });
    stubDriveFetch({
      collections: [
        {
          id: 'work-drive',
          name: 'Work',
          tabs: [
            { id: 'a', url: 'https://keep.example/' },
            { id: 'b', url: 'https://new.example/' },
          ],
        },
      ],
      folders: [{ id: 'f1', name: 'Inbox', color: 'blue' }],
      settings: {},
    });

    await restoreFromGDrive();

    expect(store.collections.map((c) => c.name)).toEqual([
      'Current Session',
      'Work',
      'Local Only',
    ]);
    expect(store.collections.find((c) => c.name === 'Work').id).toBe('work-local');
    expect(store.collections.find((c) => c.name === 'Work').tabs.map((tab) => tab.url)).toEqual([
      'https://keep.example/',
      'https://new.example/',
    ]);
    expect(store.folders[0]).toMatchObject({ id: 'f-local', name: 'Inbox', color: 'red' });
  });
});
