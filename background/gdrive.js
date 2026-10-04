// Google Drive cloud backup. Uses the Chrome Identity API plus the Drive `appDataFolder`, an
// isolated per-app space the user cannot see in their Drive UI — the one place a `drive.appdata`
// scope can read and write (manifest.json `oauth2`, skill.md §5.4).
import { api } from './api.js';
import {
  ALARMS,
  GDRIVE_BACKUP_FILENAME,
  GDRIVE_ACCESS_TOKEN_EXPIRES_KEY,
  GDRIVE_ACCESS_TOKEN_KEY,
  GDRIVE_ACCOUNT_EMAIL_KEY,
  GDRIVE_ACCOUNT_NAME_KEY,
  GDRIVE_ACCOUNT_PICTURE_KEY,
  GDRIVE_LAST_BACKUP_TIMESTAMP_KEY,
  GDRIVE_LAST_BACKUP_TIME_KEY,
  GDRIVE_LAST_RESTORE_TIME_KEY,
  STORAGE_KEYS,
  TIMING,
} from './constants.js';
import { getState, updateState } from './state.js';
import { isBuiltInColor, normalizeCustomColors } from '../src/lib/colors.js';
import { CURRENT_SESSION_ID } from '../src/shared/storage-keys.js';

/**
 * Get an OAuth2 access token via the Chrome Identity API.
 *
 * @param {boolean} [interactive] True to show the auth prompt; false returns a cached token silently
 * @returns {Promise<string>}
 */
