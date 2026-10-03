import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { useCollectionActions } from '../hooks/useCollectionActions.js';

/**
 * The drag actions against the real store and write queue. These cover the parts a component
 * test cannot: the mutation actually reaching storage, and a refused move surfacing as a
 * toast rather than the legacy `alert()` that used to block the side panel.
 */

/** @param {string} id */
function makeTab(id) {
  return { id, title: id.toUpperCase(), url: `https://${id}.test`, pinned: false };
}

/** @param {Record<string, unknown>} initial */
function setup(initial) {
  const { store } = installChromeMock(initial);
  const legacy = { toast: vi.fn() };
  const { result } = renderHook(() =>
    useCollectionActions({
      toast: legacy.toast,
      addTabs: vi.fn(),
      importTabs: vi.fn(async () => {}),
    })
  );
  return { store, legacy, actions: result.current };
}

describe('useCollectionActions drag actions', () => {
  it('moves a tab into another collection through the write queue', async () => {
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [makeTab('t1')] },
        { id: 'b', name: 'B', tabs: [makeTab('t2')] },
      ],
    });
    await hydrate();

    const result = await actions.moveTab('t1', 'a', 'b');

    expect(result.moved).toBe(true);
    expect(store.collections[0].tabs).toEqual([]);
    expect(store.collections[1].tabs.map((tab) => tab.id)).toEqual(['t2', 't1']);
    expect(legacy.toast).not.toHaveBeenCalled();
  });

  it('toasts the tab-cap refusal and leaves the tab in place', async () => {
    const full = Array.from({ length: LIMITS.MAX_TABS_PER_COLLECTION }, (_, index) =>
      makeTab(`b${index}`)
    );
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [makeTab('t1')] },
        { id: 'b', name: 'B', tabs: full },
      ],
    });
    await hydrate();
    const alertSpy = vi.spyOn(window, 'alert');

    const result = await actions.moveTab('t1', 'a', 'b');

    expect(result.moved).toBe(false);
    expect(legacy.toast).toHaveBeenCalledTimes(1);
    expect(legacy.toast.mock.calls[0][0]).toContain(String(LIMITS.MAX_TABS_PER_COLLECTION));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(store.collections[0].tabs.map((tab) => tab.id)).toEqual(['t1']);
    alertSpy.mockRestore();
  });

  it('refuses a move inside one collection without bothering the user', async () => {
    const { store, legacy, actions } = setup({
      collections: [{ id: 'a', name: 'A', tabs: [makeTab('t1'), makeTab('t2')] }],
    });
    await hydrate();

    const result = await actions.moveTab('t1', 'a', 'a');

    expect(result.moved).toBe(false);
    expect(legacy.toast).not.toHaveBeenCalled();
    expect(store.collections[0].tabs.map((tab) => tab.id)).toEqual(['t1', 't2']);
  });

  it('reorders collections and forces the custom sort mode', async () => {
    const { store, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [] },
        { id: 'b', name: 'B', tabs: [] },
      ],
      collectionSortType: 'titleAsc',
    });
    await hydrate();

    await actions.moveCollection('b', 'a');

    expect(store.collections.map((collection) => collection.id)).toEqual(['b', 'a']);
    expect(store.collectionSortType).toBe('custom');
  });
});

/**
 * The Phase 5.1 actions: everything `window.TCMLegacyUI` used to do. They run against the real
 * store and write queue, so a refusal is asserted by inspecting what actually persisted.
 */
