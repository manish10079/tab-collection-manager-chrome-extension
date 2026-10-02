// The autosave engine: debounced writes from tab/window events, the startup stabilization window,
// the partial-restore guard and the session-history ring. This is the highest-risk code in the
// repository, so the decisions live in `lib/tabs.js` (pure, tested) and this file only orchestrates.
import { api } from './api.js';
import { TIMING } from './constants.js';
import { getState, updateState } from './state.js';
import { runtime } from './runtime.js';
import { captureGroupMeta } from './chromeGroups.js';
import {
  flattenAndCap,
  groupTabsByWindow,
  isSaveableUrl,
  mergePreservingIdentity,
  partitionPinnedFirst,
  shouldRefuseOverwrite,
  snapshotOpenTabs,
} from './lib/tabs.js';
import { LIMITS } from '../src/shared/constants.js';

/**
 * Schedule an auto-save, unless the worker is still stabilizing or restoring tabs.
 *
 * @returns {void}
 */
export function triggerAutoSave() {
  if (
    runtime.isRestoring ||
    (runtime.startupTime > 0 && Date.now() - runtime.startupTime < TIMING.STABILIZATION_PERIOD_MS)
  ) {
    console.log('Auto-save deferred: Extension is in stabilization/restoring phase');
    return;
  }

  clearTimeout(runtime.autoSaveTimer);
  runtime.autoSaveTimer = setTimeout(saveSession, TIMING.AUTO_SAVE_DEBOUNCE_MS);
}

/**
 * Snapshot the last focused window into the auto-save collection and record a history entry.
 *
 * @returns {Promise<void>}
 */
export async function saveSession() {
  const state = await getState();
  const { autoSaveCollectionId, collections } = state;

  if (!autoSaveCollectionId) return; // Auto-save disabled

  const collectionExists = collections.some((collection) => collection.id === autoSaveCollectionId);
  if (!collectionExists) {
    console.warn(`Auto-save collection ${autoSaveCollectionId} not found, disabling auto-save`);
    await updateState((next) => {
      next.autoSaveCollectionId = null;
    });
    return;
  }

  const tabs = await api.tabs.query({ lastFocusedWindow: true });
  console.log(`[saveSession] Query returned ${tabs.length} tabs total.`);

  const tabObjects = snapshotOpenTabs(tabs);

  // Don't overwrite a saved session with an empty one.
  if (tabObjects.length === 0) {
    console.log('Auto-save: No open tabs to save, preserving existing session');
    return;
  }

  const tabsByWindow = groupTabsByWindow(tabObjects);
  const sortedTabObjects = Object.values(tabsByWindow).flat();
  const limitedTabObjects = flattenAndCap(tabsByWindow, LIMITS.MAX_TABS_PER_COLLECTION);

  // Capture Chrome tab-group metadata so groups can be rebuilt on restore.
  const chromeGroups = await captureGroupMeta(tabs);

  if (sortedTabObjects.length > LIMITS.MAX_TABS_PER_COLLECTION) {
    console.warn(
      `Auto-save: Too many open tabs (${sortedTabObjects.length}), limiting to ${LIMITS.MAX_TABS_PER_COLLECTION}`
    );
  }

  await updateState((next) => {
    const collection = next.collections.find((candidate) => candidate.id === autoSaveCollectionId);
    if (!collection) return;

    const currentTabCount = collection.tabs ? collection.tabs.length : 0;
    const newTabCount = limitedTabObjects.length;

    // Guard: a partial restoration can briefly report far fewer tabs than are saved.
    if (
      shouldRefuseOverwrite({
        previousTabCount: currentTabCount,
        nextTabCount: newTabCount,
        now: Date.now(),
        startupTime: runtime.startupTime,
      })
    ) {
      console.warn(
        `[GUARD] Refusing to overwrite ${currentTabCount} tabs with only ${newTabCount} tabs. Potential partial restoration detected.`
      );
      return;
    }

    const updatedTabObjects = mergePreservingIdentity(limitedTabObjects, collection.tabs || [], {
      enforceMaxPinnedTabs: next.enforceMaxPinnedTabs,
      maxPinnedTabs: next.maxPinnedTabs,
    });

    // Keep one restore point before overwriting a populated collection. The group metadata travels
    // with the tabs: the snapshot's tabs carry `chromeGroupId`s, and without the map those ids point
    // at nothing, so "Restore Previous Session" could not rebuild the groups it recorded.
    if (collection.tabs && collection.tabs.length > 0) {
      next.lastSessionBackup = {
        tabs: collection.tabs,
        chromeGroups: collection.chromeGroups || {},
        timestamp: Date.now(),
        collectionId: autoSaveCollectionId,
        name: collection.name,
      };
    }

    const finalTabs = partitionPinnedFirst(updatedTabObjects);
    collection.tabs = finalTabs;
    collection.updatedAt = Date.now();
    collection.windowGroups = tabsByWindow;
    collection.chromeGroups = chromeGroups;

    // ── Session history ring ──
    if (!next.sessionHistory) next.sessionHistory = [];
    next.sessionHistory.unshift({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tabs: finalTabs,
      // Same reason as the restore point above: a history entry that records `chromeGroupId`s
      // without their metadata can never put the groups back.
      chromeGroups,
    });
    if (next.sessionHistory.length > LIMITS.MAX_SESSION_HISTORY) {
      next.sessionHistory = next.sessionHistory.slice(0, LIMITS.MAX_SESSION_HISTORY);
    }
  });

  console.log(
    `Auto-saved ${limitedTabObjects.length} tabs to collection ${autoSaveCollectionId} and recorded in session history.`
  );
}

/**
 * Save, but only when the focused window has at least one saveable tab. Used by install and
 * startup, where an empty restored session should not create a history entry.
 *
 * @returns {Promise<void>}
 */
export async function saveSessionIfTabsOpen() {
  const tabs = await api.tabs.query({ lastFocusedWindow: true });
  if (tabs.some((tab) => isSaveableUrl(tab.url))) return saveSession();
  return undefined;
}

/** Wire the browser events that feed the debounced auto-save. */
export function registerAutoSaveListeners() {
  api.tabs.onCreated.addListener(() => triggerAutoSave());
  api.tabs.onRemoved.addListener(() => triggerAutoSave());
  api.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    // Only a URL or title change matters; a bare status change does not.
    if (changeInfo.url || changeInfo.title) triggerAutoSave();
  });
  api.windows.onRemoved.addListener(() => triggerAutoSave());
  api.windows.onFocusChanged.addListener(() => triggerAutoSave());
}
