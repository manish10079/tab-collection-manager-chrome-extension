import { beforeEach, describe, expect, it } from 'vitest';
import { publishStoreBridge } from '../legacy-store.js';
import { getSnapshot, hydrate, mutate } from '../../store/store.js';
import { installChromeMock } from '../../../tests/mocks/chrome.js';
import { STORAGE_KEYS } from '../../shared/storage-keys.js';

/**
 * The bridge is what lets `popup.js` keep its flat, in-place-mutation style while every write in
 * the extension goes through the store's one serialized queue. These tests guard the two halves
 * of that promise: the shapes do not leak into each other, and two mutations from different
 * callers cannot lose one another.
 */

/**
 * Keys a UI mutation writes: derived, because the bridge's promise is that a legacy mutation
 * writes *exactly* what the store writes — no extra key, nothing the worker owns.
 */
const WRITABLE_KEYS = Object.values(STORAGE_KEYS).filter(
  (key) => key !== STORAGE_KEYS.sessionHistory
);

const BRIDGE_METHODS = ['isReady', 'hydrate', 'getLegacyState', 'mutateLegacy'];

describe('store bridge', () => {
  beforeEach(() => {
    publishStoreBridge();
  });

  it('publishes the state API the legacy runtime calls', () => {
    for (const method of BRIDGE_METHODS) {
      expect(typeof globalThis.__tcmStore[method]).toBe('function');
    }
  });

  it('reports readiness and hydrates on demand', async () => {
    installChromeMock({});

    expect(globalThis.__tcmStore.isReady()).toBe(false);
    await globalThis.__tcmStore.hydrate();
    expect(globalThis.__tcmStore.isReady()).toBe(true);
  });

  it('exposes the flat legacy shape, with settings at the root and defaults filled in', async () => {
    installChromeMock({ collections: [{ id: 'a', name: 'A', tabs: [] }], theme: 'light' });
    await hydrate();

    const flat = globalThis.__tcmStore.getLegacyState();

    expect(flat.theme).toBe('light');
    expect(flat.collectionSortType).toBe('custom');
    expect(flat.maxPinnedTabs).toBe(3);
    expect(flat.enforceMaxPinnedCollections).toBe(true);
    expect(flat.collections.map((collection) => collection.id)).toEqual(['a']);
    expect(flat.settings).toBeUndefined();
  });

  it('hands out a copy, so a legacy in-place edit cannot reach the React snapshot', async () => {
    installChromeMock({ collections: [{ id: 'a', name: 'A', tabs: [{ id: 't1' }] }] });
    await hydrate();

    const flat = globalThis.__tcmStore.getLegacyState();
    flat.collections[0].name = 'Edited in place';
    flat.collections[0].tabs.push({ id: 't2' });

    expect(getSnapshot().collections[0].name).toBe('A');
    expect(getSnapshot().collections[0].tabs).toHaveLength(1);
    expect(getSnapshot().collections).not.toBe(flat.collections);
  });

  it('writes a legacy mutation through the same key set the React store owns', async () => {
    const { store } = installChromeMock({
      collections: [{ id: 'a', name: 'A', tabs: [] }],
      sessionHistory: [{ id: 'h1' }],
    });
    await hydrate();

    const flat = await globalThis.__tcmStore.mutateLegacy((state) => {
      state.collections.push({ id: 'b', name: 'B', tabs: [], isExpanded: true });
      state.theme = 'light';
      state.lastSessionBackup = null;
    });

    expect(flat.collections.map((collection) => collection.id)).toEqual(['a', 'b']);
    expect(flat.theme).toBe('light');
    expect(store.collections).toHaveLength(2);
    expect(store.theme).toBe('light');
    // Worker-owned keys are never written by a UI mutation.
    expect(store.sessionHistory).toEqual([{ id: 'h1' }]);
    expect(Object.keys(store).sort()).toEqual([...WRITABLE_KEYS, 'sessionHistory'].sort());
  });

  it('serializes a legacy mutation and a React mutation instead of losing one', async () => {
    installChromeMock({ collections: [] });
    await hydrate();

    await Promise.all([
      globalThis.__tcmStore.mutateLegacy((state) => {
        state.collections.push({ id: 'legacy-1', name: 'Legacy', tabs: [] });
      }),
      mutate((draft) => {
        draft.collections.push({ id: 'react-1', name: 'React', tabs: [] });
      }),
      globalThis.__tcmStore.mutateLegacy((state) => {
        state.collections.push({ id: 'legacy-2', name: 'Legacy 2', tabs: [] });
        state.collectionSortType = 'titleAsc';
      }),
    ]);

    const ids = getSnapshot()
      .collections.map((collection) => collection.id)
      .sort();
    expect(ids).toEqual(['legacy-1', 'legacy-2', 'react-1']);
    expect(getSnapshot().settings.collectionSortType).toBe('titleAsc');
  });

  it('persists the collection sort mode a legacy mutator sets', async () => {
    const { store } = installChromeMock({ collections: [], collectionSortType: 'custom' });
    await hydrate();

    await globalThis.__tcmStore.mutateLegacy((state) => {
      state.collectionSortType = 'dateAddedNewest';
      state.autoSaveCollectionId = 'a';
    });

    expect(store.collectionSortType).toBe('dateAddedNewest');
    expect(store.autoSaveCollectionId).toBe('a');
  });
});
