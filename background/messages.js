// The `chrome.runtime.onMessage` router. Every command the panel sends is handled here; the
// protocol is frozen (skill.md §2.3) — adding one is additive, changing a payload is breaking.
import { api } from './api.js';
import {
  GDRIVE_ACCOUNT_EMAIL_KEY,
  GDRIVE_ACCOUNT_NAME_KEY,
  GDRIVE_ACCOUNT_PICTURE_KEY,
  GDRIVE_LAST_BACKUP_TIMESTAMP_KEY,
  GDRIVE_LAST_BACKUP_TIME_KEY,
  STORAGE_KEYS,
} from './constants.js';
import { getState } from './state.js';
import { saveSession } from './autosave.js';
import { restoreSession } from './restore.js';
import {
  backupToGDrive,
  deleteGDriveBackup,
  restoreFromGDrive,
  revokeAuthToken,
  scheduleGDriveAutoBackup,
} from './gdrive.js';

/**
 * Reply with a promise's result, mapping a rejection to `{success: false, error}`.
 *
 * @param {Promise<Record<string, any>>} promise
 * @param {(response: Record<string, any>) => void} sendResponse
 */
function respondWith(promise, sendResponse) {
  promise
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));
}

/** Register the worker's message handler. */
export function registerMessageHandlers() {
  api.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.command === 'forceAutoSave') {
      saveSession()
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error('Error in forceAutoSave handler:', error);
          sendResponse({ success: false });
        });
      return true; // Keep the channel open for the async response.
    }

    if (request.command === 'restoreSession') {
      // Fire-and-forget: the vanilla contract has always answered immediately.
      restoreSession(request.collectionId, request.backupData);
      sendResponse({ success: true });
      return undefined;
    }

    if (request.command === 'getSessionData') {
      getState().then((state) => {
        sendResponse({
          success: true,
          data: state.collections.find((collection) => collection.id === request.collectionId),
          lastSessionBackup: state.lastSessionBackup,
        });
      });
      return true;
    }

    if (request.command === 'gdriveBackup') {
      respondWith(backupToGDrive(request.token), sendResponse);
      return true;
    }

    if (request.command === 'gdriveRestore') {
      respondWith(restoreFromGDrive(request.token), sendResponse);
      return true;
    }

    if (request.command === 'gdriveDeleteBackup') {
      respondWith(deleteGDriveBackup(request.token), sendResponse);
      return true;
    }

    if (request.command === 'gdriveSignOut') {
      revokeAuthToken()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.command === 'gdriveEnableAutoBackup') {
      scheduleGDriveAutoBackup(request.enabled)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.command === 'gdriveGetStatus') {
      api.storage.local
        .get([
          STORAGE_KEYS.gdriveBackupEnabled,
          STORAGE_KEYS.gdriveAutoBackupEnabled,
          GDRIVE_LAST_BACKUP_TIME_KEY,
          GDRIVE_LAST_BACKUP_TIMESTAMP_KEY,
          GDRIVE_ACCOUNT_EMAIL_KEY,
          GDRIVE_ACCOUNT_NAME_KEY,
          GDRIVE_ACCOUNT_PICTURE_KEY,
        ])
        .then((data) => {
          sendResponse({
            success: true,
            enabled:
              !!data[STORAGE_KEYS.gdriveBackupEnabled] && !!data[GDRIVE_LAST_BACKUP_TIME_KEY],
            autoBackupEnabled: !!data[STORAGE_KEYS.gdriveAutoBackupEnabled],
            lastBackupTime: data[GDRIVE_LAST_BACKUP_TIME_KEY] || null,
            lastBackupTimestamp: data[GDRIVE_LAST_BACKUP_TIMESTAMP_KEY] || null,
            accountEmail: data[GDRIVE_ACCOUNT_EMAIL_KEY] || '',
            accountName: data[GDRIVE_ACCOUNT_NAME_KEY] || '',
            accountPicture: data[GDRIVE_ACCOUNT_PICTURE_KEY] || '',
          });
        });
      return true;
    }

    return undefined;
  });
}
