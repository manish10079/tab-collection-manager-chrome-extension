// Background Service Worker - Auto‑Save Engine
// Handles Chrome tab events and auto‑save logic with debounce
// checking git is working or not

// ==================== STORAGE HELPERS ====================
async function getState() {
  const result = await api.storage.local.get([
    'collections', 
    'autoSaveCollectionId', 
    'lastSessionBackup', 
    'ramSaverEnabled', 
    'enforceMaxPinnedTabs', 
    'maxPinnedTabs',
    'enforceMaxPinnedCollections',
    'maxPinnedCollections',
    'sessionHistory'
  ]);
  return {
    collections: result.collections || [],
    autoSaveCollectionId: result.autoSaveCollectionId || null,
    lastSessionBackup: result.lastSessionBackup || null,
    ramSaverEnabled: !!result.ramSaverEnabled,
    enforceMaxPinnedTabs: result.enforceMaxPinnedTabs !== false,
    maxPinnedTabs: result.maxPinnedTabs ?? 3,
    enforceMaxPinnedCollections: result.enforceMaxPinnedCollections !== false,
    maxPinnedCollections: result.maxPinnedCollections ?? 3,
    sessionHistory: result.sessionHistory || []
  };
}

async function setState(state) {
  await api.storage.local.set(state);
}

// Queue to serialize state updates and prevent race conditions
let updateQueue = Promise.resolve();

async function updateState(mutator) {
  // Chain this update after all previous updates
  return updateQueue = updateQueue.then(async () => {
    const state = await getState();
    const newState = structuredClone(state);
    mutator(newState);
    await setState(newState);
    return newState;
  }).catch(error => {
    console.error('Error in updateState:', error);
    throw error;
  });
}

// ==================== UTILITY FUNCTIONS ====================
const MAX_TABS_PER_COLLECTION = 200;
// Cross-browser compatibility wrapper (supports Chrome, Brave, Edge, Firefox)
const api = typeof browser !== 'undefined' ? browser : chrome;

const CURRENT_SESSION_ID = 'current-session';

// ── Chrome tab-group helpers ──
// Chrome reports TAB_ID_NONE (-1) for tabs that are not part of any group.
const TAB_GROUP_ID_NONE = (typeof chrome !== 'undefined' && chrome.tabGroups &&
  typeof chrome.tabGroups.TAB_ID_NONE === 'number') ? chrome.tabGroups.TAB_ID_NONE : -1;

function normalizeGroupId(groupId) {
  return (typeof groupId === 'number' && groupId !== TAB_GROUP_ID_NONE && groupId >= 0) ? groupId : null;
}

/**
 * Read the title/color/collapsed metadata for every live tab group referenced
 * by the given tabs. Returns { [groupId]: { title, color, collapsed } }.
 */
async function captureGroupMeta(tabs) {
  const meta = {};
  if (!api.tabGroups || typeof api.tabGroups.get !== 'function') return meta;
  const ids = [...new Set((tabs || []).map(t => normalizeGroupId(t.groupId)).filter(id => id !== null))];
  for (const id of ids) {
    try {
      const group = await api.tabGroups.get(id);
      meta[id] = {
        title: group.title || '',
        color: group.color || 'grey',
        collapsed: !!group.collapsed
      };
    } catch (err) {
      // The group disappeared between the query and this read — skip it.
    }
  }
  return meta;
}

function validateUrl(url) {
  if (!url) return false;
  // Skip chrome://, about:, and other internal URLs
  if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://')) {
    return false;
  }
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ==================== AUTO‑SAVE LOGIC ====================
let autoSaveTimer = null;
let isRestoring = false;
let startupTime = 0; // Initialize to 0; only set to Date.now() on browser startup/installation

function triggerAutoSave() {
  // Prevent any auto-save for the first few seconds of extension startup
  // This allows Chrome to restore tabs without intermediate partial saves
  const STABILIZATION_PERIOD = 8000; // 8 seconds
  if (isRestoring || (startupTime > 0 && (Date.now() - startupTime < STABILIZATION_PERIOD))) {
    console.log('Auto-save deferred: Extension is in stabilization/restoring phase');
    return;
  }

  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveSession, 500); // Debounce 500ms
}

