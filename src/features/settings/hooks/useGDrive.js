import { useCallback, useEffect, useState } from 'react';

/**
 * @typedef {object} GDriveStatus
 * @property {boolean} enabled
 * @property {boolean} autoBackupEnabled
 * @property {number|null} lastBackupTime
 * @property {number|null} lastBackupTimestamp
 * @property {boolean} loaded          False until the first status reply arrives
 */

const EMPTY_STATUS = Object.freeze({
  enabled: false,
  autoBackupEnabled: false,
  lastBackupTime: null,
  lastBackupTimestamp: null,
  loaded: false,
});

/**
 * Send a worker command and never throw: the section has to render whatever the worker answers,
 * and a revoked token or a failed network call must degrade to a toast (skill.md §5.5).
 *
 * @param {string} command
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{success: boolean, [key: string]: any}>}
 */
async function send(command, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ command, ...payload });
    return response && typeof response === 'object' ? response : { success: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * @typedef {object} GDriveState
 * @property {GDriveStatus} status
 * @property {'backup' | 'restore' | 'disconnect' | null} busy
 * @property {() => Promise<void>} reload
 * @property {(enabled: boolean) => Promise<void>} setEnabled
 * @property {(enabled: boolean) => Promise<void>} setAutoBackup
 * @property {() => Promise<void>} backupNow
 * @property {() => Promise<void>} restore
 * @property {() => Promise<void>} disconnect
 */

/**
 * The Cloud Backup section's state: the worker's status plus the four actions. The two enable
 * flags live in the store (they are persisted settings), everything else is a worker round trip.
 *
 * @param {import('./useSettingsActions.js').SettingsActions} actions
 * @returns {GDriveState}
 */
export function useGDrive(actions) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [busy, setBusy] = useState(
    /** @type {'backup' | 'restore' | 'disconnect' | null} */ (null)
  );

  const reload = useCallback(async () => {
    const response = await send('gdriveGetStatus');
    if (!response.success) return;
    setStatus({
      enabled: !!response.enabled,
      autoBackupEnabled: !!response.autoBackupEnabled,
      lastBackupTime: response.lastBackupTime ?? null,
      lastBackupTimestamp: response.lastBackupTimestamp ?? null,
      loaded: true,
    });
  }, []);

  // The section only mounts while the modal is open, so this is "refresh on open" — the same
  // moment the legacy settings modal used to call loadGDriveStatus().
  useEffect(() => {
    reload();
  }, [reload]);

  return {
    status,
    busy,
    reload,

    setEnabled: async (enabled) => {
      await actions.setSetting('gdriveBackupEnabled', enabled);

      if (!enabled) {
        await actions.setSetting('gdriveAutoBackupEnabled', false);
        await send('gdriveEnableAutoBackup', { enabled: false });
        actions.toast('Cloud backup disabled');
        await reload();
        return;
      }

      actions.toast('☁️ Connecting to Google Drive...');
      const result = await send('gdriveBackup');
      if (result.success) {
        actions.toast('☁️ Cloud backup enabled! Data saved to Google Drive.');
      } else {
        // A failed first backup must not leave the flag claiming success.
        await actions.setSetting('gdriveBackupEnabled', false);
        actions.toast(`❌ Backup failed: ${result.error || 'Unknown error'}`);
      }
      await reload();
    },

    setAutoBackup: async (enabled) => {
      await actions.setSetting('gdriveAutoBackupEnabled', enabled);
      await send('gdriveEnableAutoBackup', { enabled });
      actions.toast(enabled ? '🔄 Daily auto-backup enabled' : 'Auto-backup disabled');
      await reload();
    },

    backupNow: async () => {
      setBusy('backup');
      try {
        const result = await send('gdriveBackup');
        actions.toast(
          result.success
            ? '☁️ Backup saved to Google Drive!'
            : `❌ Backup failed: ${result.error || 'Unknown error'}`
        );
      } finally {
        setBusy(null);
        await reload();
      }
    },

    restore: async () => {
      setBusy('restore');
      try {
        const result = await send('gdriveRestore');
        actions.toast(
          result.success
            ? `✅ Restored ${result.collectionsCount} collections from Drive!`
            : `❌ Restore failed: ${result.error || 'Unknown error'}`
        );
      } finally {
        setBusy(null);
        await reload();
      }
    },

    disconnect: async () => {
      setBusy('disconnect');
      try {
        await send('gdriveDeleteBackup');
        await actions.setSetting('gdriveBackupEnabled', false);
        await actions.setSetting('gdriveAutoBackupEnabled', false);
        await send('gdriveEnableAutoBackup', { enabled: false });
        await send('gdriveSignOut');
        actions.toast('Google Drive disconnected');
      } finally {
        setBusy(null);
        await reload();
      }
    },
  };
}
