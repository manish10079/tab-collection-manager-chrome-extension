// Tab Collection Manager - Popup Logic
// State discipline: READ → CLONE → MODIFY → SAVE → RENDER, serialized by the React bundle's
// store queue. Every mutation in this file goes through updateState() (see STORAGE HELPERS).

/**
 * RAM Saver: Discards a tab ONLY after it has fully loaded.
 * Calling chrome.tabs.discard() immediately after chrome.tabs.create() causes
 * a race condition where the tab gets stuck in an infinite loading spinner.
 * This helper waits for status === 'complete' before discarding.
 * @param {number} tabId - The ID of the tab to discard.
 * @param {number} [timeoutMs=10000] - Max wait time before giving up.
 */
function discardWhenLoaded(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    // Safety timeout — discard anyway after timeoutMs to avoid memory leak if not active
    const timer = setTimeout(async () => {
      if (settled) return;
      cleanup();
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && !tab.active) {
          chrome.tabs.discard(tabId).catch(() => {});
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
      chrome.tabs.discard(tabId).catch(() => {});
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

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

//=============== Render Version Info from Manifest file & Theme =================
document.addEventListener('DOMContentLoaded', async () => {
    const appInfo = chrome.runtime.getManifest();
    document.getElementById('app-name').textContent = appInfo.name;
    document.getElementById('version').textContent = `v${appInfo.version}`;
    
    // Apply theme as early as possible
    try {
        const state = await getState();
        document.documentElement.setAttribute('data-theme', state.theme || 'dark');
    } catch (err) {
        console.warn('Failed to load theme state:', err);
    }
});

// ==================== SESSION HISTORY BRIDGE ====================
// The history and session-details dialogs are React-owned (src/features/dialogs); only the
// header button that opens them is still legacy markup, so the click is forwarded through the
// React handle published in src/app/legacy-handle.js.
document.addEventListener('DOMContentLoaded', () => {
  const historyBtn = document.getElementById('historyBtn');
  if (!historyBtn) return;
  historyBtn.addEventListener('click', () => {
    const handle = globalThis.__tcmReact;
    if (handle && typeof handle.openHistory === 'function') handle.openHistory();
  });
});

// =====================CONSTANTS=========================
const COLLECTION_SORT_ICONS = {
    custom: "fa-grip-vertical",
    lastModified: "fa-clock",
    nameAsc: "fa-sort-alpha-down",
    nameDesc: "fa-sort-alpha-up",
    dateCreated: "fa-calendar-plus",
    dateCreatedAsc: "fa-calendar-minus",
    tabCount: "fa-arrow-down-9-1",
    tabCountAsc: "fa-arrow-up-1-9"
};

const TAB_SORT_ICONS = {
    custom: "fa-grip-vertical",
    titleAsc: "fa-sort-alpha-down",
    titleDesc: "fa-sort-alpha-up",
    dateAddedNewest: "fa-calendar-plus",
    dateAddedOldest: "fa-calendar-minus"
};

// Default fallback limits (overridden by user settings stored in chrome.storage)
const DEFAULT_MAX_PINNED_COLLECTIONS = 3;
const DEFAULT_MAX_PINNED_TABS_PER_COLLECTION = 3;

// ==================== STORAGE HELPERS ====================
// The state layer lives in the React bundle's store since Phase 3: one serialized write queue
// for the whole storage contract, shared with the React list. popup.js is a classic script and
// cannot import it, so it calls `window.__tcmStore` (src/app/legacy-store.js). There is
// deliberately no second queue here — two queues over one key set is the race that used to lose
// a write when the panel and the list mutated in the same tick.

/**
 * The store bridge published by the React bundle. Missing means the page was opened without the
 * bundle (`dist/` is the loadable build — see README), so fail loudly rather than silently keep
 * a second, unsynchronised way to write state.
 */
function storeBridge() {
  const bridge = globalThis.__tcmStore;
  if (!bridge) {
    throw new Error('[state] React store bridge missing — run `npm run build` and load dist/.');
  }
  return bridge;
}

/**
 * Current state in the flat shape the legacy UI reads (settings at the root, as persisted).
 * The store's snapshot is already normalized, so these coercions only guard a wrongly typed
 * stored value.
 */
async function getState() {
  const bridge = storeBridge();
  if (!bridge.isReady()) await bridge.hydrate();
  const result = bridge.getLegacyState();
  return {
    collections: result.collections || [],
    autoSaveCollectionId: result.autoSaveCollectionId || null,
    lastSessionBackup: result.lastSessionBackup || null,
    ramSaverEnabled: !!result.ramSaverEnabled,
    collectionSortType: result.collectionSortType || 'custom',
    enforceMaxPinnedCollections: result.enforceMaxPinnedCollections !== false,
    enforceMaxPinnedTabs: result.enforceMaxPinnedTabs !== false,
    maxPinnedCollections: result.maxPinnedCollections ?? DEFAULT_MAX_PINNED_COLLECTIONS,
    maxPinnedTabs: result.maxPinnedTabs ?? DEFAULT_MAX_PINNED_TABS_PER_COLLECTION,
    layoutViewMode: result.layoutViewMode || 'list',
    theme: result.theme || 'dark'
  };
}

/**
 * State after taking a fresh look at storage. Only for reads that follow a write made outside
 * this context — the worker's auto-save, a Google Drive restore — where the snapshot can still
 * be a storage event behind.
 */
async function getFreshState() {
  await storeBridge().hydrate();
  return getState();
}

/**
 * Persist a change through the shared queue. Same contract as the old read → clone → modify →
 * save helper: the mutator edits a flat state object in place, and the fresh state comes back so
 * callers can refresh the legacy chrome from it.
 */
async function updateState(mutator) {
  return storeBridge().mutateLegacy(mutator);
}

// ==================== UTILITY FUNCTIONS ====================
const MAX_TABS_PER_COLLECTION = 200;
const MAX_COLLECTION_NAME_LENGTH = 100;
// Cross-browser compatibility wrapper (supports Chrome, Brave, Edge, Firefox)
const api = typeof browser !== 'undefined' ? browser : chrome;

const CURRENT_SESSION_ID = 'current-session';

function generateId() {
  return crypto.randomUUID();
}

// Toasts are React-owned since Phase 5: the queue is `src/app/providers/toastStore.js`, published
// on `window.__tcmReact.toast`. This stays as the one call site legacy code keeps using, so its
// 15 existing callers do not have to know the difference.
function showToast(message, duration = 3000) {
  const handle = globalThis.__tcmReact;
  if (handle && typeof handle.toast === 'function') {
    handle.toast(message, duration);
    return;
  }
  console.warn('[popup] toast bridge unavailable:', message);
}

function isNameUnique(name, collections, excludeId = null) {
  // Normalize Unicode (NFKC: Compatibility decomposition followed by canonical composition)
  // This handles cases like "café" vs "cafe\u0301" (decomposed)
  let normalized = name.normalize('NFKC');
  // Collapse multiple whitespace to single space and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();
  // Case-insensitive comparison (locale-insensitive)
  normalized = normalized.toLowerCase();
  
  return !collections.some(c => {
    if (c.id === excludeId) return false;
    let collName = c.name.normalize('NFKC');
    collName = collName.replace(/\s+/g, ' ').trim().toLowerCase();
    return collName === normalized;
  });
}

function getFaviconUrl(url) {
  if (!url) return 'icons/icon16.png';
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const extId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
        ? chrome.runtime.id
        : (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id)
          ? browser.runtime.id
          : '';
      if (extId) {
        return `chrome-extension://${extId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
      }
    }
  } catch (e) {
    // ignore
  }
  return 'icons/icon16.png';
}

function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}


function updateCollectionSortIcon(sortType) {
    const icon = document.getElementById('collectionSortIcon');

    if (!icon) return;

    icon.className =
        `fa-solid ${COLLECTION_SORT_ICONS[sortType] || 'fa-arrow-up-wide-short'}`;
}

// ==================== DOM ELEMENTS ====================
const elements = {
  newCollectionName: document.getElementById('newCollectionName'),
  createCollection: document.getElementById('createCollection'),
  collectionsContainer: document.getElementById('collectionsContainer'),
  searchBox: document.getElementById('searchBox'),
  toggleLayoutBtn: document.getElementById('toggleLayoutBtn')
};

// ==================== REACT LIST BRIDGE ====================
// The collections list and its tab rows are rendered by React (src/features/collections) from
// chrome.storage.local. Legacy call sites that used to toggle a card in the DOM ask the React
// store instead; `window.__tcmReact` is published in src/app/legacy-handle.js.
function setCollectionExpandedFromLegacy(collectionId, expanded) {
  const handle = globalThis.__tcmReact;
  if (handle && typeof handle.setCollectionExpanded === 'function') {
    handle.setCollectionExpanded(collectionId, expanded);
  }
}

// ==================== COLLECTION OPERATIONS ====================
async function createCollection(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  
  if (trimmed.length > MAX_COLLECTION_NAME_LENGTH) {
    alert(`Collection name cannot exceed ${MAX_COLLECTION_NAME_LENGTH} characters.`);
    return false;
  }

  const state = await getState();
  if (!isNameUnique(trimmed, state.collections)) {
    alert(`Collection name "${trimmed}" already exists (case‑insensitive).`);
    return false;
  }

  await updateState(state => {
    state.collections.push({
      id: generateId(),
      name: trimmed,
      tabs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false
    });
    state.collections = partitionCollections(state.collections);
  });

  return true;
}

async function deleteCollection(collectionId) {
  if (collectionId === CURRENT_SESSION_ID) {
    alert('The Current Session collection cannot be deleted.');
    return;
  }
  if (!confirm('Are you sure you want to remove this collection?')) return;

  const newState = await updateState(state => {
    state.collections = state.collections.filter(c => c.id !== collectionId);
    state.collections = partitionCollections(state.collections);
    if (state.autoSaveCollectionId === collectionId) {
      state.autoSaveCollectionId = null;
    }
  });
  syncLegacyChrome(newState);
}

async function renameCollection(collectionId, newName) {
  // Prevent renaming of Current Session collection
  if (collectionId === CURRENT_SESSION_ID) {
    alert('The Current Session collection cannot be renamed.');
    return false;
  }

  const trimmed = newName.trim();
  if (!trimmed) return false;
  
  if (trimmed.length > MAX_COLLECTION_NAME_LENGTH) {
    alert(`Collection name cannot exceed ${MAX_COLLECTION_NAME_LENGTH} characters.`);
    return false;
  }

  const state = await getState();
  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection) return false;

  // If the new name is identical to current name (case‑insensitive, trimmed), treat as success
  if (collection.name.trim().toLowerCase() === trimmed.toLowerCase()) {
    return true; // No change needed
  }

  if (!isNameUnique(trimmed, state.collections, collectionId)) {
    alert(`Collection name "${trimmed}" already exists.`);
    return false;
  }

  const newState = await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      collection.name = trimmed;
      collection.updatedAt = Date.now();
    }
    state.collections = partitionCollections(state.collections);
  });
  syncLegacyChrome(newState);
  return true;
}

async function exportAllCollections() {
  const state = await getState();
  if (!state.collections || state.collections.length === 0) {
    alert('No collections to export.');
    return;
  }
  
  // Include metadata with export date and time
  const exportData = {
    exportedAt: new Date().toISOString(),
    collections: state.collections
  };
  
  const dataStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `tab_collections_backup_${getFormattedDateTime()}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
  showToast('All collections exported successfully');
}

function importAllCollections() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const importedData = JSON.parse(event.target.result);
        let importedCollections = null;
        
        // Support both old format (array) and new format (object with collections array)
        if (Array.isArray(importedData)) {
          importedCollections = importedData;
        } else if (importedData && typeof importedData === 'object' && Array.isArray(importedData.collections)) {
          importedCollections = importedData.collections;
        } else {
          alert('Invalid format. File must contain an array of collections or a collections backup object.');
          return;
        }

        const validCollections = importedCollections.filter(c => c && typeof c === 'object' && c.name && Array.isArray(c.tabs));
        if (validCollections.length === 0) {
          alert('No valid collections found in the file.');
          return;
        }

        let addedCount = 0;
        let mergedCount = 0;

        await updateState(state => {
          validCollections.forEach(imported => {
            if (imported.id === CURRENT_SESSION_ID) return;

            // Find if a collection with the same name already exists
            const existing = state.collections.find(c => c.name.toLowerCase() === imported.name.toLowerCase());
            if (existing) {
              // Merge tabs into existing collection
              let tabAddedCount = 0;
              let currentPinnedTabsCount = existing.tabs.filter(t => t.pinned).length;
              imported.tabs.forEach(tab => {
                if (!tab.url) return;
                const existsInTarget = existing.tabs.some(t => t.url.trim().toLowerCase().replace(/\/+$/, '') === tab.url.trim().toLowerCase().replace(/\/+$/, ''));
                if (!existsInTarget && existing.tabs.length < MAX_TABS_PER_COLLECTION) {
                  let isPinned = !!tab.pinned;
                  if (isPinned) {
                    if (currentPinnedTabsCount < state.maxPinnedTabs) {
                      currentPinnedTabsCount++;
                    } else {
                      isPinned = false;
                    }
                  }
                  existing.tabs.push({
                    id: generateId(),
                    title: tab.title || 'Untitled',
                    url: tab.url,
                    pinned: isPinned,
                    index: existing.tabs.length,
                    windowId: 0,
                    active: false,
                    discarded: false,
                    highlighted: false,
                    addedAt: tab.addedAt || Date.now()
                  });
                  tabAddedCount++;
                }
              });
              existing.tabs = partitionTabs(existing.tabs);
              if (tabAddedCount > 0) {
                existing.updatedAt = Date.now();
                mergedCount++;
              }
            } else {
              // Add as a new collection
              let isPinned = !!imported.pinned;
              if (isPinned) {
                const currentPinnedCount = state.collections.filter(c => c.pinned).length;
                if (currentPinnedCount < state.maxPinnedCollections) {
                  // Keep isPinned true
                } else {
                  isPinned = false;
                }
              }

              let currentPinnedTabsCount = 0;
              const mappedTabs = imported.tabs.filter(t => t.url).map(t => {
                let isTabPinned = !!t.pinned;
                if (isTabPinned) {
                  if (currentPinnedTabsCount < state.maxPinnedTabs) {
                    currentPinnedTabsCount++;
                  } else {
                    isTabPinned = false;
                  }
                }
                return {
                  id: generateId(),
                  title: t.title || 'Untitled',
                  url: t.url,
                  pinned: isTabPinned,
                  index: 0,
                  windowId: 0,
                  active: false,
                  discarded: false,
                  highlighted: false,
                  addedAt: t.addedAt || Date.now()
                };
              });

              state.collections.push({
                id: generateId(),
                name: imported.name,
                pinned: isPinned,
                tabs: partitionTabs(mappedTabs).slice(0, MAX_TABS_PER_COLLECTION),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isExpanded: false
              });
              addedCount++;
            }
          });
          state.collections = partitionCollections(state.collections);
        });

        const newState = await getState();
        syncLegacyChrome(newState);
        showToast(`Import completed: Created ${addedCount} and merged ${mergedCount} collections.`);
      } catch (err) {
        console.error('Error importing collections:', err);
        alert('Failed to parse file. Make sure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}


function exportCollection(collection) {
  if (!collection || !collection.tabs || collection.tabs.length === 0) {
    alert('No tabs to export in this collection.');
    return;
  }
  
  // Include metadata with export date and time
  const exportData = {
    collectionId: collection.id,
    collectionName: collection.name,
    exportedAt: new Date().toISOString(),
    tabs: collection.tabs
  };
  
  const dataStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `${collection.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_tabs_${getFormattedDateTime()}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
  showToast('Collection exported successfully');
}

// ==================== TAB OPERATIONS ====================
async function openAllTabsInCollection(collectionId) {
  // Use the background script's restore functionality for better window/tab management
  try {
    const response = await api.runtime.sendMessage({
      command: 'restoreSession',
      collectionId
    });
    
    showToast('All tabs opened in background');
    
    if (!response || !response.success) {
      // Fallback to simple tab opening if restore fails
      console.warn('Restore failed, falling back to simple tab opening');
      await openAllTabsSimple(collectionId);
    }
  } catch (error) {
    console.error('Error restoring session:', error);
    // Fallback to simple tab opening
    await openAllTabsSimple(collectionId);
  }
}

async function openAllTabsSimple(collectionId) {
  const state = await getState();
  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection) return;

  // Open each tab in the collection (simple fallback).
  // createdTabs stays index-aligned with collection.tabs so tab groups can be rebuilt.
  const createdTabs = [];
  for (let i = 0; i < collection.tabs.length; i++) {
    const tab = collection.tabs[i];
    let url = tab.url;
    if (!url) { createdTabs[i] = null; continue; }
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      const createdTab = await api.tabs.create({ url, active: false });
      createdTabs[i] = createdTab;
      // RAM Saver: wait for tab to finish loading before discarding to avoid infinite spinner
      if (state.ramSaverEnabled && createdTab && createdTab.id) {
        discardWhenLoaded(createdTab.id);
      }
    } catch (err) {
      console.error('Failed to open tab:', url, err);
      createdTabs[i] = null;
    }
  }

  // Rebuild any Chrome tab groups this collection was saved with.
  await restoreTabGroups(collection, createdTabs, undefined);
}

async function removeTab(collectionId, tabId) {
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      collection.tabs = collection.tabs.filter(t => t.id !== tabId);
      collection.tabs = partitionTabs(collection.tabs);
      collection.updatedAt = Date.now();
    }
  });
}

async function updateTabTitle(collectionId, tabId, newTitle) {
  const trimmed = newTitle.trim() || 'Untitled';
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const tab = collection.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = trimmed;
        collection.updatedAt = Date.now();
      }
    }
  });
}

// ==================== AUTO‑SAVE CONFIG ====================
function partitionCollections(collections) {
  const currentSession = collections.filter(c => c.id === CURRENT_SESSION_ID);
  const pinned = collections.filter(c => c.pinned && c.id !== CURRENT_SESSION_ID);
  const unpinned = collections.filter(c => !c.pinned && c.id !== CURRENT_SESSION_ID);
  return [...currentSession, ...pinned, ...unpinned];
}

function partitionTabs(tabs) {
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);
  return [...pinned, ...unpinned];
}

// ==================== PIN OPERATIONS ====================
async function togglePinCollection(collectionId) {
  if (collectionId === CURRENT_SESSION_ID) return;

  let limitReached = false;
  const newState = await updateState(state => {
    if (!state.enforceMaxPinnedCollections) {
      // Limit enforcement disabled — pin freely
    }
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const isPinned = !collection.pinned;
      if (isPinned && state.enforceMaxPinnedCollections) {
        const currentPinnedCount = state.collections.filter(c => c.pinned && c.id !== CURRENT_SESSION_ID).length;
        if (currentPinnedCount >= state.maxPinnedCollections) {
          limitReached = true;
          return;
        }
      }
      collection.pinned = isPinned;
      collection.updatedAt = Date.now();
      state.collections = partitionCollections(state.collections);
    }
  });

  if (limitReached) {
    const lim = await getState().then(s => s.maxPinnedCollections);
    alert(`Maximum of ${lim} pinned collections reached. Raise the limit or disable it in Settings.`);
    return;
  }

  syncLegacyChrome(newState);
}

async function togglePinTab(collectionId, tabId) {
  if (collectionId === CURRENT_SESSION_ID) return;
  let limitReached = false;
  const newState = await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const tab = collection.tabs.find(t => t.id === tabId);
      if (tab) {
        const isPinned = !tab.pinned;
        if (isPinned && state.enforceMaxPinnedTabs) {
          const currentPinnedCount = collection.tabs.filter(t => t.pinned).length;
          if (currentPinnedCount >= state.maxPinnedTabs) {
            limitReached = true;
            return;
          }
        }
        tab.pinned = isPinned;
        collection.updatedAt = Date.now();
        collection.tabs = partitionTabs(collection.tabs);
      }
    }
  });

  if (limitReached) {
    const lim = await getState().then(s => s.maxPinnedTabs);
    alert(`Maximum of ${lim} pinned tabs per collection reached. Raise the limit or disable it in Settings.`);
    return;
  }

  syncLegacyChrome(newState);
}

// ==================== UI RENDERING ====================
/**
 * Refresh the shell chrome that React does not own yet: the collections sort menu highlight,
 * the layout icon toggle and the restore-backup button.
 *
 * Every caller that used to repaint the collection list now just calls this, because the list
 * renders itself from the store — any write lands in chrome.storage.local and the React store
 * re-renders from there (react-migration-plan.md §8, Phase 2).
 *
 * @param {object} state Result of getState()
 */
function syncLegacyChrome(state) {
  const { collectionSortType, layoutViewMode } = state;

  updateLayoutIcon(layoutViewMode === 'grid');

  // Highlight the active option in the collections sort menu
  const colSortType = collectionSortType || 'custom';
  const sortMenu = document.getElementById('collectionsSortMenu');
  if (sortMenu) {
    sortMenu.querySelectorAll('.sort-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === colSortType);
    });
  }

  renderBackupButton(state.lastSessionBackup);
}

function renderBackupButton(backup) {
  const btn = document.getElementById('restoreBackupBtn');
  if (!btn) return;

  if (!backup || !backup.tabs || backup.tabs.length === 0) {
    btn.classList.add('hidden');
    return;
  }

  // Show the restore icon button
  btn.classList.remove('hidden');

  // Set the title dynamically with tab count info
  const tabWord = backup.tabs.length === 1 ? 'tab' : 'tabs';
  btn.title = `Restore Previous Session\n${backup.tabs.length} ${tabWord} — "${backup.name || 'Unknown'}"`;

  // Swap listener to avoid duplicates
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async () => {
    if (confirm(`Restore ${backup.tabs.length} tabs from backup?`)) {
      await api.runtime.sendMessage({
        command: 'restoreSession',
        collectionId: backup.collectionId,
        backupData: backup
      });
      alert('Restoring session...');
    }
  });
}

// The settings modal is React-owned since Phase 4: src/features/settings renders it from the
// store, the header button below asks React to open it, and this file's own setUpSettingsModal
// (with its GDrive status loader, six settings writes and GDrive actions) went away with it.

// ==================== SEARCH / FILTER ====================
let searchDebounceTimer = null;

/**
 * Global search — shows results in two sections:
 *   Collections : collections whose name matches the query
 *   Tabs        : collections that have matching tab titles / URLs
 *
 * When the query is empty the normal collections list is restored.
 */
async function filterResults(query) {
  const q = (query || '').trim().toLowerCase();
  const container   = elements.collectionsContainer;
  const resultsBox  = document.getElementById('searchResultsContainer');

  // ── Empty query → restore normal view ─────────────────────────────────────
  if (!q) {
    container.style.display  = '';
    if (resultsBox) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; }
    return;
  }

  // ── Fetch full state so we can search collapsed (un‑rendered) tabs too ────
  const state = await getState();

  // Collections matching by name
  const nameMatches = state.collections.filter(c =>
    c.name.toLowerCase().includes(q)
  );

  // Collections with at least one tab matching title or URL
  const tabMatchGroups = [];
  state.collections.forEach(collection => {
    const hits = (collection.tabs || []).filter(tab =>
      (tab.title || '').toLowerCase().includes(q) ||
      (tab.url   || '').toLowerCase().includes(q)
    );
    if (hits.length > 0) tabMatchGroups.push({ collection, hits });
  });

  // ── Hide normal list; surface the results container ───────────────────────
  container.style.display = 'none';
  if (!resultsBox) return;
  resultsBox.style.display = 'block';

  const totalTabHits  = tabMatchGroups.reduce((s, g) => s + g.hits.length, 0);
  const hasAnyResult  = nameMatches.length > 0 || tabMatchGroups.length > 0;

  if (!hasAnyResult) {
    resultsBox.innerHTML = `
      <div class="search-no-results">
        <i class="fas fa-search"></i>
        No collections or tabs match <strong>"${escapeHtml(q)}"</strong>
      </div>`;
    return;
  }

  // ── Build HTML ─────────────────────────────────────────────────────────────
  let html = '';

  // — Section 1 : Collections ————————————————————————————————————————————————
  if (nameMatches.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-header">
          <span class="search-section-title">
            <i class="fas fa-folder"></i> Collections
          </span>
          <span class="search-section-count">${nameMatches.length}</span>
        </div>
        <div class="search-section-body">
          ${nameMatches.map(c => `
            <div class="search-collection-result" data-id="${c.id}">
              <div class="search-result-left">
                <i class="fas fa-folder-open search-result-icon"></i>
                <div class="search-result-info">
                  <span class="search-result-name">${highlightMatch(c.name, q)}</span>
                  <span class="search-result-meta">
                    ${c.tabs.length} tab${c.tabs.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <i class="fas fa-chevron-right search-result-arrow"></i>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // — Section 2 : Tabs ————————————————————————————————————————————————————————
  if (tabMatchGroups.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-header">
          <span class="search-section-title">
            <i class="fas fa-link"></i> Tabs
          </span>
          <span class="search-section-count">${totalTabHits}</span>
        </div>
        <div class="search-section-body">
          ${tabMatchGroups.map(({ collection, hits }) => `
            <div class="search-tab-group">
              <div class="search-tab-group-label">
                <i class="fas fa-folder"></i> ${escapeHtml(collection.name)}
              </div>
              ${hits.map(tab => `
                <div class="search-tab-result">
                  <div class="search-tab-favicon-container">
                    <img class="search-tab-favicon" src="${getFaviconUrl(tab.url)}" alt="" onerror="this.src='icons/icon16.png';">
                  </div>
                  <div class="search-tab-result-body">
                    <div class="search-tab-result-title">
                      ${highlightMatch(tab.title || 'Untitled', q)}
                    </div>
                    <div class="search-tab-result-url">
                      ${highlightMatch(
                        tab.url.length > 62 ? tab.url.slice(0, 62) + '…' : tab.url, q
                      )}
                    </div>
                  </div>
                  <button class="icon-btn search-open-tab-btn"
                          title="Open tab"
                          data-url="${escapeHtml(tab.url)}">
                    <i class="fas fa-external-link-alt"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  resultsBox.innerHTML = html;

  // ── Event listeners ────────────────────────────────────────────────────────

  // Collection card → clear search, scroll to & expand the collection
  resultsBox.querySelectorAll('.search-collection-result').forEach(el => {
    el.addEventListener('click', () => {
      const collId = el.dataset.id;
      elements.searchBox.value = '';
      filterResults('');
      setTimeout(() => {
        const collEl = document.querySelector(`.collection[data-id="${collId}"]`);
        if (!collEl) return;
        collEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const tabs = collEl.querySelector('.collection-tabs');
        if (tabs && !tabs.classList.contains('expanded')) {
          setCollectionExpandedFromLegacy(collId, true);
        }
      }, 60);
    });
  });

  // Tab open button → respects RAM Saver
  resultsBox.querySelectorAll('.search-open-tab-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      let url = btn.dataset.url;
      if (!url) return;
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
      try {
        const created = await api.tabs.create({ url, active: false });
        const st = await getState();
        if (st.ramSaverEnabled && created && created.id) {
          discardWhenLoaded(created.id);
          showToast('Tab opened (RAM Saver — loads on click)');
        } else {
          showToast('Tab opened in background');
        }
      } catch (err) {
        console.error('Failed to open tab:', url, err);
      }
    });
  });
}

/** Escape HTML to prevent XSS when injecting user data via innerHTML */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

/** Wrap query matches in <mark class="search-hl"> for inline highlighting */
function highlightMatch(text, query) {
  if (!query || !text) return escapeHtml(text || '');
  const safe    = escapeHtml(text);
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(
    new RegExp(pattern, 'gi'),
    m => `<mark class="search-hl">${m}</mark>`
  );
}

function updateLayoutIcon(isGrid) {
  const btn = elements.toggleLayoutBtn;
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (!icon) return;
  if (isGrid) {
    icon.className = 'fas fa-list';
    btn.title = 'Switch to List View';
  } else {
    icon.className = 'fas fa-th-large';
    btn.title = 'Switch to Grid View';
  }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  const actionsBarDefault = document.getElementById('actionsBarDefault');
  const searchSlideContainer = document.getElementById('searchSlideContainer');
  const createSlideContainer = document.getElementById('createSlideContainer');
  const toggleSearchBtn = document.getElementById('toggleSearchBtn');
  const toggleCreateBtn = document.getElementById('toggleCreateBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const cancelCreateBtn = document.getElementById('cancelCreateBtn');

  // Search toggle and search events
  if (elements.searchBox && toggleSearchBtn && searchSlideContainer && actionsBarDefault) {
    toggleSearchBtn.addEventListener('click', () => {
      actionsBarDefault.classList.add('hidden');
      createSlideContainer.classList.add('hidden');
      searchSlideContainer.classList.remove('hidden');
      elements.searchBox.focus();
    });

    clearSearchBtn.addEventListener('click', () => {
      elements.searchBox.value = '';
      filterResults('');
      searchSlideContainer.classList.add('hidden');
      actionsBarDefault.classList.remove('hidden');
    });

    elements.searchBox.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        filterResults(elements.searchBox.value);
      }, 150);
    });

    elements.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.searchBox.value = '';
        filterResults('');
        searchSlideContainer.classList.add('hidden');
        actionsBarDefault.classList.remove('hidden');
        elements.searchBox.blur();
      }
    });
  }

  // Create toggle events
  if (toggleCreateBtn && createSlideContainer && actionsBarDefault) {
    toggleCreateBtn.addEventListener('click', () => {
      actionsBarDefault.classList.add('hidden');
      searchSlideContainer.classList.add('hidden');
      createSlideContainer.classList.remove('hidden');
      elements.newCollectionName.focus();
    });

    cancelCreateBtn.addEventListener('click', () => {
      elements.newCollectionName.value = '';
      createSlideContainer.classList.add('hidden');
      actionsBarDefault.classList.remove('hidden');
    });
  }

  // Global Import and Export buttons
  const globalImportBtn = document.getElementById('globalImportBtn');
  const globalExportBtn = document.getElementById('globalExportBtn');
  if (globalImportBtn) {
    globalImportBtn.addEventListener('click', importAllCollections);
  }
  if (globalExportBtn) {
    globalExportBtn.addEventListener('click', exportAllCollections);
  }

  // Layout toggle event listener
  if (elements.toggleLayoutBtn) {
    elements.toggleLayoutBtn.addEventListener('click', async () => {
      const state = await getState();
      const newLayout = state.layoutViewMode === 'grid' ? 'list' : 'grid';
      
      // Update state in storage
      await updateState(s => {
        s.layoutViewMode = newLayout;
      });

      // The React list applies the grid/list classes from the store; only the icon is legacy.
      updateLayoutIcon(newLayout === 'grid');
    });
  }

  // Collection sort button toggle inside backup banner
  const sortColBtn = document.querySelector('.sort-collections-btn');
  const sortColMenu = document.getElementById('collectionsSortMenu');
  if (sortColBtn && sortColMenu) {
    sortColBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sortColMenu.classList.toggle('hidden');
    });

    sortColMenu.addEventListener('click', async (e) => {
      const option = e.target.closest('.sort-option');
      if (option) {
        const value = option.dataset.value;
        updateCollectionSortIcon(value);
        await updateState(state => {
          state.collectionSortType = value;
        });
        const state = await getState();
        syncLegacyChrome(state);
        sortColMenu.classList.add('hidden');
      }
    });
  }

  // Close the collections sort dropdown on click outside. The per-collection and per-tab menus
  // now belong to the React cards, which close themselves — never touch their DOM from here.
  document.addEventListener('click', (e) => {
    const sortColMenu = document.getElementById('collectionsSortMenu');
    if (sortColMenu && !sortColMenu.classList.contains('hidden') && !sortColMenu.parentNode.contains(e.target)) {
      sortColMenu.classList.add('hidden');
    }
  });

  // Create collection
  elements.createCollection.addEventListener('click', async () => {
    const name = elements.newCollectionName.value;
    if (await createCollection(name)) {
      elements.newCollectionName.value = '';
      if (createSlideContainer) {
        createSlideContainer.classList.add('hidden');
        actionsBarDefault.classList.remove('hidden');
      }
      const state = await getState();
      syncLegacyChrome(state);
    }
  });

  elements.newCollectionName.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const name = elements.newCollectionName.value;
      if (await createCollection(name)) {
        elements.newCollectionName.value = '';
        if (createSlideContainer) {
          createSlideContainer.classList.add('hidden');
          actionsBarDefault.classList.remove('hidden');
        }
        const state = await getState();
        syncLegacyChrome(state);
      }
    }
  });

  elements.newCollectionName.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      elements.newCollectionName.value = '';
      if (createSlideContainer) {
        createSlideContainer.classList.add('hidden');
        actionsBarDefault.classList.remove('hidden');
      }
      elements.newCollectionName.blur();
    }
  });

  // Settings modal (and its auto-save toggle) is React-owned since Phase 4 — ask React to open it.
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const handle = globalThis.__tcmReact;
      if (handle && typeof handle.openSettings === 'function') handle.openSettings();
    });
  }

  // Every dialog (add tabs, history, session details, duplicates, shortcuts help) is React-owned
  // and handles its own focus and Escape (src/components/Modal.jsx).

  // Listen for storage changes (e.g., when background.js auto-saves tabs)
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      // Check if collections or autoSaveCollectionId changed
      if (changes.collections || changes.autoSaveCollectionId) {
        console.log('Storage changed, refreshing UI');
        // Refresh the UI with updated state. `getFreshState` waits for the store to re-read
        // storage, because the snapshot is a storage event behind at this point.
        getFreshState().then(state => {
          syncLegacyChrome(state);
          // Re‑apply active search filter after the re‑render
          if (elements.searchBox && elements.searchBox.value.trim()) {
            filterResults(elements.searchBox.value);
          }
        });
      }
    }
  });
}