async function saveSession() {
  const state = await getState();
  const { autoSaveCollectionId, collections } = state;

  if (!autoSaveCollectionId) return; // Auto‑save disabled

  // Check if collection still exists
  const collectionExists = collections.some(c => c.id === autoSaveCollectionId);
  if (!collectionExists) {
    console.warn(`Auto‑save collection ${autoSaveCollectionId} not found, disabling auto‑save`);
    await updateState(state => {
      state.autoSaveCollectionId = null;
    });
    return;
  }

  // Get open tabs in the last focused window
  const tabs = await api.tabs.query({ lastFocusedWindow: true });
  console.log(`[saveSession] Query returned ${tabs.length} tabs total.`);

  const tabObjects = tabs
    .filter(tab => validateUrl(tab.url))
    .map(tab => ({
      id: crypto.randomUUID(),
      title: (tab.title || '').trim() || 'Untitled',
      url: tab.url,
      pinned: tab.pinned || false,
      index: tab.index || 0,
      windowId: tab.windowId || 0,
      active: tab.active || false,
      discarded: tab.discarded || false,
      highlighted: tab.highlighted || false,
      chromeGroupId: normalizeGroupId(tab.groupId)
    }));

  // Don't overwrite saved session with empty tabs
  if (tabObjects.length === 0) {
    console.log('Auto‑save: No open tabs to save, preserving existing session');
    return;
  }

  // Group tabs by window
  const tabsByWindow = {};
  tabObjects.forEach(tab => {
    if (!tabsByWindow[tab.windowId]) {
      tabsByWindow[tab.windowId] = [];
    }
    tabsByWindow[tab.windowId].push(tab);
  });

  Object.values(tabsByWindow).forEach(windowTabs => {
    windowTabs.sort((a, b) => a.index - b.index);
  });

  const sortedTabObjects = Object.values(tabsByWindow).flat();
  const limitedTabObjects = sortedTabObjects.slice(0, MAX_TABS_PER_COLLECTION);

  // Capture Chrome tab-group metadata so groups can be rebuilt on restore.
  const chromeGroups = await captureGroupMeta(tabs);
  
  if (sortedTabObjects.length > MAX_TABS_PER_COLLECTION) {
    console.warn(`Auto‑save: Too many open tabs (${sortedTabObjects.length}), limiting to ${MAX_TABS_PER_COLLECTION}`);
  }

  await updateState(state => {
    const collection = state.collections.find(c => c.id === autoSaveCollectionId);
    if (collection) {
      const currentTabCount = collection.tabs ? collection.tabs.length : 0;
      const newTabCount = limitedTabObjects.length;
      
      // Guard Logic
      if (currentTabCount > 5 && newTabCount < (currentTabCount * 0.3) && (Date.now() - startupTime < 30000)) {
        console.warn(`[GUARD] Refusing to overwrite ${currentTabCount} tabs with only ${newTabCount} tabs. Potential partial restoration detected.`);
        return;
      }

      // Match existing tabs to preserve ID, addedAt, and pinned status
      const existingTabs = [...(collection.tabs || [])];
      let preservedPinnedCount = 0;
      const MAX_PINNED_TABS = state.maxPinnedTabs;
      const updatedTabObjects = limitedTabObjects.map(newTab => {
        const existingIndex = existingTabs.findIndex(et => et.url === newTab.url);
        if (existingIndex !== -1) {
          const existing = existingTabs.splice(existingIndex, 1)[0];
          let isPinned = existing.pinned || false;
          if (isPinned && state.enforceMaxPinnedTabs) {
            if (preservedPinnedCount < MAX_PINNED_TABS) {
              preservedPinnedCount++;
            } else {
              isPinned = false;
            }
          }
          return {
            ...newTab,
            id: existing.id,
            addedAt: existing.addedAt || Date.now(),
            pinned: isPinned
          };
        } else {
          let isPinned = newTab.pinned || false;
          if (isPinned && state.enforceMaxPinnedTabs) {
            if (preservedPinnedCount < MAX_PINNED_TABS) {
              preservedPinnedCount++;
            } else {
              isPinned = false;
            }
          }
          return {
            ...newTab,
            addedAt: Date.now(),
            pinned: isPinned
          };
        }
      });

      const partitionTabs = (tabs) => {
        const pinned = tabs.filter(t => t.pinned);
        const unpinned = tabs.filter(t => !t.pinned);
        return [...pinned, ...unpinned];
      };

      // Create a backup of previous session before overwriting
      if (collection.tabs && collection.tabs.length > 0) {
        state.lastSessionBackup = {
          tabs: collection.tabs,
          timestamp: Date.now(),
          collectionId: autoSaveCollectionId,
          name: collection.name
        };
      }
      
      // Replace tabs in current collection
      const finalTabs = partitionTabs(updatedTabObjects);
      collection.tabs = finalTabs;
      collection.updatedAt = Date.now();
      collection.windowGroups = tabsByWindow;
      collection.chromeGroups = chromeGroups;

      // ─── SESSION HISTORY STORAGE ENGINE ───
      // Push the active set as a history snapshot
      if (!state.sessionHistory) {
        state.sessionHistory = [];
      }

      const historySnapshot = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        tabs: finalTabs
      };

      // Add to the front of the list (most recent session first)
      state.sessionHistory.unshift(historySnapshot);

      // Enforce the 100 session limit (removes oldest from the end)
      if (state.sessionHistory.length > 100) {
        state.sessionHistory = state.sessionHistory.slice(0, 100);
      }
    }
  });

  console.log(`Auto‑saved ${limitedTabObjects.length} tabs to collection ${autoSaveCollectionId} and recorded in session history.`);
}

