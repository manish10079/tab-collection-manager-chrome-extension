// Service-worker constants. The shared storage keys and limits are imported from `src/shared/`
// rather than re-typed here (skill.md §2.3, §10): the worker and the UI must agree on the contract.
import { STORAGE_KEYS } from '../src/shared/storage-keys.js';

/** Context-menu parent id; children are `collection-<id>`. */
export const CONTEXT_MENU_PARENT_ID = 'add-to-collection';

/** Filename of the single Drive appDataFolder backup. */
export const GDRIVE_BACKUP_FILENAME = 'tab_collection_manager_backup.json';

/** Worker bookkeeping keys written alongside the shared GDrive flags. */
export const GDRIVE_LAST_BACKUP_TIME_KEY = 'lastGDriveBackupTime';
export const GDRIVE_LAST_BACKUP_TIMESTAMP_KEY = 'lastGDriveBackupTimestamp';
export const GDRIVE_LAST_RESTORE_TIME_KEY = 'lastGDriveRestoreTime';

/** Chrome alarm names. */
export const ALARMS = Object.freeze({
  gdriveAutoBackup: 'gdrive_auto_backup',
});

/** Timing windows, named so the autosave guards read as intent rather than magic numbers. */
export const TIMING = Object.freeze({
  STABILIZATION_PERIOD_MS: 8000,
  AUTO_SAVE_DEBOUNCE_MS: 500,
  OVERWRITE_GUARD_WINDOW_MS: 30000,
  CONTEXT_MENU_DEBOUNCE_MS: 300,
  INSTALL_INITIAL_SAVE_MS: 2000,
  STARTUP_RESTORE_MS: 10000,
  GDRIVE_AUTO_BACKUP_PERIOD_MINUTES: 1440,
});

export { STORAGE_KEYS };