describe('useCollectionActions administration actions', () => {
  it('toasts the pinned-collection limit instead of alerting', async () => {
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [], pinned: true },
        { id: 'b', name: 'B', tabs: [] },
      ],
      enforceMaxPinnedCollections: true,
      maxPinnedCollections: 1,
    });
    await hydrate();
    const alertSpy = vi.spyOn(window, 'alert');

    await actions.pinCollection('b');

    expect(legacy.toast).toHaveBeenCalledTimes(1);
    expect(legacy.toast.mock.calls[0][0]).toContain('Maximum of 1 pinned collections');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(store.collections.find((collection) => collection.id === 'b').pinned).toBeFalsy();
    alertSpy.mockRestore();
  });

  it('reports a duplicate collection name as a toast and keeps the old name', async () => {
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'Alpha', tabs: [] },
        { id: 'b', name: 'Taken', tabs: [] },
      ],
    });
    await hydrate();

    const renamed = await actions.renameCollection('a', 'taken');

    expect(renamed).toBe(false);
    expect(legacy.toast.mock.calls[0][0]).toContain('already exists');
    expect(store.collections.find((collection) => collection.id === 'a').name).toBe('Alpha');
  });

  it('clears Auto-Save when its target collection is deleted', async () => {
    const { store, actions } = setup({
      collections: [{ id: 'a', name: 'A', tabs: [] }],
      autoSaveCollectionId: 'a',
    });
    await hydrate();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await actions.deleteCollection('a');

    expect(store.autoSaveCollectionId).toBeNull();
    expect(store.collections).toEqual([]);
    confirmSpy.mockRestore();
  });

  it('asks the worker to restore a collection', async () => {
    const { legacy, actions } = setup({});
    await hydrate();
    const send = vi.fn(async () => ({ success: true }));
    globalThis.chrome.runtime.sendMessage = send;

    await actions.openAllTabs('a');

    expect(send).toHaveBeenCalledWith({ command: 'restoreSession', collectionId: 'a' });
    expect(legacy.toast).toHaveBeenCalledWith('All tabs opened in background');
  });

  it('opens a tab in the background and toasts, but stays quiet for an active open', async () => {
    const { legacy, actions } = setup({});
    await hydrate();
    const create = vi.fn(async () => ({ id: 7 }));
    globalThis.chrome.tabs.create = create;

    await actions.openTab('https://example.test', { active: false });
    expect(create).toHaveBeenCalledWith({ url: 'https://example.test', active: false });
    expect(legacy.toast).toHaveBeenCalledWith('Tab opened in background');

    legacy.toast.mockClear();
    await actions.openTab('https://example.test');
    expect(create).toHaveBeenLastCalledWith({ url: 'https://example.test', active: true });
    expect(legacy.toast).not.toHaveBeenCalled();
  });

  it('exports a collection and refuses an empty one', async () => {
    const { legacy, actions } = setup({});
    await hydrate();
    // happy-dom does not implement object URLs, so define them for the export path and restore after.
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    actions.exportCollection({
      id: 'a',
      name: 'Alpha',
      tabs: [{ id: 't1', title: 'T', url: 'https://a.test' }],
    });
    expect(legacy.toast).toHaveBeenCalledWith('Collection exported successfully');

    legacy.toast.mockClear();
    actions.exportCollection({ id: 'b', name: 'Empty', tabs: [] });
    expect(legacy.toast).toHaveBeenCalledWith('No tabs to export in this collection.');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // The stubs stay installed for the rest of this file: `downloadJson` revokes the URL on a
    // 100ms timer, so deleting them here makes that timer throw into an empty global.
  });

  it('removes and renames tabs through the queue', async () => {
    const { store, actions } = setup({
      collections: [
        {
          id: 'a',
          name: 'A',
          tabs: [{ id: 't1', title: 'One', url: 'https://one.test', pinned: false }],
        },
      ],
    });
    await hydrate();

    await actions.renameTab('a', 't1', 'Renamed');
    expect(store.collections[0].tabs[0].title).toBe('Renamed');

    await actions.removeTab('a', 't1');
    expect(store.collections[0].tabs).toEqual([]);
  });
});

/**
 * Bulk deletion asks once, cascades folders into their collections, and refuses to take the live
 * Current Session with it. The confirmation is asserted through `window.confirm` so a cancel is
 * covered as well as an accept.
 */
describe('useCollectionActions deleteMany', () => {
  it('removes the folders with their collections and the selected collections after one prompt', async () => {
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [makeTab('t1')], folderId: 'f1' },
        { id: 'b', name: 'B', tabs: [] },
        { id: 'c', name: 'C', tabs: [] },
      ],
      folders: [{ id: 'f1', name: 'Work' }],
    });
    await hydrate();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const done = await actions.deleteMany({ folderIds: ['f1'], collectionIds: ['c'] });

    expect(done).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The folder's own collection is counted alongside the separately selected one.
    expect(confirmSpy.mock.calls[0][0]).toContain('1 folder and 2 collections');
    expect(store.collections.map((collection) => collection.id)).toEqual(['b']);
    expect(store.folders).toEqual([]);
    expect(legacy.toast).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('changes nothing when the prompt is dismissed', async () => {
    const { store, legacy, actions } = setup({
      collections: [{ id: 'a', name: 'A', tabs: [] }],
    });
    await hydrate();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const done = await actions.deleteMany({ collectionIds: ['a'] });

    expect(done).toBe(false);
    expect(store.collections).toHaveLength(1);
    expect(legacy.toast).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('does nothing at all for an empty selection', async () => {
    const { legacy, actions } = setup({ collections: [{ id: 'a', name: 'A', tabs: [] }] });
    await hydrate();
    const confirmSpy = vi.spyOn(window, 'confirm');

    await actions.deleteMany({});

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(legacy.toast).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

/**
 * The hook is a composition of the capability groups (`useTabActions`, `useFolderActions`,
 * `useColorActions`, `usePinActions`) plus the collection-level actions and the bulk delete, none of
 * which a caller can see. This pins the surface it promises, so moving an action between the groups
 * cannot quietly drop it from the object the panel consumes.
 */
describe('useCollectionActions surface', () => {
  it('exposes every documented action', async () => {
    const { actions } = setup({});
    await hydrate();

    expect(Object.keys(actions).sort()).toEqual(
      [
        'addTabs',
        'copyCollectionLinks',
        'copyTabUrl',
        'createFolder',
        'deleteCollection',
        'deleteFolder',
        'deleteMany',
        'exportCollection',
        'importTabs',
        'labelWithNewColor',
        'moveCollection',
        'moveCollectionToFolder',
        'moveTab',
        'moveTabToPosition',
        'openAllTabs',
        'openTab',
        'pinCollection',
        'pinTab',
        'removeTab',
        'renameCollection',
        'renameFolder',
        'renameTab',
        'reorderTabs',
        'setCollectionColor',
        'setExpanded',
        'setFolderColor',
        'setFolderExpanded',
        'setTabSortType',
        'toast',
      ].sort()
    );
  });
});