// ==================== EVENT LISTENERS ====================
chrome.tabs.onCreated.addListener(() => {
  triggerAutoSave();
});

chrome.tabs.onRemoved.addListener(() => {
  triggerAutoSave();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only trigger if URL or title changed (not just status)
  if (changeInfo.url || changeInfo.title) {
    triggerAutoSave();
  }
});

// Listen for window removal
chrome.windows.onRemoved.addListener(() => {
  triggerAutoSave();
});

// Optional: Listen for window focus changes
chrome.windows.onFocusChanged.addListener(() => {
  triggerAutoSave();
});

chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({
        windowId: tab.windowId
    });
});

// ==================== CONTEXT MENU ====================
const CONTEXT_MENU_PARENT_ID = 'add-to-collection';

/**
 * Build (or rebuild) the "Add to Collection" context‑menu tree.
 * Creates a parent item and one child per user collection.
 * Current Session is excluded since it auto‑saves.
 */
async function buildContextMenus() {
  // Remove all existing menus first to avoid duplicates
  await chrome.contextMenus.removeAll();

  const state = await getState();
  const collections = (state.collections || []).filter(
    c => c.id !== CURRENT_SESSION_ID
  );

  // Only create the menu if there are user collections
  if (collections.length === 0) {
    // Create a single disabled item so users know where to look
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT_ID,
      title: 'Add to Collection (no collections yet)',
      contexts: ['page', 'link'],
      enabled: false
    });
    return;
  }

  // Parent menu
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PARENT_ID,
    title: 'Add to Collection',
    contexts: ['page', 'link']
  });

  // One child per collection
  collections.forEach(collection => {
    chrome.contextMenus.create({
      id: `collection-${collection.id}`,
      parentId: CONTEXT_MENU_PARENT_ID,
      title: collection.name,
      contexts: ['page', 'link']
    });
  });

  console.log(`Context menus built: ${collections.length} collection(s)`);
}

/**
 * Check if a URL already exists in any collection (including Current Session).
 * Returns an array of collection names where the URL was found.
 * @param {string} url - The URL to check
 * @param {Array} collections - All collections to search through
 * @returns {string[]} Array of collection names that already contain this URL
 */
function findDuplicateCollections(url, collections) {
  const normalizedUrl = url.trim().toLowerCase().replace(/\/+$/, '');
  const found = [];
  for (const collection of collections) {
    // Exclude Current Session — it dynamically mirrors all open tabs,
    // so any open tab will always appear there. Flagging it as a duplicate
    // would produce false-positive warnings on every context-menu add.
    if (collection.id === CURRENT_SESSION_ID) continue;
    if (!collection.tabs) continue;
    const exists = collection.tabs.some(
      t => t.url.trim().toLowerCase().replace(/\/+$/, '') === normalizedUrl
    );
    if (exists) found.push(collection.name);
  }
  return found;
}

/**
 * Handle a context‑menu click.
 * Extracts the tab's title & URL (or the link URL for link context)
 * and adds it to the chosen collection.
 * Includes duplicate detection across ALL collections (including Current Session).
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;
  if (typeof menuId !== 'string' || !menuId.startsWith('collection-')) return;

  const collectionId = menuId.replace('collection-', '');

  // Determine title & URL — if user right-clicked a link, use the link URL
  const url = info.linkUrl || info.pageUrl || (tab ? tab.url : '');
  const title = info.linkUrl
    ? (info.selectionText || info.linkUrl)        // link context: use selected text or raw URL
    : (tab ? tab.title : 'Untitled');              // page context: use tab title

  if (!url) {
    console.warn('Context menu: no URL to add');
    return;
  }

  // Validate URL
  if (!validateUrl(url)) {
    console.warn('Context menu: invalid URL skipped:', url);
    return;
  }

  // ── Duplicate Detection ──────────────────────────────────────────────────
  // Check the URL against ALL collections, including Current Session (Task 2).
  // This prevents silently adding a tab that already lives in any collection.
  const currentState = await getState();
  const duplicateIn = findDuplicateCollections(url, currentState.collections);
  if (duplicateIn.length > 0) {
    const names = duplicateIn.join(', ');
    console.warn(`Context menu: duplicate URL already exists in: ${names}. Skipping add.`);
    // Flash a red badge to inform the user without a blocking dialog
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      await chrome.action.setBadgeText({ text: '!' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    } catch (e) { /* Badge API may not be available in all contexts */ }
    return; // Do not add the duplicate
  }
  // ────────────────────────────────────────────────────────────────────────

  // Add the tab to the collection
  let added = false;
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (!collection) return;
    if (collection.tabs.length >= MAX_TABS_PER_COLLECTION) {
      console.warn(`Context menu: collection "${collection.name}" is full (${MAX_TABS_PER_COLLECTION} tabs)`);
      return;
    }
    collection.tabs.push({
      id: crypto.randomUUID(),
      title: (title || '').trim() || 'Untitled',
      url: url,
      pinned: false,
      index: collection.tabs.length,
      windowId: tab ? tab.windowId : 0,
      active: false,
      discarded: false,
      highlighted: false,
      addedAt: Date.now()
    });
    collection.updatedAt = Date.now();
    added = true;
  });

  if (added) {
    // Show a badge on the extension icon briefly as confirmation
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#4ecdc4' });
      await chrome.action.setBadgeText({ text: '✓' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
    } catch (e) {
      // Badge API may not be available in all contexts
    }
    console.log(`Context menu: added "${title}" to collection ${collectionId}`);
  }
});