// ==================== INITIALIZATION ====================
async function init() {
  console.log('--- POPUP INIT ---');
  setupEventListeners();
  
  // Force an auto-save to ensure the Current Session is completely up-to-date
  try {
    await api.runtime.sendMessage({ command: 'forceAutoSave' });
  } catch (err) {
    console.warn('Failed to force auto-save on popup init:', err);
  }
  
  // Fresh read: the auto-save above is written by the worker, not by this context.
  const state = await getFreshState();
  updateCollectionSortIcon(
    state.collectionSortType || 'custom'
);
  
  // Debug logging
  console.log('Popup State:', {
    collectionsCount: state.collections?.length || 0,
    autoSaveCollectionId: state.autoSaveCollectionId,
    backupAvailable: !!(state.lastSessionBackup && state.lastSessionBackup.tabs?.length),
    backupTabCount: state.lastSessionBackup?.tabs?.length || 0,
    currentSessionExists: state.collections?.some(c => c.id === CURRENT_SESSION_ID) || false
  });
  
  const currentSession = state.collections?.find(c => c.id === CURRENT_SESSION_ID);
  if (currentSession) {
    console.log('=== POPUP: CURRENT SESSION TABS ===');
    currentSession.tabs.forEach((t, i) => {
      console.log(`  Saved Tab [${i}]: title="${t.title}", url="${t.url}"`);
    });
    console.log('===================================');
  }
  
  if (state.collections) {
    state.collections.forEach((c, i) => {
      console.log(`Collection [${i}] "${c.name}":`, {
        id: c.id,
        tabsCount: c.tabs?.length || 0,
        isExpanded: c.isExpanded,
        isCurrentSession: c.id === CURRENT_SESSION_ID
      });
    });
  }
  
  if (normalizeOpenedState(state)) {
    // Write the normalisation back through the shared queue, then refresh from its result.
    syncLegacyChrome(await updateState(draft => normalizeOpenedState(draft)));
  } else {
    syncLegacyChrome(state);
  }
}

