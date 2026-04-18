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
let startupTime = Date.now();

function triggerAutoSave() {
  // Prevent any auto-save for the first few seconds of extension startup
  // This allows Chrome to restore tabs without intermediate partial saves
  const STABILIZATION_PERIOD = 8000; // 8 seconds
  if (isRestoring || (Date.now() - startupTime < STABILIZATION_PERIOD)) {
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

  // Get all open tabs in all windows (including incognito if permitted)
  const tabs = await api.tabs.query({});
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
  
  // After installation/update, perform an initial auto‑save (but only if tabs exist)
  setTimeout(async () => {
    const tabs = await api.tabs.query({});
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
      isExpanded: true,
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
  
  // Wait for tabs to restore
  setTimeout(async () => {
    isRestoring = false; // Allow auto-saves now
    const tabs = await api.tabs.query({});
    const validTabs = tabs.filter(tab => validateUrl(tab.url));
    
    // Only save if we have valid tabs AND the Current Session is currently empty
    // OR if the current tabs look significantly more complete than what we have.
    const currentState = await getState();
    const currentSession = currentState.collections?.find(c => c.id === CURRENT_SESSION_ID);
    
    if (validTabs.length > 0 && (!currentSession || currentSession.tabs.length === 0)) {
      console.log('Startup: Saving restored tabs to Current Session');
      saveSession();
    } else {
      console.log('Startup restoration complete. Current session tabs preserved.');
    }
  }, 10000); // 10 seconds to allow for full restoration
});

// ==================== RESTORE FUNCTIONALITY ====================
// Expose restore functionality to popup
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'forceAutoSave') {
    saveSession();
    sendResponse({ success: true });
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