// Debounce guard — prevents parallel buildContextMenus() races that cause
// "Cannot create item with duplicate id" when storage fires rapidly (e.g. auto-save).
let _contextMenuRebuildTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.collections) {
      clearTimeout(_contextMenuRebuildTimer);
      _contextMenuRebuildTimer = setTimeout(() => {
        buildContextMenus();
      }, 300); // wait 300 ms for writes to settle before rebuilding
    }
  }
});

// ==================== INSTALL / UPDATE ====================
api.runtime.onInstalled.addListener(async () => {
  console.log('Tab Collection Manager installed/updated');
  
  const state = await getState();
  let needsUpdate = false;
  
  // Ensure collections array exists
  if (!state.collections) {
    state.collections = [];
    needsUpdate = true;
  }
  
  // Check if Current Session collection exists, create if missing
  const currentSessionExists = state.collections.some(c => c.id === CURRENT_SESSION_ID);
  if (!currentSessionExists) {
    console.log('Creating Current Session collection');
    state.collections.unshift({
      id: CURRENT_SESSION_ID,
      name: 'Current Session',
      tabs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
      isCurrentSession: true,
      windowGroups: {}
    });
    needsUpdate = true;
  }
  
  // Set auto‑save to Current Session by default (if not already set)
  if (!state.autoSaveCollectionId) {
    state.autoSaveCollectionId = CURRENT_SESSION_ID;
    needsUpdate = true;
  } else {
    // Clean up any stale auto‑save collection IDs (except Current Session)
    const collectionExists = state.collections.some(c => c.id === state.autoSaveCollectionId);
    if (!collectionExists) {
      console.warn(`Cleaning up stale auto‑save ID: ${state.autoSaveCollectionId}`);
      state.autoSaveCollectionId = CURRENT_SESSION_ID;
      needsUpdate = true;
    }
  }
  
  if (needsUpdate) {
    await setState(state);
  }

  // Build context menus on install/update
  await buildContextMenus();
  
  // After installation/update, perform an initial auto‑save (but only if tabs exist)
  setTimeout(async () => {
    const tabs = await api.tabs.query({ lastFocusedWindow: true });
    const validTabs = tabs.filter(tab => validateUrl(tab.url));
    if (validTabs.length > 0) {
      saveSession();
    }
  }, 2000);
});

// ==================== STARTUP ====================
api.runtime.onStartup.addListener(async () => {
  console.log('Extension starting up after browser restart');
  isRestoring = true;
  startupTime = Date.now();
  
  const state = await getState();
  let needsUpdate = false;
  
  // Check if Current Session collection exists, create if missing
  const currentSessionExists = state.collections?.some(c => c.id === CURRENT_SESSION_ID);
  if (!currentSessionExists) {
    console.log('Startup: Creating Current Session collection');
    if (!state.collections) state.collections = [];
    state.collections.unshift({
      id: CURRENT_SESSION_ID,
      name: 'Current Session',
      tabs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
      isCurrentSession: true,
      windowGroups: {}
    });
    needsUpdate = true;
  }
  
  // Ensure auto‑save targets Current Session
  if (!state.autoSaveCollectionId) {
    console.log('Startup: Setting auto‑save to Current Session');
    state.autoSaveCollectionId = CURRENT_SESSION_ID;
    needsUpdate = true;
  }
  
  if (needsUpdate) {
    await setState(state);
  }

  // Build context menus on startup
  await buildContextMenus();
  
  // Wait for tabs to restore
  setTimeout(async () => {
    isRestoring = false; // Allow auto-saves now
    const tabs = await api.tabs.query({ lastFocusedWindow: true });
    const validTabs = tabs.filter(tab => validateUrl(tab.url));
    
    if (validTabs.length > 0) {
      console.log('Startup: Syncing current open tabs to Current Session');
      saveSession();
    } else {
      console.log('Startup restoration complete. No valid tabs to sync.');
    }
  }, 10000); // 10 seconds to allow for full restoration
});

/**
 * RAM Saver: Discards a tab ONLY after it has fully loaded and is not active.
 * Calling api.tabs.discard() immediately after api.tabs.create() causes
 * a race condition where the tab gets stuck in an infinite loading spinner.
 * This helper waits for status === 'complete' before discarding, and checks tab.active.
 * @param {number} tabId - The ID of the tab to discard.
 * @param {number} [timeoutMs=10000] - Max wait time before giving up.
 */