/**
 * Normalise the state a panel open should not keep as-is: every collection collapsed, every
 * saved tab carrying an `addedAt`, and no auto‑save pointing at a collection that is gone.
 * Idempotent — returns whether anything changed, so the caller only writes when it has to.
 *
 * @param {object} state Flat state: a read copy, or the draft being written
 * @returns {boolean} Whether the state was changed
 */
function normalizeOpenedState(state) {
  let changed = false;

  // Collapse all collections by default whenever the popup is opened
  (state.collections || []).forEach(c => {
    if (c.isExpanded) {
      c.isExpanded = false;
      changed = true;
    }
  });

  // Migrate existing tabs to have addedAt if they don't have it
  (state.collections || []).forEach(c => {
    const collCreatedAt = c.createdAt || Date.now();
    if (c.tabs) {
      c.tabs.forEach((t, idx) => {
        if (!t.addedAt) {
          t.addedAt = collCreatedAt + (idx * 1000);
          changed = true;
        }
      });
    }
  });

  // Clean up any stale auto‑save collection IDs (safety check)
  if (state.autoSaveCollectionId) {
    const exists = (state.collections || []).some(c => c.id === state.autoSaveCollectionId);
    if (!exists) {
      console.warn(`Popup: Cleaning up stale auto‑save ID: ${state.autoSaveCollectionId}`);
      state.autoSaveCollectionId = null;
      changed = true;
    }
  }

  return changed;
}

