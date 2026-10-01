import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installChromeMock } from '../../../tests/mocks/chrome.js';
import { getSnapshot } from '../../store/store.js';
import { STORAGE_KEYS } from '../../shared/storage-keys.js';
import { useBootSequence } from '../hooks/useBootSequence.js';

/**
 * The boot sequence replaced popup.js's start-up work (Phase 5.3). The order matters: the worker
 * auto-save is written by another context, so the read that follows it has to happen after the
 * message resolves, and the normalisation writes through the store's queue.
 */
describe('useBootSequence', () => {
  it('asks the worker to auto-save, then normalises the opened state', async () => {
    const { store, chrome } = installChromeMock({
      [STORAGE_KEYS.collections]: [
        { id: 'a', name: 'A', tabs: [{ id: 't1', url: 'https://a.test' }], isExpanded: true },
      ],
      [STORAGE_KEYS.autoSaveCollectionId]: 'gone',
    });
    chrome.runtime.sendMessage = vi.fn(async () => ({ success: true }));

    renderHook(() => useBootSequence());

    await waitFor(() => {
      expect(getSnapshot().collections[0]?.isExpanded).toBe(false);
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ command: 'forceAutoSave' });
    expect(store.collections[0].isExpanded).toBe(false);
    expect(store.collections[0].tabs[0].addedAt).toEqual(expect.any(Number));
    expect(store.autoSaveCollectionId ?? null).toBeNull();
  });

  it('survives a worker that refuses the message', async () => {
    const { chrome } = installChromeMock({
      [STORAGE_KEYS.collections]: [{ id: 'a', name: 'A', tabs: [], isExpanded: true }],
    });
    chrome.runtime.sendMessage = vi.fn(async () => {
      throw new Error('no worker');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useBootSequence());

    await waitFor(() => {
      expect(getSnapshot().collections[0]?.isExpanded).toBe(false);
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
