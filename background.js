// Background Service Worker - Auto‑Save Engine
// Handles Chrome tab events and auto‑save logic with debounce
// checking git is working or not
// ==================== STORAGE HELPERS ====================
async function getState() {
  const result = await api.storage.local.get(['collections', 'autoSaveCollectionId', 'lastSessionBackup']);
  return {
    collections: result.collections || [],
    autoSaveCollectionId: result.autoSaveCollectionId || null,
    lastSessionBackup: result.lastSessionBackup || null
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
    // Clear auto‑save ID since collection no longer exists
    console.warn(`Auto‑save collection ${autoSaveCollectionId} not found, disabling auto‑save`);
    await updateState(state => {
      state.autoSaveCollectionId = null;
    });
    return;
  }

  // Get open tabs in the last focused window
  const tabs = await api.tabs.query({ lastFocusedWindow: true });
  console.log(`[saveSession] Query returned ${tabs.length} tabs total.`);
  tabs.forEach((t, i) => console.log(`[saveSession] Raw Tab [${i}]: title="${t.title}", url="${t.url}"`));

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
      highlighted: tab.highlighted || false
    }));

  // Don't overwrite saved session with empty tabs (e.g., during browser startup)
  if (tabObjects.length === 0) {
    console.log('Auto‑save: No open tabs to save, preserving existing session');
    return;
  }

  // Group tabs by window for better organization
  const tabsByWindow = {};
  tabObjects.forEach(tab => {
    if (!tabsByWindow[tab.windowId]) {
      tabsByWindow[tab.windowId] = [];
    }
    tabsByWindow[tab.windowId].push(tab);
  });

  // Sort tabs within each window by index
  Object.values(tabsByWindow).forEach(windowTabs => {
    windowTabs.sort((a, b) => a.index - b.index);
  });

  // Flatten back to array (maintaining window grouping in storage)
  const sortedTabObjects = Object.values(tabsByWindow).flat();

  // Limit to MAX_TABS_PER_COLLECTION
  const limitedTabObjects = sortedTabObjects.slice(0, MAX_TABS_PER_COLLECTION);
  
  if (sortedTabObjects.length > MAX_TABS_PER_COLLECTION) {
    console.warn(`Auto‑save: Too many open tabs (${sortedTabObjects.length}), limiting to ${MAX_TABS_PER_COLLECTION}`);
  }

  await updateState(state => {
    const collection = state.collections.find(c => c.id === autoSaveCollectionId);
    if (collection) {
      // Guard Logic: Don't overwrite a high-count session with a low-count one
      // unless it's a very small delta or specifically allowed.
      // This protects against partial saves during crash recovery.
      const currentTabCount = collection.tabs ? collection.tabs.length : 0;
      const newTabCount = limitedTabObjects.length;
      
      // If we are losing more than 70% of tabs AND we had at least 5 tabs, skip saving
      // unless it's been more than 30 seconds since startup.
      if (currentTabCount > 5 && newTabCount < (currentTabCount * 0.3) && (Date.now() - startupTime < 30000)) {
        console.warn(`[GUARD] Refusing to overwrite ${currentTabCount} tabs with only ${newTabCount} tabs. Potential partial restoration detected.`);
        return;
      }

      // Create a backup of previous session before overwriting
      if (collection.tabs && collection.tabs.length > 0) {
        state.lastSessionBackup = {
          tabs: collection.tabs,
          timestamp: Date.now(),
          collectionId: autoSaveCollectionId,
          name: collection.name
        };
      }
      
      // Replace only the tabs, keep collection name and other properties
      collection.tabs = limitedTabObjects;
      collection.updatedAt = Date.now();
      collection.windowGroups = tabsByWindow; // Store window grouping info
    }
  });

  console.log(`Auto‑saved ${limitedTabObjects.length} tabs to collection ${autoSaveCollectionId}`);
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
      highlighted: false
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

// Rebuild context menus whenever collections change in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.collections) {
    buildContextMenus();
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
});

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
      }).catch(err => console.error(`Failed to create tab: ${url}`, err));
    });

    await Promise.all(tabPromises);
    console.log('Session restored successfully into current window');
  } catch (err) {
    console.error('Error during restoration into current window:', err);
    // Fallback: just open tabs
    for (const tab of collection.tabs) {
      api.tabs.create({ url: tab.url }).catch(() => {});
    }
  }
}