// Start the extension
document.addEventListener('DOMContentLoaded', init);

// ==================== REACT UI ADAPTER ====================
// The collection list is React-owned since Phase 2 (react-migration-plan.md §8). React reaches
// the actions that still live here through `window.TCMLegacyUI`; src/app/legacy-ui.js is the
// only caller. Delete this whole section together with the rest of popup.js in Phase 5.

/**
 * Open a saved tab. `active: true` behaves like clicking the row (loads immediately); the
 * background variant honours RAM Saver, exactly like the old tab menu entry.
 */
async function openSavedTab(url, options = {}) {
  if (!url) return;
  const active = options.active !== false;
  const target = (url.startsWith('http://') || url.startsWith('https://')) ? url : 'https://' + url;

  try {
    const createdTab = await api.tabs.create({ url: target, active });
    if (active) return;

    const state = await getState();
    if (state.ramSaverEnabled && createdTab && createdTab.id) {
      discardWhenLoaded(createdTab.id);
      showToast('Tab opened (RAM Saver — loads on click)');
    } else {
      showToast('Tab opened in background');
    }
  } catch (err) {
    console.error('Failed to open tab:', target, err);
  }
}

window.TCMLegacyUI = {
  toggleCollectionPin: (collectionId) => togglePinCollection(collectionId),
  toggleTabPin: (collectionId, tabId) => togglePinTab(collectionId, tabId),
  renameCollection: (collectionId, name) => renameCollection(collectionId, name),
  deleteCollection: (collectionId) => deleteCollection(collectionId),
  removeTab: (collectionId, tabId) => removeTab(collectionId, tabId),
  renameTab: (collectionId, tabId, title) => updateTabTitle(collectionId, tabId, title),
  openSavedTab,
  openAllTabs: (collectionId) => openAllTabsInCollection(collectionId),
  exportCollection: (collection) => exportCollection(collection)
};

