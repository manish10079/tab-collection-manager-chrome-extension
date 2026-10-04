import { useCallback, useEffect, useState } from 'react';

/**
 * @typedef {object} GDriveStatus
 * @property {boolean} enabled
 * @property {boolean} autoBackupEnabled
 * @property {number|null} lastBackupTime
 * @property {number|null} lastBackupTimestamp
 * @property {string} accountEmail
 * @property {string} accountName
 * @property {string} accountPicture
 * @property {boolean} loaded          False until the first status reply arrives
 */

const EMPTY_STATUS = Object.freeze({
  enabled: false,
  autoBackupEnabled: false,
  lastBackupTime: null,
  lastBackupTimestamp: null,
  accountEmail: '',
  accountName: '',
  accountPicture: '',
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

const AUTH_TIMEOUT_MS = 90_000;
const TOKEN_SKEW_MS = 60_000;
const TOKEN_KEY = 'gdriveAccessToken';
const TOKEN_EXPIRES_KEY = 'gdriveAccessTokenExpiresAt';

function tokenStorage() {
  // Local, not session: MV3 service-worker idle and closing the side panel both wipe
  // `storage.session`, which made Backup/Restore prompt again after a few minutes.
  return globalThis.chrome?.storage?.local;
}

/** @returns {Promise<string>} */
async function readCachedToken() {
  const area = tokenStorage();
  if (!area?.get) return '';
  const data = await area.get([TOKEN_KEY, TOKEN_EXPIRES_KEY]);
  const token = data[TOKEN_KEY];
  const expiresAt = Number(data[TOKEN_EXPIRES_KEY]) || 0;
  if (typeof token === 'string' && token && expiresAt > Date.now() + TOKEN_SKEW_MS) return token;
  return '';
}

/**
 * @param {string} token
 * @param {string|null} expiresIn
 * @returns {Promise<void>}
 */
async function writeCachedToken(token, expiresIn) {
  const area = tokenStorage();
  if (!area?.set) return;
  const seconds = Number(expiresIn);
  const ttlMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600 * 1000;
  await area.set({
    [TOKEN_KEY]: token,
    [TOKEN_EXPIRES_KEY]: Date.now() + ttlMs,
  });
}

async function clearCachedToken() {
  const area = tokenStorage();
  if (!area?.remove) return;
  await area.remove([TOKEN_KEY, TOKEN_EXPIRES_KEY]);
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * @param {{ forcePrompt?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function requestAccessToken(options = {}) {
  const forcePrompt = Boolean(options.forcePrompt);
  if (!forcePrompt) {
    const cached = await readCachedToken();
    if (cached) return cached;
  }

  const identity = globalThis.chrome?.identity;
  if (!identity || typeof identity.launchWebAuthFlow !== 'function') {
    throw new Error('Google sign-in is not available');
  }

  const flow = new Promise((resolve, reject) => {
    const oauth2 = globalThis.chrome.runtime.getManifest().oauth2;
    const clientId = oauth2?.client_id;
    const scopes = oauth2?.scopes;
    if (!clientId || !Array.isArray(scopes) || scopes.length === 0) {
      reject(new Error('OAuth client is not configured'));
      return;
    }
    if (typeof identity.getRedirectURL !== 'function') {
      reject(new Error('Google sign-in is not available'));
      return;
    }

    const redirectUrl = identity.getRedirectURL();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('scope', scopes.join(' '));
    if (forcePrompt) authUrl.searchParams.set('prompt', 'select_account consent');

    identity.launchWebAuthFlow({ url: authUrl.href, interactive: true }, (responseUrl) => {
      const lastError = globalThis.chrome?.runtime?.lastError;
      if (lastError || !responseUrl) {
        reject(new Error(lastError?.message || 'Sign-in cancelled'));
        return;
      }
      let params;
      try {
        const parsed = new URL(responseUrl);
        params = new URLSearchParams(parsed.hash.replace(/^#/, ''));
        if (!params.get('access_token')) params = parsed.searchParams;
      } catch {
        const hash = responseUrl.includes('#') ? responseUrl.slice(responseUrl.indexOf('#') + 1) : '';
        params = new URLSearchParams(hash);
      }
      const token = params.get('access_token');
      if (!token) {
        reject(new Error('Google did not return an access token'));
        return;
      }
      resolve({ token, expiresIn: params.get('expires_in') });
    });
  });

  const { token, expiresIn } = await withTimeout(
    flow,
    AUTH_TIMEOUT_MS,
    'Sign-in timed out. Check the Google window or try again.'
  );
  await writeCachedToken(token, expiresIn);
  return token;
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
      accountEmail: typeof response.accountEmail === 'string' ? response.accountEmail : '',
      accountName: typeof response.accountName === 'string' ? response.accountName : '',
      accountPicture: typeof response.accountPicture === 'string' ? response.accountPicture : '',
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
      if (enabled !== true) {
        setStatus((current) => ({ ...current, enabled: false, autoBackupEnabled: false }));
        await actions.setSetting('gdriveBackupEnabled', false);
        await actions.setSetting('gdriveAutoBackupEnabled', false);
        await send('gdriveEnableAutoBackup', { enabled: false });
        await clearCachedToken();
        actions.toast('Cloud backup disabled');
        await reload();
        return;
      }

      setBusy('backup');
      actions.toast('☁️ Connecting to Google Drive...');
      try {
        let token;
        try {
          token = await requestAccessToken({ forcePrompt: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          actions.toast(`❌ Sign-in failed: ${message}`);
          return;
        }

        const result = await send('gdriveBackup', { token });
        if (result.success) {
          await actions.setSetting('gdriveBackupEnabled', true);
          actions.toast('☁️ Cloud backup enabled! Data saved to Google Drive.');
        } else {
          actions.toast(`❌ Backup failed: ${result.error || 'Unknown error'}`);
        }
      } finally {
        setBusy(null);
        await reload();
      }
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
        let token;
        try {
          token = await requestAccessToken();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          actions.toast(`❌ Sign-in failed: ${message}`);
          return;
        }
        const result = await send('gdriveBackup', { token });
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
        let token;
        try {
          token = await requestAccessToken();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          actions.toast(`❌ Sign-in failed: ${message}`);
          return;
        }
        const result = await send('gdriveRestore', { token });
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
        let token;
        try {
          token = await requestAccessToken();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await clearCachedToken();
          await actions.setSetting('gdriveBackupEnabled', false);
          await actions.setSetting('gdriveAutoBackupEnabled', false);
          await send('gdriveEnableAutoBackup', { enabled: false });
          actions.toast(`Google Drive disconnected locally (${message})`);
          return;
        }
        const deleted = await send('gdriveDeleteBackup', { token });
        await actions.setSetting('gdriveBackupEnabled', false);
        await actions.setSetting('gdriveAutoBackupEnabled', false);
        await send('gdriveEnableAutoBackup', { enabled: false });
        await clearCachedToken();
        const signedOut = await send('gdriveSignOut');
        if (!deleted.success) {
          actions.toast(`❌ Disconnect failed: ${deleted.error || 'Could not remove Drive backup'}`);
        } else if (!signedOut.success) {
          actions.toast(
            `Google Drive disconnected locally (${signedOut.error || 'sign-out incomplete'})`
          );
        } else {
          actions.toast('Google Drive disconnected');
        }
      } finally {
        setBusy(null);
        await reload();
      }
    },
  };
}