function discardWhenLoaded(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      api.tabs.onUpdated.removeListener(onUpdated);
    };

    // Safety timeout — discard anyway after timeoutMs to avoid memory leak, if not active
    const timer = setTimeout(async () => {
      if (settled) return;
      cleanup();
      try {
        const tab = await api.tabs.get(tabId);
        if (tab && !tab.active) {
          api.tabs.discard(tabId).catch(() => {});
        }
      } catch (e) {
        // Tab might have been closed
      }
      resolve();
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;

      // If user activated/clicked the tab while loading, cancel the discard
      if (tab && tab.active) {
        cleanup();
        clearTimeout(timer);
        resolve();
        return;
      }

      if (changeInfo.status !== 'complete') return;

      cleanup();
      clearTimeout(timer);
      api.tabs.discard(tabId).catch(() => {});
      resolve();
    }

    api.tabs.onUpdated.addListener(onUpdated);
  });
}

// ==================== RESTORE FUNCTIONALITY ====================
// Expose restore functionality to popup
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'forceAutoSave') {
    saveSession().then(() => {
      sendResponse({ success: true });
      
    }).catch(err => {
      console.error('Error in forceAutoSave handler:', err);
      sendResponse({ success: false });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.command === 'restoreSession') {
    restoreSession(request.collectionId, request.backupData);
    sendResponse({ success: true });
  }
  
  if (request.command === 'getSessionData') {
    getState().then(state => {
      const collection = state.collections.find(c => c.id === request.collectionId);
      sendResponse({ 
        success: true, 
        data: collection,
        lastSessionBackup: state.lastSessionBackup
      });
    });
    return true; // Keep message channel open for async response
  }

  // ── Google Drive Backup Commands ──
  if (request.command === 'gdriveBackup') {
    backupToGDrive()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.command === 'gdriveRestore') {
    restoreFromGDrive()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.command === 'gdriveDeleteBackup') {
    deleteGDriveBackup()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.command === 'gdriveSignOut') {
    revokeAuthToken()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.command === 'gdriveEnableAutoBackup') {
    scheduleGDriveAutoBackup(request.enabled)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.command === 'gdriveGetStatus') {
    api.storage.local.get([
      GDRIVE_BACKUP_KEY, GDRIVE_AUTO_BACKUP_KEY,
      'lastGDriveBackupTime', 'lastGDriveBackupTimestamp'
    ]).then(data => {
      sendResponse({
        success: true,
        enabled: !!data[GDRIVE_BACKUP_KEY],
        autoBackupEnabled: !!data[GDRIVE_AUTO_BACKUP_KEY],
        lastBackupTime: data.lastGDriveBackupTime || null,
        lastBackupTimestamp: data.lastGDriveBackupTimestamp || null
      });
    });
    return true;
  }


});

/**
 * Rebuild the Chrome tab groups a collection was saved with.
 * Saved group ids are stale, so each saved group is recreated fresh and then
 * updated with its saved title/color/collapsed state.
 * @param {object} collection - Collection with tabs[].chromeGroupId + chromeGroups map.
 * @param {Array} createdTabs - Created tabs, index-aligned with collection.tabs.
 * @param {number} targetWindowId - Window the tabs were created in.
 */
async function restoreTabGroups(collection, createdTabs, targetWindowId) {
  if (!api.tabs.group || !api.tabGroups) return;
  const savedGroups = collection.chromeGroups;
  if (!savedGroups || typeof savedGroups !== 'object') return;

  // saved groupId -> created chrome tab ids (in collection order)
  const groupedTabIds = new Map();
  collection.tabs.forEach((tab, i) => {
    const created = createdTabs[i];
    if (!created || !created.id) return;
    if (tab.pinned) return; // Chrome cannot group pinned tabs
    const savedGroupId = tab.chromeGroupId;
    if (savedGroupId === null || savedGroupId === undefined) return;
    if (!savedGroups[savedGroupId]) return; // group metadata was lost
    if (!groupedTabIds.has(savedGroupId)) groupedTabIds.set(savedGroupId, []);
    groupedTabIds.get(savedGroupId).push(created.id);
  });

  for (const [savedGroupId, tabIds] of groupedTabIds) {
    if (!tabIds.length) continue;
    try {
      const meta = savedGroups[savedGroupId] || {};
      const createProperties = targetWindowId !== undefined ? { windowId: targetWindowId } : {};
      const newGroupId = await api.tabs.group({ tabIds, createProperties });
      await api.tabGroups.update(newGroupId, {
        ...(meta.title ? { title: meta.title } : {}),
        color: meta.color || 'grey',
        collapsed: !!meta.collapsed
      });
    } catch (err) {
      console.warn('Failed to restore tab group:', savedGroupId, err);
    }
  }
}