document.getElementById('closePanelBtn').addEventListener('click', () => {
  document.body.classList.add('panel-closing');
  setTimeout(() => {
    window.close();
  }, 220);
});

// ==================== GLOBAL KEYBOARD SHORTCUTS ====================
// Ctrl/Cmd + F       → toggle global search
// Ctrl/Cmd + N       → toggle new-collection input
// Ctrl/Cmd + E       → expand / collapse all collections
// Ctrl/Cmd + Shift+E → expand only the Current Session
// Ctrl/Cmd + D       → toggle list / grid layout
// 1-9                → jump to the Nth collection (Current Session = 1)
// ?                  → open keyboard shortcuts help
// Esc                → close topmost modal, slide, or dropdown
// x / X              → close the extension panel

function toggleGlobalSearch() {
  const actionsBarDefault = document.getElementById('actionsBarDefault');
  const searchSlideContainer = document.getElementById('searchSlideContainer');
  const createSlideContainer = document.getElementById('createSlideContainer');
  if (!searchSlideContainer || !actionsBarDefault || !elements.searchBox) return;

  const isOpen = !searchSlideContainer.classList.contains('hidden');
  if (isOpen) {
    // Close search
    elements.searchBox.value = '';
    filterResults('');
    searchSlideContainer.classList.add('hidden');
    actionsBarDefault.classList.remove('hidden');
    elements.searchBox.blur();
  } else {
    // Open search
    createSlideContainer.classList.add('hidden');
    searchSlideContainer.classList.remove('hidden');
    actionsBarDefault.classList.add('hidden');
    elements.searchBox.focus();
  }
}

