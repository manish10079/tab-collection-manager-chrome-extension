import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { SettingsModal } from '../components/SettingsModal.jsx';
import { useSettingsActions } from '../hooks/useSettingsActions.js';

/**
 * The settings modal is the last place that used to write `chrome.storage.local` directly, so
 * these tests assert the writes land in storage (the store is the only writer now) and that the
 * Google Drive actions still speak the worker protocol the service worker answers.
 */

/**
 * @param {Record<string, unknown>} storage
 * @param {(message: any) => Promise<any>} [onMessage] Worker stub
 */
async function renderSettings(storage = {}, onMessage) {
  const { store } = installChromeMock(storage);
  if (onMessage) globalThis.chrome.runtime.sendMessage = vi.fn(onMessage);
  await hydrate();

  const legacy = { toast: vi.fn() };
  const { result } = renderHook(() => useSettingsActions(legacy));
  const onClose = vi.fn();
  const view = render(<SettingsModal actions={result.current} onClose={onClose} />);

  return { store, legacy, onClose, ...view };
}

/**
 * Wait for a queued store write to reach storage (the mock's backing object is written
 * synchronously by `chrome.storage.local.set`).
 *
 * @param {Record<string, unknown>} store
 * @param {string} key
 * @param {unknown} value
 */
async function expectStored(store, key, value) {
  await waitFor(() => {
    expect(store[key]).toEqual(value);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsModal', () => {
  it('renders the persisted settings', async () => {
    await renderSettings({
      theme: 'light',
      ramSaverEnabled: true,
      autoSaveCollectionId: CURRENT_SESSION_ID,
      maxPinnedTabs: 7,
      enforceMaxPinnedTabs: false,
    });

    expect(screen.getByLabelText('Light Mode').checked).toBe(true);
    expect(screen.getByLabelText('RAM Saver').checked).toBe(true);
    expect(screen.getByLabelText('Auto-Save').checked).toBe(true);
    expect(screen.getByLabelText('Limit pinned tabs per collection').checked).toBe(false);
    expect(screen.getByLabelText('Maximum pinned tabs per collection').value).toBe('7');
  });

  it('writes a toggle through the store queue', async () => {
    const { store, legacy } = await renderSettings({});

    fireEvent.click(screen.getByLabelText('RAM Saver'));

    await expectStored(store, 'ramSaverEnabled', true);
    expect(store.ramSaverEnabled).toBe(true);
    expect(legacy.toast).toHaveBeenCalledWith(expect.stringContaining('RAM Saver ON'));
  });

  it('turns Auto-Save into the Current Session target and back off', async () => {
    const { store } = await renderSettings({});

    fireEvent.click(screen.getByLabelText('Auto-Save'));
    await expectStored(store, 'autoSaveCollectionId', CURRENT_SESSION_ID);
    expect(store.autoSaveCollectionId).toBe(CURRENT_SESSION_ID);

    fireEvent.click(screen.getByLabelText('Auto-Save'));
    await waitFor(() => {
      expect(store.autoSaveCollectionId).toBeNull();
    });
  });

  it('stores the theme setting without touching the DOM attribute itself', async () => {
    const { store } = await renderSettings({ theme: 'dark' });

    fireEvent.click(screen.getByLabelText('Light Mode'));

    await expectStored(store, 'theme', 'light');
    expect(store.theme).toBe('light');
  });

  it('clamps a pinned limit and shows the stored value', async () => {
    const { store } = await renderSettings({});
    const input = screen.getByLabelText('Maximum pinned tabs per collection');

    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    await expectStored(store, 'maxPinnedTabs', 50);
    expect(store.maxPinnedTabs).toBe(50);
    await waitFor(() => {
      expect(input.value).toBe('50');
    });
  });

  it('asks the worker for the Cloud Backup status and hides the actions while it is off', async () => {
    const onMessage = vi.fn(async () => ({
      success: true,
      enabled: false,
      autoBackupEnabled: false,
    }));
    await renderSettings({}, onMessage);

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({ command: 'gdriveGetStatus' });
    });
    expect(screen.queryByText('Backup Now')).toBeNull();
    expect(screen.getByLabelText('Enable Cloud Backup').checked).toBe(false);
  });

  it('shows the Drive actions when backup is on and sends the backup command', async () => {
    const onMessage = vi.fn(async (message) => {
      if (message.command === 'gdriveGetStatus') {
        return {
          success: true,
          enabled: true,
          autoBackupEnabled: false,
          lastBackupTimestamp: null,
        };
      }
      return { success: true };
    });
    const { legacy } = await renderSettings({}, onMessage);

    await waitFor(() => {
      expect(screen.getByText('Backup Now')).toBeTruthy();
    });
    expect(screen.getByText('Last backup: —')).toBeTruthy();

    fireEvent.click(screen.getByText('Backup Now'));

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({ command: 'gdriveBackup' });
    });
    // Toasts forwarded through the actions hook carry the legacy `(message, duration)` shape.
    expect(legacy.toast).toHaveBeenCalledWith(
      expect.stringContaining('Backup saved to Google Drive!'),
      undefined
    );
  });

  it('rolls the enable flag back when the first backup fails', async () => {
    const onMessage = vi.fn(async (message) => {
      if (message.command === 'gdriveGetStatus') {
        return { success: true, enabled: false, autoBackupEnabled: false };
      }
      return { success: false, error: 'No token' };
    });
    const { store, legacy } = await renderSettings({}, onMessage);

    fireEvent.click(screen.getByLabelText('Enable Cloud Backup'));

    await waitFor(() => {
      expect(legacy.toast).toHaveBeenCalledWith(
        expect.stringContaining('Backup failed: No token'),
        undefined
      );
    });
    await waitFor(() => {
      expect(store.gdriveBackupEnabled).toBe(false);
    });
  });

  it('closes the modal through the primitive', async () => {
    const { onClose } = await renderSettings({});

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