async function restoreSession(collectionId, backupData = null) {
  const state = await getState();
  let collection = backupData;
  
  if (!collection) {
    collection = state.collections.find(c => c.id === collectionId);
  }
  
  if (!collection || !collection.tabs || collection.tabs.length === 0) {
    console.error('No tabs to restore in collection:', collectionId);
    return;
  }
  
  console.log(`Restoring ${collection.tabs.length} tabs from ${backupData ? 'backup' : 'collection ' + collectionId}`);
  
  // Group tabs by window, handling cases where windowId might be missing/invalid
  const tabsByWindow = {};
  collection.tabs.forEach(tab => {
    // Fallback to windowId 0 if missing or invalid
    const winId = (typeof tab.windowId === 'number' && tab.windowId > 0) ? tab.windowId : 0;
    if (!tabsByWindow[winId]) {
      tabsByWindow[winId] = [];
    }
    tabsByWindow[winId].push(tab);
  });
  
  // Sort tabs within each window by index
  Object.values(tabsByWindow).forEach(windowTabs => {
    windowTabs.sort((a, b) => (a.index || 0) - (b.index || 0));
  });
  
  // Restore all tabs in the current focused window
  try {
    const currentWindow = await api.windows.getLastFocused();
    const targetWindowId = currentWindow ? currentWindow.id : undefined;

    console.log(`Restoring all ${collection.tabs.length} tabs into window ${targetWindowId}`);

    // Create tabs in the target window
    const tabPromises = collection.tabs.map((tab, i) => {
      let url = tab.url;
      if (!url || url === 'about:blank') return Promise.resolve();
      if (!url.startsWith('http')) url = 'https://' + url;

      return api.tabs.create({
        windowId: targetWindowId,
        url: url,
        pinned: !!tab.pinned,
        active: false, // Don't focus newly opened tabs to avoid flickering
        index: undefined // Let Chrome append them to the end
      }).then(createdTab => {
        if (state.ramSaverEnabled && createdTab && createdTab.id) {
          discardWhenLoaded(createdTab.id);
        }
        return createdTab;
      }).catch(err => console.error(`Failed to create tab: ${url}`, err));
    });

    const createdTabs = await Promise.all(tabPromises);
    await restoreTabGroups(collection, createdTabs, targetWindowId);
    console.log('Session restored successfully into current window');
  } catch (err) {
    console.error('Error during restoration into current window:', err);
    // Fallback: just open tabs
    for (const tab of collection.tabs) {
      api.tabs.create({ url: tab.url, active: false }).then(createdTab => {
        if (state.ramSaverEnabled && createdTab && createdTab.id) {
          discardWhenLoaded(createdTab.id);
        }
      }).catch(() => {});
    }
  }
}




// ==================== LOCAL DAILY BACKUP (disabled) ====================
// Automatically downloads a JSON backup to the user's Downloads folder
// every day at 10:00 PM sharp.

function msUntilNext10PM() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(22, 0, 0, 0); // 10:00 PM
  if (now >= target) {
    target.setDate(target.getDate() + 1); // tomorrow
  }
  return target.getTime() - now.getTime();
}

async function scheduleDailyLocalBackup() {
  const delayMs = msUntilNext10PM();
  const delayMin = Math.max(1, Math.round(delayMs / 60000));
  await api.alarms.create('local_daily_backup', { delayInMinutes: delayMin });
  const targetTime = new Date(Date.now() + delayMs).toLocaleTimeString();
  console.log(`Local daily backup scheduled for ${targetTime} (in ${delayMin} min)`);
}