function toggleCreateSlide() {
  const actionsBarDefault = document.getElementById('actionsBarDefault');
  const searchSlideContainer = document.getElementById('searchSlideContainer');
  const createSlideContainer = document.getElementById('createSlideContainer');
  if (!createSlideContainer || !actionsBarDefault || !elements.newCollectionName) return;

  const isOpen = !createSlideContainer.classList.contains('hidden');
  if (isOpen) {
    // Close create input
    elements.newCollectionName.value = '';
    createSlideContainer.classList.add('hidden');
    actionsBarDefault.classList.remove('hidden');
    elements.newCollectionName.blur();
  } else {
    // Open create input
    searchSlideContainer.classList.add('hidden');
    createSlideContainer.classList.remove('hidden');
    actionsBarDefault.classList.add('hidden');
    elements.newCollectionName.focus();
  }
}

async function toggleExpandAllCollections() {
  const state = await getState();
  const collections = state.collections || [];
  if (collections.length === 0) {
    showToast('No collections to expand');
    return;
  }

  const anyCollapsed = collections.some(c => !c.isExpanded);
  const expand = anyCollapsed; // If any are collapsed → expand all, otherwise collapse all
  const newState = await updateState(s => {
    s.collections.forEach(c => { c.isExpanded = expand; });
  });
  syncLegacyChrome(newState);
  showToast(expand ? 'All collections expanded' : 'All collections collapsed', 1500);
}

