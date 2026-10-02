// Service-worker entry point. Chrome loads this module as the extension's background context
// (manifest.json `background.service_worker`, `type: module`); `scripts/build.mjs` bundles it to
// `dist/background.js`, which is the path the manifest still names. Nothing here holds durable
// state, so a worker restart is always safe (skill.md §5.4).
import { api } from './api.js';
import { ALARMS, TIMING } from './constants.js';
import { runtime } from './runtime.js';
import { getState, setState } from './state.js';
import { ensureCurrentSession } from './bootstrap.js';
import { registerAutoSaveListeners, saveSession, saveSessionIfTabsOpen } from './autosave.js';
import { isSaveableUrl } from './lib/tabs.js';
import { buildContextMenus, registerContextMenuListeners } from './contextMenu.js';
import { registerMessageHandlers } from './messages.js';
import { registerPanelAction } from './panel.js';
import { gdriveAutoBackup } from './gdrive.js';
import { CURRENT_SESSION_ID } from '../src/shared/storage-keys.js';

registerAutoSaveListeners();
registerContextMenuListeners();
registerMessageHandlers();
registerPanelAction();

api.runtime.onInstalled.addListener(async () => {
  console.log('Tab Collection Manager installed/updated');

  const state = await getState();
  let needsUpdate = ensureCurrentSession(state);
  if (needsUpdate) console.log('Creating Current Session collection');

  if (!state.autoSaveCollectionId) {
    state.autoSaveCollectionId = CURRENT_SESSION_ID;
    needsUpdate = true;
  } else if (!state.collections.some((c) => c.id === state.autoSaveCollectionId)) {
    console.warn(`Cleaning up stale auto-save ID: ${state.autoSaveCollectionId}`);
    state.autoSaveCollectionId = CURRENT_SESSION_ID;
    needsUpdate = true;
  }

  if (needsUpdate) await setState(state);

  await buildContextMenus();

  // An initial auto-save once Chrome has settled, but only when tabs exist.
  setTimeout(() => {
    saveSessionIfTabsOpen();
  }, TIMING.INSTALL_INITIAL_SAVE_MS);
});

api.runtime.onStartup.addListener(async () => {
  console.log('Extension starting up after browser restart');
  runtime.isRestoring = true;
  runtime.startupTime = Date.now();

  const state = await getState();
  let needsUpdate = ensureCurrentSession(state);
  if (needsUpdate) console.log('Startup: Creating Current Session collection');

  if (!state.autoSaveCollectionId) {
    console.log('Startup: Setting auto-save to Current Session');
    state.autoSaveCollectionId = CURRENT_SESSION_ID;
    needsUpdate = true;
  }

  if (needsUpdate) await setState(state);

  await buildContextMenus();

  // Wait for Chrome to finish restoring tabs before allowing auto-saves.
  setTimeout(async () => {
    runtime.isRestoring = false;
    const tabs = await api.tabs.query({ lastFocusedWindow: true });
    if (tabs.some((tab) => isSaveableUrl(tab.url))) {
      console.log('Startup: Syncing current open tabs to Current Session');
      saveSession();
    } else {
      console.log('Startup restoration complete. No valid tabs to sync.');
    }
  }, TIMING.STARTUP_RESTORE_MS);
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARMS.gdriveAutoBackup) {
    gdriveAutoBackup().catch((error) => {
      console.error('GDrive auto-backup alarm failed:', error);
    });
  }
});