async function performLocalBackup() {
  try {
    const state = await getState();
    const backupData = {
      backupType: 'local-daily',
      exportedAt: new Date().toISOString(),
      version: api.runtime.getManifest().version,
      collections: state.collections,
      settings: {
        ramSaverEnabled: state.ramSaverEnabled,
        enforceMaxPinnedTabs: state.enforceMaxPinnedTabs,
        maxPinnedTabs: state.maxPinnedTabs,
        sessionHistory: (state.sessionHistory || []).slice(0, 50) // limit history in backup
      }
    };

    const json = JSON.stringify(backupData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toTimeString().slice(0, 5).replace(':', ''); // HHmm
    const filename = `tab_manager_backup_${dateStr}_${timeStr}.json`;

    await api.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    // Revoke after a short delay to let the download start
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    await api.storage.local.set({ last_local_backup_time: Date.now() });
    console.log(`Local daily backup saved: ${filename}`);
    return { success: true, filename };
  } catch (err) {
    console.error('Local daily backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Alarm event listener
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'local_daily_backup') {
    performLocalBackup()
      .then(() => scheduleDailyLocalBackup()) // reschedule for next day
      .catch(err => {
        console.error('Local daily backup alarm failed:', err);
        scheduleDailyLocalBackup(); // reschedule even on failure
      });
  }
  if (alarm.name === 'gdrive_auto_backup') {
    gdriveAutoBackup().catch(err => {
      console.error('GDrive auto-backup alarm failed:', err);
    });
  }
});

// ==================== GOOGLE DRIVE CLOUD BACKUP ====================
// Uses Chrome Identity API + Drive appDataFolder for secure, isolated backups.
// Requires: identity permission, oauth2 client_id in manifest, drive.appdata scope.

const GDRIVE_BACKUP_FILENAME = 'tab_collection_manager_backup.json';
const GDRIVE_BACKUP_KEY = 'gdriveBackupEnabled';
const GDRIVE_AUTO_BACKUP_KEY = 'gdriveAutoBackupEnabled';

/**
 * Get OAuth2 access token via Chrome Identity API.
 * @param {boolean} interactive - If true, shows the auth prompt. If false, returns cached token silently.
 * @returns {Promise<string>} The access token.
 */
function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to get auth token'));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Remove a cached OAuth token so the next request forces a fresh one.
 * @param {string} token
 */
function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/**
 * Revoke the current auth token (for sign-out / re-auth).
 */
async function revokeAuthToken() {
  try {
    const token = await getAuthToken(false);
    if (token) await removeCachedToken(token);
  } catch (e) {
    // Ignore errors — best-effort cleanup
  }
}

/**
 * Run a Drive operation with a token, transparently recovering from an
 * expired/invalid token (HTTP 401) by clearing the cached token and retrying once.
 * @param {boolean} interactive - Whether the token fetch may prompt the user.
 * @param {(token: string) => Promise<any>} fn
 */
async function withAuthRetry(interactive, fn) {
  let token = await getAuthToken(interactive);
  try {
    return await fn(token);
  } catch (err) {
    if (err && err.status === 401) {
      await removeCachedToken(token);
      token = await getAuthToken(interactive);
      return await fn(token);
    }
    throw err;
  }
}

/**
 * fetch() wrapper that tags 401 responses so withAuthRetry can refresh the token.
 */
async function driveFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const err = new Error('Google Drive authentication expired.');
    err.status = 401;
    throw err;
  }
  return res;
}

/**
 * Build the full backup payload from extension storage.
 */
async function buildBackupPayload() {
  const state = await getState();
  return {
    backupType: 'gdrive',
    exportedAt: new Date().toISOString(),
    version: api.runtime.getManifest().version,
    collections: state.collections,
    sessionHistory: (state.sessionHistory || []).slice(0, 50),
    settings: {
      autoSaveCollectionId: state.autoSaveCollectionId,
      ramSaverEnabled: state.ramSaverEnabled,
      enforceMaxPinnedTabs: state.enforceMaxPinnedTabs,
      maxPinnedTabs: state.maxPinnedTabs,
      enforceMaxPinnedCollections: state.enforceMaxPinnedCollections,
      maxPinnedCollections: state.maxPinnedCollections,
      sessionHistoryLimit: 100
    }
  };
}

/**
 * Search for an existing backup file in appDataFolder.
 * @param {string} token - OAuth2 access token.
 * @returns {Promise<object|null>} The file metadata if found, null otherwise.
 */
async function findExistingBackup(token) {
  const searchUrl = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${GDRIVE_BACKUP_FILENAME}'&fields=files(id,name,modifiedTime)`;
  const res = await driveFetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Drive search failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Upload the backup payload to Drive.
 * Creates a new file with a multipart/related body, or updates the existing
 * one with a simple media upload.
 * @param {string} token
 * @param {string} fileContent
 * @param {object|null} existingFile
 */
async function uploadBackupFile(token, fileContent, existingFile) {
  let endpoint;
  let method;
  let headers = { Authorization: `Bearer ${token}` };
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
      parents: ['appDataFolder']
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
    const errBody = await response.text();
    throw new Error(`Drive upload failed: ${response.status} - ${errBody}`);
  }
  return response.json();
}

/**
 * Backup all extension data to Google Drive appDataFolder.
 * If a backup already exists, updates it (PATCH). Otherwise creates a new one (POST).
 * @returns {Promise<{success: boolean, action: string, timestamp: string}>}
 */
async function backupToGDrive() {
  const payload = await buildBackupPayload();
  const fileContent = JSON.stringify(payload, null, 2);

  const result = await withAuthRetry(true, async (token) => {
    const existingFile = await findExistingBackup(token);
    const uploaded = await uploadBackupFile(token, fileContent, existingFile);
    return { uploaded, action: existingFile ? 'updated' : 'created' };
  });

  const timestamp = new Date().toISOString();
  await api.storage.local.set({
    lastGDriveBackupTime: Date.now(),
    lastGDriveBackupTimestamp: timestamp
  });

  console.log(`GDrive backup ${result.action}: ${result.uploaded.id}`);
  return {
    success: true,
    action: result.action,
    timestamp,
    fileId: result.uploaded.id
  };
}

/**
 * Restore extension data from Google Drive backup.
 * Fetches the backup file and writes it into chrome.storage.local.
 * @returns {Promise<{success: boolean, timestamp: string, collectionsCount: number}>}
 */