export function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    api.identity.getAuthToken({ interactive }, (token) => {
      if (api.runtime.lastError || !token) {
        reject(new Error(api.runtime.lastError?.message || 'Failed to get auth token'));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Drop a cached token so the next request forces a fresh one.
 *
 * @param {string} token
 * @returns {Promise<void>}
 */
export function removeCachedToken(token) {
  return new Promise((resolve) => {
    api.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/** Revoke the current token (sign-out / re-auth). Best-effort: never throws. */
export async function revokeAuthToken() {
  try {
    const token = await getAuthToken(false);
    if (token) await removeCachedToken(token);
  } catch {
    // Ignore — best-effort cleanup.
  }
}

/**
 * Run a Drive operation with a token, recovering from an expired one (HTTP 401) by clearing the
 * cache and retrying once.
 *
 * @param {boolean} interactive
 * @param {(token: string) => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function readStoredAccessToken() {
  const area = api.storage.session || api.storage.local;
  if (!area?.get) return '';
  const data = await area.get([GDRIVE_ACCESS_TOKEN_KEY, GDRIVE_ACCESS_TOKEN_EXPIRES_KEY]);
  const token = data[GDRIVE_ACCESS_TOKEN_KEY];
  const expiresAt = Number(data[GDRIVE_ACCESS_TOKEN_EXPIRES_KEY]) || 0;
  if (typeof token === 'string' && token && expiresAt > Date.now() + 60_000) return token;
  return '';
}

export async function withAuthRetry(_interactive, fn, providedToken) {
  let token = providedToken || (await readStoredAccessToken()) || (await getAuthToken(false));
  try {
    return await fn(token);
  } catch (error) {
    if (error && error.status === 401) {
      if (providedToken) throw error;
      await removeCachedToken(token);
      token = await getAuthToken(false);
      return fn(token);
    }
    throw error;
  }
}

/**
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function persistDriveAccount(token) {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const profile = await response.json();
    const email = typeof profile.email === 'string' ? profile.email : '';
    const name = typeof profile.name === 'string' ? profile.name : '';
    const picture = typeof profile.picture === 'string' ? profile.picture : '';
    if (!email && !name && !picture) return;
    await api.storage.local.set({
      [GDRIVE_ACCOUNT_EMAIL_KEY]: email,
      [GDRIVE_ACCOUNT_NAME_KEY]: name,
      [GDRIVE_ACCOUNT_PICTURE_KEY]: picture,
    });
  } catch {
    // Profile is display-only; a failed lookup must not fail the backup.
  }
}

/**
 * `fetch` wrapper that tags 401 responses so `withAuthRetry` can refresh the token.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function driveFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    const error = new Error('Google Drive authentication expired.');
    error.status = 401;
    throw error;
  }
  return response;
}

/** Build the full backup payload from extension storage. */
export async function buildBackupPayload() {
  const state = await getState();
  return {
    backupType: 'gdrive',
    exportedAt: new Date().toISOString(),
    version: api.runtime.getManifest().version,
    collections: state.collections,
    folders: state.folders,
    // The custom colour palette travels with the collections so the labels keep meaning the same
    // thing on the other machine; the labels themselves are `color` on each collection/folder.
    customColors: state.customColors || [],
    sessionHistory: (state.sessionHistory || []).slice(0, 50),
    settings: {
      autoSaveCollectionId: state.autoSaveCollectionId,
      ramSaverEnabled: state.ramSaverEnabled,
      enforceMaxPinnedTabs: state.enforceMaxPinnedTabs,
      maxPinnedTabs: state.maxPinnedTabs,
      enforceMaxPinnedCollections: state.enforceMaxPinnedCollections,
      maxPinnedCollections: state.maxPinnedCollections,
      sessionHistoryLimit: 100,
    },
  };
}

/**
 * Find the existing backup file in `appDataFolder`.
 *
 * @param {string} token
 * @returns {Promise<Record<string, any>|null>}
 */
export async function findExistingBackup(token) {
  const searchUrl = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${GDRIVE_BACKUP_FILENAME}'&fields=files(id,name,modifiedTime)`;
  const response = await driveFetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Drive search failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Upload the payload: PATCH the existing file, or POST a new multipart one.
 *
 * @param {string} token
 * @param {string} fileContent
 * @param {Record<string, any>|null} existingFile
 * @returns {Promise<Record<string, any>>}
 */
export async function uploadBackupFile(token, fileContent, existingFile) {
  /** @type {string} */
  let endpoint;
  /** @type {string} */
  let method;
  /** @type {Record<string, string>} */
  const headers = { Authorization: `Bearer ${token}` };
  /** @type {string} */
  let body;

  if (existingFile) {
    endpoint = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`;
    method = 'PATCH';
    headers['Content-Type'] = 'application/json';
    body = fileContent;
  } else {
    endpoint = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    method = 'POST';
    const boundary = '-------tcm_drive_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = {
      name: GDRIVE_BACKUP_FILENAME,
      mimeType: 'application/json',
      parents: ['appDataFolder'],
    };
    headers['Content-Type'] = `multipart/related; boundary=${boundary}`;
    body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;
  }

  const response = await driveFetch(endpoint, { method, headers, body });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Drive upload failed: ${response.status} - ${errorBody}`);
  }
  return response.json();
}

/**
 * Back up all extension data to Drive `appDataFolder`, updating the file when it already exists.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function backupToGDrive(accessToken) {
  const payload = await buildBackupPayload();
  const fileContent = JSON.stringify(payload, null, 2);

  let usedToken = accessToken;
  const result = await withAuthRetry(
    true,
    async (token) => {
      usedToken = token;
      const existingFile = await findExistingBackup(token);
      const uploaded = await uploadBackupFile(token, fileContent, existingFile);
      return { uploaded, action: existingFile ? 'updated' : 'created' };
    },
    accessToken
  );

  if (usedToken) await persistDriveAccount(usedToken);

  const timestamp = new Date().toISOString();
  await api.storage.local.set({
    [GDRIVE_LAST_BACKUP_TIME_KEY]: Date.now(),
    [GDRIVE_LAST_BACKUP_TIMESTAMP_KEY]: timestamp,
  });

  console.log(`GDrive backup ${result.action}: ${result.uploaded.id}`);
  return {
    success: true,
    action: result.action,
    timestamp,
    fileId: result.uploaded.id,
  };
}

function collectionNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function tabUrl(tab) {
  return typeof tab?.url === 'string' ? tab.url.trim() : '';
}

function mergeTabsInto(target, incoming) {
  if (!Array.isArray(target.tabs)) target.tabs = [];
  const seen = new Set(target.tabs.map(tabUrl).filter(Boolean));
  let added = false;
  for (const tab of incoming || []) {
    const url = tabUrl(tab);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    target.tabs.push({ ...tab, id: crypto.randomUUID(), url });
    added = true;
  }
  if (added) target.updatedAt = Date.now();
}

/**
 * Merge a Drive backup into live state. Same-named collections keep their tabs; a URL already in
 * that collection is skipped. Live collections/folders not in the backup are left in place.
 *
 * @param {Record<string, any>} state
 * @param {Record<string, any>} restoredData
 */
function mergeDriveRestore(state, restoredData) {
  if (!Array.isArray(state.folders)) state.folders = [];
  if (!Array.isArray(state.customColors)) state.customColors = [];
  if (!Array.isArray(state.collections)) state.collections = [];

  for (const color of normalizeCustomColors(restoredData.customColors || [])) {
    const exists = state.customColors.some(
      (entry) =>
        entry.id === color.id || collectionNameKey(entry.name) === collectionNameKey(color.name)
    );
    if (!exists) state.customColors.push(color);
  }

  const palette = state.customColors;
  const knownColor = (colorId) =>
    typeof colorId === 'string' &&
    (isBuiltInColor(colorId) || palette.some((color) => color.id === colorId));

  /** @type {Map<string, string>} */
  const folderIdMap = new Map();
  for (const raw of restoredData.folders || []) {
    if (!raw || typeof raw !== 'object' || !raw.name) continue;
    const name = String(raw.name).trim();
    const existing = state.folders.find(
      (folder) => collectionNameKey(folder.name) === collectionNameKey(name)
    );
    const color = raw.color && knownColor(raw.color) ? raw.color : null;
    if (existing) {
      if (raw.id) folderIdMap.set(String(raw.id), existing.id);
      if (!existing.color && color) existing.color = color;
      continue;
    }
    const id = crypto.randomUUID();
    state.folders.push({
      id,
      name,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
    });
    if (raw.id) folderIdMap.set(String(raw.id), id);
  }

  for (const imported of restoredData.collections || []) {
    if (!imported || typeof imported !== 'object') continue;
    const isSession = imported.id === CURRENT_SESSION_ID || imported.isCurrentSession;
    const existing = isSession
      ? state.collections.find((collection) => collection.id === CURRENT_SESSION_ID)
      : state.collections.find(
          (collection) => collectionNameKey(collection.name) === collectionNameKey(imported.name)
        );

    if (existing) {
      mergeTabsInto(existing, imported.tabs);
      if (!existing.color && imported.color && knownColor(imported.color)) {
        existing.color = imported.color;
      }
      continue;
    }

    const tabs = [];
    mergeTabsInto({ tabs }, imported.tabs);
    const folderId =
      imported.folderId && folderIdMap.has(String(imported.folderId))
        ? folderIdMap.get(String(imported.folderId))
        : null;
    state.collections.push({
      id: crypto.randomUUID(),
      name: String(imported.name || 'Untitled').trim() || 'Untitled',
      tabs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
      pinned: Boolean(imported.pinned),
      folderId,
      color: imported.color && knownColor(imported.color) ? imported.color : null,
      chromeGroups: imported.chromeGroups || {},
      windowGroups: imported.windowGroups || {},
    });
  }
}

/**
 * Restore extension data from the Drive backup, keeping the live Current Session.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function restoreFromGDrive(accessToken) {
  let usedToken = accessToken;
  const restoredData = await withAuthRetry(
    true,
    async (token) => {
    usedToken = token;
    const existingFile = await findExistingBackup(token);
    if (!existingFile) throw new Error('No backup file found on Google Drive.');

    const contentResponse = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!contentResponse.ok) {
      throw new Error(
        `Failed to fetch backup: ${contentResponse.status} ${contentResponse.statusText}`
      );
    }

    const data = await contentResponse.json();
    data.__modifiedTime = existingFile.modifiedTime;
    return data;
    },
    accessToken
  );

  if (usedToken) await persistDriveAccount(usedToken);

  if (!restoredData.collections || !Array.isArray(restoredData.collections)) {
    throw new Error('Invalid backup format: missing collections array.');
  }

  // Apply through the serialized queue so a concurrent auto-save cannot overwrite the restore.
  await updateState((state) => {
    mergeDriveRestore(state, restoredData);
  });

  await api.storage.local.set({ [GDRIVE_LAST_RESTORE_TIME_KEY]: Date.now() });

  const timestamp = restoredData.exportedAt || restoredData.__modifiedTime;
  console.log(
    `GDrive restore complete: ${restoredData.collections.length} collections from ${timestamp}`
  );
  return {
    success: true,
    timestamp,
    collectionsCount: restoredData.collections.length,
  };
}

/** Delete the backup file from Drive (disconnect / cleanup). */
export async function deleteGDriveBackup(accessToken) {
  await withAuthRetry(
    true,
    async (token) => {
      const existingFile = await findExistingBackup(token);
      if (!existingFile) return;

      const response = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${existingFile.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete backup: ${response.status}`);
      }
    },
    accessToken
  );

  await api.storage.local.remove([
    GDRIVE_LAST_BACKUP_TIME_KEY,
    GDRIVE_LAST_BACKUP_TIMESTAMP_KEY,
    GDRIVE_ACCOUNT_EMAIL_KEY,
    GDRIVE_ACCOUNT_NAME_KEY,
    GDRIVE_ACCOUNT_PICTURE_KEY,
  ]);
  console.log('GDrive backup deleted');
  return { success: true };
}

/**
 * Auto-backup handler (called by the alarm). Uses a silent token so the auth dialog never pops.
 *
 * @returns {Promise<void>}
 */
export async function gdriveAutoBackup() {
  const flags = await api.storage.local.get([
    STORAGE_KEYS.gdriveBackupEnabled,
    STORAGE_KEYS.gdriveAutoBackupEnabled,
  ]);
  if (!flags[STORAGE_KEYS.gdriveBackupEnabled] || !flags[STORAGE_KEYS.gdriveAutoBackupEnabled]) {
    console.log('GDrive auto-backup skipped: feature disabled');
    return;
  }

  try {
    const payload = await buildBackupPayload();
    const fileContent = JSON.stringify(payload, null, 2);

    await withAuthRetry(false, async (token) => {
      const existingFile = await findExistingBackup(token);
      await uploadBackupFile(token, fileContent, existingFile);
    });

    const timestamp = new Date().toISOString();
    await api.storage.local.set({
      [GDRIVE_LAST_BACKUP_TIME_KEY]: Date.now(),
      [GDRIVE_LAST_BACKUP_TIMESTAMP_KEY]: timestamp,
    });
    console.log('GDrive auto-backup completed successfully');
  } catch (error) {
    console.warn('GDrive auto-backup failed (will retry next cycle):', error.message);
    // Don't rethrow — the alarm reschedules itself.
  }
}

/**
 * Schedule or cancel the daily auto-backup alarm.
 *
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function scheduleGDriveAutoBackup(enabled) {
  if (enabled) {
    await api.alarms.create(ALARMS.gdriveAutoBackup, {
      periodInMinutes: TIMING.GDRIVE_AUTO_BACKUP_PERIOD_MINUTES,
    });
    console.log('GDrive auto-backup alarm scheduled (daily)');
    // Also do an immediate backup on enable.
    gdriveAutoBackup().catch((error) =>
      console.warn('Initial GDrive auto-backup failed:', error.message)
    );
  } else {
    await api.alarms.clearAlarm(ALARMS.gdriveAutoBackup);
    console.log('GDrive auto-backup alarm cleared');
  }
}