async function expandCurrentSessionOnly() {
  const state = await getState();
  const hasCurrentSession = (state.collections || []).some(c => c.id === CURRENT_SESSION_ID);
  if (!hasCurrentSession) {
    showToast('Current Session not found');
    return;
  }
  const newState = await updateState(s => {
    s.collections.forEach(c => {
      c.isExpanded = (c.id === CURRENT_SESSION_ID);
    });
  });
  syncLegacyChrome(newState);
  showToast('Current Session expanded', 1200);
}

function jumpToCollection(n) {
  const cards = Array.from(document.querySelectorAll('#collectionsContainer > .collection'));
  const target = cards[n - 1];
  if (!target) {
    showToast(`Collection ${n} not found`);
    return;
  }
  const targetId = target.dataset.id;
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Brief highlight so the user can see which collection was jumped to.
  // Re-query by data-id when removing so the highlight survives re-renders.
  target.classList.add('shortcut-jump-highlight');
  setTimeout(() => {
    const el = document.querySelector(`#collectionsContainer > .collection[data-id="${targetId}"]`);
    if (el) el.classList.remove('shortcut-jump-highlight');
  }, 1200);
}

/**
 * Whether any dialog is on screen. Every dialog is React-owned now, and a React modal exists in
 * the DOM only while it is open (it portals into `#tcm-modal-root`), so ask the DOM rather than a
 * list of ids. Used to keep the 1-9 jump shortcut and the Escape fallback from firing under a
 * dialog; the dialog itself closes via the Modal primitive's own Escape handling.
 */
