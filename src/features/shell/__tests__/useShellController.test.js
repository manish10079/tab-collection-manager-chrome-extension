import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { CURRENT_SESSION_ID, STORAGE_KEYS } from '../../../shared/storage-keys.js';
import { useShellController } from '../hooks/useShellController.js';

/** @param {Record<string, unknown>} [initial] */
function setup(initial = {}) {
  const { store, chrome } = installChromeMock(initial);
  const toast = vi.fn();
  const { result } = renderHook(() => useShellController({ toast }));
  return { store, chrome, toast, controller: result };
}

describe('useShellController create slide', () => {
  it('creates a collection through the write queue and closes the slide', async () => {
    const { store, toast, controller } = setup({});
    await hydrate();

    act(() => controller.current.setCreateName('Alpha'));
    await act(async () => {
      await controller.current.submitCreate();
    });

    expect(store.collections.map((collection) => collection.name)).toEqual(['Alpha']);
    expect(controller.current.slide).toBeNull();
    expect(controller.current.createName).toBe('');
    expect(toast).not.toHaveBeenCalled();
  });

  it('toasts a duplicate name and keeps the slide open', async () => {
    const { store, toast, controller } = setup({
      [STORAGE_KEYS.collections]: [{ id: 'a', name: 'Alpha', tabs: [] }],
    });
    await hydrate();

    act(() => controller.current.setCreateName('alpha'));
    let created = true;
    await act(async () => {
      created = await controller.current.submitCreate();
    });

    expect(created).toBe(false);
    expect(store.collections).toHaveLength(1);
    expect(toast.mock.calls[0][0]).toContain('already exists');
  });
});

describe('useShellController chrome actions', () => {
  it('toggles the layout through the store', async () => {
    const { store, controller } = setup({});
    await hydrate();

    await act(async () => {
      controller.current.toggleLayout();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(store.layoutViewMode).toBe('grid');
  });

  it('writes the chosen collection sort type', async () => {
    const { store, controller } = setup({});
    await hydrate();

    await act(async () => {
      controller.current.setCollectionSort('nameAsc');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(store.collectionSortType).toBe('nameAsc');
  });

  it('expands all collections, then collapses them', async () => {
    const { store, toast, controller } = setup({
      [STORAGE_KEYS.collections]: [
        { id: 'a', name: 'A', tabs: [], isExpanded: false },
        { id: 'b', name: 'B', tabs: [], isExpanded: false },
      ],
    });
    await hydrate();

    await act(async () => {
      await controller.current.expandAll();
    });
    expect(store.collections.every((collection) => collection.isExpanded)).toBe(true);

    await act(async () => {
      await controller.current.expandAll();
    });
    expect(store.collections.every((collection) => collection.isExpanded)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith('All collections collapsed', 1500);
  });

  it('expands only the Current Session', async () => {
    const { store, controller } = setup({
      [STORAGE_KEYS.collections]: [
        { id: CURRENT_SESSION_ID, name: 'Current Session', tabs: [], isExpanded: false },
        { id: 'a', name: 'A', tabs: [], isExpanded: true },
      ],
    });
    await hydrate();

    await act(async () => {
      await controller.current.expandCurrentSession();
    });

    expect(store.collections.find((c) => c.id === CURRENT_SESSION_ID).isExpanded).toBe(true);
    expect(store.collections.find((c) => c.id === 'a').isExpanded).toBe(false);
  });

  it('refuses to export an empty list', async () => {
    const { toast, controller } = setup({});
    await hydrate();

    await act(async () => {
      await controller.current.exportAll();
    });

    expect(toast).toHaveBeenCalledWith('No collections to export.');
  });

  it('downloads every collection when there is something to export', async () => {
    const { toast, controller } = setup({
      [STORAGE_KEYS.collections]: [{ id: 'a', name: 'Alpha', tabs: [] }],
    });
    await hydrate();
    const createObjectURL = vi.fn(() => 'blob:test');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();

    await act(async () => {
      await controller.current.exportAll();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('All collections exported successfully');
    // The stubs stay installed for the rest of this file: `downloadJson` revokes the URL on a
    // 100ms timer, so deleting them here makes that timer throw into an empty global.
  });

  it('restores the backup through the worker', async () => {
    const backup = {
      collectionId: 'a',
      name: 'Alpha',
      tabs: [{ id: 't1', url: 'https://a.test' }],
    };
    const { chrome, toast, controller } = setup({
      [STORAGE_KEYS.lastSessionBackup]: backup,
    });
    await hydrate();
    chrome.runtime.sendMessage = vi.fn(async () => ({ success: true }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      await controller.current.restoreBackup();
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      command: 'restoreSession',
      collectionId: 'a',
      backupData: backup,
    });
    expect(toast).toHaveBeenCalledWith('Restoring session…');
    confirmSpy.mockRestore();
  });

  it('does nothing when there is no backup to restore', async () => {
    const { chrome, controller } = setup({});
    await hydrate();
    chrome.runtime.sendMessage = vi.fn();

    await act(async () => {
      await controller.current.restoreBackup();
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('useShellController slide state', () => {
  it('toggles search and create so only one slide is open', () => {
    const { controller } = setup({});

    act(() => controller.current.toggleSearch());
    expect(controller.current.slide).toBe('search');

    act(() => controller.current.toggleCreate());
    expect(controller.current.slide).toBe('create');

    act(() => controller.current.closeOverlays());
    expect(controller.current.slide).toBeNull();
    expect(controller.current.closeOverlays()).toBe(false);
  });
});