async function restoreFromGDrive() {
  const restoredData = await withAuthRetry(true, async (token) => {
    // Find the backup file
    const existingFile = await findExistingBackup(token);
    if (!existingFile) {
      throw new Error('No backup file found on Google Drive.');
    }

    // Fetch file contents
    const contentRes = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!contentRes.ok) {
      throw new Error(`Failed to fetch backup: ${contentRes.status} ${contentRes.statusText}`);
    }

    const data = await contentRes.json();
    data.__modifiedTime = existingFile.modifiedTime;
    return data;
  });

  // Validate the restored data
  if (!restoredData.collections || !Array.isArray(restoredData.collections)) {
    throw new Error('Invalid backup format: missing collections array.');
  }

  // Apply through the serialized update queue so a concurrent auto-save cannot
  // overwrite the restored data, and so the live "Current Session" is preserved.
  await updateState(state => {
    // Restore settings (only the fields the backup actually contains)
    const settings = restoredData.settings || {};
    if (settings.autoSaveCollectionId !== undefined) state.autoSaveCollectionId = settings.autoSaveCollectionId;
    if (settings.ramSaverEnabled !== undefined) state.ramSaverEnabled = !!settings.ramSaverEnabled;
    if (settings.enforceMaxPinnedTabs !== undefined) state.enforceMaxPinnedTabs = !!settings.enforceMaxPinnedTabs;
    if (settings.maxPinnedTabs !== undefined) state.maxPinnedTabs = settings.maxPinnedTabs;
    if (settings.enforceMaxPinnedCollections !== undefined) state.enforceMaxPinnedCollections = !!settings.enforceMaxPinnedCollections;
    if (settings.maxPinnedCollections !== undefined) state.maxPinnedCollections = settings.maxPinnedCollections;

    if (Array.isArray(restoredData.sessionHistory)) state.sessionHistory = restoredData.sessionHistory;

    // Keep the live Current Session; drop any Current Session from the backup
    const liveSession = state.collections.find(c => c.id === CURRENT_SESSION_ID);
    let newCollections = restoredData.collections.filter(c => c.id !== CURRENT_SESSION_ID);
    if (liveSession) newCollections.unshift(liveSession);
    state.collections = newCollections;

    // The restored autoSaveCollectionId may point at a collection that does not
    // exist on this device — fall back to the live Current Session instead.
    const autoSaveExists = state.autoSaveCollectionId &&
      state.collections.some(c => c.id === state.autoSaveCollectionId);
    if (!autoSaveExists) {
      state.autoSaveCollectionId = liveSession ? CURRENT_SESSION_ID : null;
    }
  });

  await api.storage.local.set({ lastGDriveRestoreTime: Date.now() });

  const timestamp = restoredData.exportedAt || restoredData.__modifiedTime;
  console.log(`GDrive restore complete: ${restoredData.collections.length} collections from ${timestamp}`);
  return {
    success: true,
    timestamp,
    collectionsCount: restoredData.collections.length
  };
}

/**
 * Delete the backup file from Google Drive (for disconnect / cleanup).
 */
async function deleteGDriveBackup() {
  await withAuthRetry(true, async (token) => {
    const existingFile = await findExistingBackup(token);
    if (!existingFile) return;

    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${existingFile.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete backup: ${res.status}`);
    }
  });

  await api.storage.local.remove(['lastGDriveBackupTime', 'lastGDriveBackupTimestamp']);
  console.log('GDrive backup deleted');
  return { success: true };
}

/**
 * Auto-backup handler — called by the alarm.
 * Uses a silent (non-interactive) token to avoid popping up the auth dialog.
 */
async function gdriveAutoBackup() {
  const state = await api.storage.local.get([GDRIVE_BACKUP_KEY, GDRIVE_AUTO_BACKUP_KEY]);
  if (!state[GDRIVE_BACKUP_KEY] || !state[GDRIVE_AUTO_BACKUP_KEY]) {
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
      lastGDriveBackupTime: Date.now(),
      lastGDriveBackupTimestamp: timestamp
    });
    console.log('GDrive auto-backup completed successfully');
  } catch (err) {
    console.warn('GDrive auto-backup failed (will retry next cycle):', err.message);
    // Don't rethrow — alarm will reschedule automatically
  }
}

/**
 * Schedule or cancel the auto-backup alarm.
 * @param {boolean} enabled
 */
async function scheduleGDriveAutoBackup(enabled) {
  if (enabled) {
    // Backup once per day (1440 minutes)
    await api.alarms.create('gdrive_auto_backup', { periodInMinutes: 1440 });
    console.log('GDrive auto-backup alarm scheduled (daily)');
    // Also do an immediate backup on enable
    gdriveAutoBackup().catch(err => console.warn('Initial GDrive auto-backup failed:', err.message));
  } else {
    await api.alarms.clearAlarm('gdrive_auto_backup');
    console.log('GDrive auto-backup alarm cleared');
  }
}