function isAnyModalOpen() {
  return Array.from(document.querySelectorAll('.modal-overlay'))
    .some(overlay => getComputedStyle(overlay).display !== 'none');
}

function closeOpenSlides() {
  const actionsBarDefault = document.getElementById('actionsBarDefault');
  const searchSlideContainer = document.getElementById('searchSlideContainer');
  const createSlideContainer = document.getElementById('createSlideContainer');
  let closed = false;

  if (searchSlideContainer && elements.searchBox && !searchSlideContainer.classList.contains('hidden')) {
    elements.searchBox.value = '';
    filterResults('');
    searchSlideContainer.classList.add('hidden');
    if (actionsBarDefault) actionsBarDefault.classList.remove('hidden');
    closed = true;
  }
  if (createSlideContainer && elements.newCollectionName && !createSlideContainer.classList.contains('hidden')) {
    elements.newCollectionName.value = '';
    createSlideContainer.classList.add('hidden');
    if (actionsBarDefault) actionsBarDefault.classList.remove('hidden');
    closed = true;
  }
  return closed;
}

/** Escape closes the collections sort menu; the React cards close their own menus. */
function closeOpenDropdowns() {
  const sortColMenu = document.getElementById('collectionsSortMenu');
  if (!sortColMenu || sortColMenu.classList.contains('hidden')) return false;
  sortColMenu.classList.add('hidden');
  return true;
}

document.addEventListener('keydown', (e) => {
  const target = e.target;
  const isTyping = (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl/Cmd + F → toggle global search
  if (mod && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (e.repeat) return; // avoid toggling rapidly while held
    toggleGlobalSearch();
    return;
  }

  // Ctrl/Cmd + N → toggle new-collection input
  if (mod && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    if (e.repeat) return; // avoid toggling rapidly while held
    toggleCreateSlide();
    return;
  }

  // Ctrl/Cmd + Shift + E → expand only the Current Session
  if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    if (e.repeat) return; // avoid toggling rapidly while held
    expandCurrentSessionOnly();
    return;
  }

  // Ctrl/Cmd + E → expand / collapse all collections
  if (mod && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    if (e.repeat) return; // avoid toggling rapidly while held
    toggleExpandAllCollections();
    return;
  }

  // Ctrl/Cmd + D → toggle list / grid layout
  if (mod && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    if (e.repeat) return; // avoid toggling rapidly while held
    if (elements.toggleLayoutBtn) elements.toggleLayoutBtn.click();
    return;
  }

  // Esc → the React Modal primitive closes its own topmost dialog (it listens on document and
  // runs after this handler), so only the legacy slides and dropdowns are handled here.
  if (e.key === 'Escape') {
    if (isAnyModalOpen()) return;
    if (closeOpenSlides()) return;
    closeOpenDropdowns();
    return;
  }

  // Ignore plain keys while typing in a field
  if (isTyping) return;

  // ? → ask React to open the shortcuts help dialog
  if (!mod && e.key === '?') {
    const handle = globalThis.__tcmReact;
    if (handle && typeof handle.openShortcuts === 'function') handle.openShortcuts();
    return;
  }

  // 1-9 → jump to the Nth collection (skip while a modal is open)
  if (!mod && /^[1-9]$/.test(e.key)) {
    if (!isAnyModalOpen()) jumpToCollection(parseInt(e.key, 10));
    return;
  }

  // x → close the extension panel
  if (e.key === 'x' || e.key === 'X') {
    const closeBtn = document.getElementById('closePanelBtn');
    if (closeBtn) {
      closeBtn.click();
    }
  }
});