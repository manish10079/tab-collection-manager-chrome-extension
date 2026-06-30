// Tab Collection Manager - Popup Logic
// STRICT STATE MANAGEMENT: READ → CLONE → MODIFY → SAVE → RENDER

// ==================== STORAGE HELPERS ====================
async function getState() {
  const result = await api.storage.local.get(['collections', 'autoSaveCollectionId', 'lastSessionBackup', 'ramSaverEnabled', 'collectionSortType']);
  return {
    collections: result.collections || [],
    autoSaveCollectionId: result.autoSaveCollectionId || null,
    lastSessionBackup: result.lastSessionBackup || null,
    ramSaverEnabled: !!result.ramSaverEnabled,
    collectionSortType: result.collectionSortType || 'custom'
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
const MAX_COLLECTION_NAME_LENGTH = 100;
// Cross-browser compatibility wrapper (supports Chrome, Brave, Edge, Firefox)
const api = typeof browser !== 'undefined' ? browser : chrome;

const CURRENT_SESSION_ID = 'current-session';

function generateId() {
  return crypto.randomUUID();
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) container.removeChild(toast);
    }, 400);
  }, 3000);
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff >= 0) {
    // Past timestamp
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } else {
    // Future timestamp
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h`;
    return `in ${days}d`;
  }
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

function validateUrl(url) {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
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

/**
 * Check if a URL already exists in any collection.
 * Returns an array of { collectionName, collectionId } where the URL was found.
 */
function findDuplicateUrlsAcrossCollections(url, collections) {
  const normalizedUrl = url.trim().toLowerCase().replace(/\/+$/, '');
  const duplicates = [];

  for (const collection of collections) {
    // Exclude Current Session — it dynamically mirrors all open tabs,
    // so any URL currently open will always appear there. Including it
    // would produce a false-positive duplicate warning on every add.
    if (collection.id === CURRENT_SESSION_ID) continue;

    const found = collection.tabs.some(tab => {
      const tabUrl = tab.url.trim().toLowerCase().replace(/\/+$/, '');
      return tabUrl === normalizedUrl;
    });
    if (found) {
      duplicates.push({
        collectionId: collection.id,
        collectionName: collection.name
      });
    }
  }

  return duplicates;
}

/**
 * Show a styled confirmation dialog when a duplicate URL is detected.
 * Returns a Promise that resolves to true (add anyway) or false (cancel).
 */
function showDuplicateUrlConfirm(url, duplicates) {
  return new Promise(resolve => {
    const dialog = document.getElementById('duplicateUrlDialog');
    const messageEl = document.getElementById('duplicateUrlMessage');
    const listEl = document.getElementById('duplicateUrlList');
    const confirmBtn = document.getElementById('duplicateConfirmBtn');
    const cancelBtn = document.getElementById('duplicateCancelBtn');
    const closeBtn = document.getElementById('closeDuplicateDialog');

    // Truncate URL for display
    const displayUrl = url.length > 60 ? url.slice(0, 60) + '…' : url;

    messageEl.innerHTML = `This URL already exists in ${duplicates.length === 1 ? 'another collection' : 'other collections'}:<br><strong>${displayUrl}</strong>`;

    listEl.innerHTML = duplicates.map(d =>
      `<div class="duplicate-collection-item">
        <i class="fas fa-folder"></i>
        <span class="dup-collection-name" title="${d.collectionName}">${d.collectionName}</span>
      </div>`
    ).join('');

    // Cleanup function to remove listeners and hide dialog
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      dialog.style.display = 'none';
    }

    function onConfirm() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);

    dialog.style.display = 'flex';
  });
}

// ==================== DOM ELEMENTS ====================
const elements = {
  newCollectionName: document.getElementById('newCollectionName'),
  createCollection: document.getElementById('createCollection'),
  collectionsContainer: document.getElementById('collectionsContainer'),
  emptyState: document.getElementById('emptyState'),
  autoSaveToggle: document.getElementById('autoSaveToggle'),
  autoSaveCollectionSelect: document.getElementById('autoSaveCollectionSelect'),
  addTabsModal: document.getElementById('addTabsModal'),
  closeModal: document.getElementById('closeModal'),
  cancelModal: document.getElementById('cancelModal'),
  tabModeSelector: document.querySelector('.tab-mode-selector'),
  manualForm: document.getElementById('manualForm'),
  multiForm: document.getElementById('multiForm'),
  tabTitle: document.getElementById('tabTitle'),
  tabUrl: document.getElementById('tabUrl'),
  addManualTab: document.getElementById('addManualTab'),
  openTabsList: document.getElementById('openTabsList'),
  addSelectedTabs: document.getElementById('addSelectedTabs'),
  searchBox: document.getElementById('searchBox')
};

// ==================== STATE VARIABLES ====================
let currentCollectionId = null; // For modal context
let editingTabId = null; // Local UI state only
let draggedItem = null; // Drag and drop state

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
  });

  return true;
}

async function deleteCollection(collectionId) {
  if (collectionId === CURRENT_SESSION_ID) {
    alert('The Current Session collection cannot be deleted.');
    return;
  }
  if (!confirm('Delete this collection and all its tabs?')) return;

  const newState = await updateState(state => {
    state.collections = state.collections.filter(c => c.id !== collectionId);
    if (state.autoSaveCollectionId === collectionId) {
      state.autoSaveCollectionId = null;
    }
  });
  renderCollections(newState);
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
  });
  renderCollections(newState);
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

  if (api.downloads && api.downloads.download) {
    api.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      URL.revokeObjectURL(url);
      showToast('All collections exported successfully');
    });
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast('All collections exported successfully');
  }
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
              imported.tabs.forEach(tab => {
                if (!tab.url) return;
                const existsInTarget = existing.tabs.some(t => t.url.trim().toLowerCase().replace(/\/+$/, '') === tab.url.trim().toLowerCase().replace(/\/+$/, ''));
                if (!existsInTarget && existing.tabs.length < MAX_TABS_PER_COLLECTION) {
                  existing.tabs.push({
                    id: generateId(),
                    title: tab.title || 'Untitled',
                    url: tab.url,
                    pinned: !!tab.pinned,
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
              if (tabAddedCount > 0) {
                existing.updatedAt = Date.now();
                mergedCount++;
              }
            } else {
              // Add as a new collection
              state.collections.push({
                id: generateId(),
                name: imported.name,
                tabs: imported.tabs.filter(t => t.url).map(t => ({
                  id: generateId(),
                  title: t.title || 'Untitled',
                  url: t.url,
                  pinned: !!t.pinned,
                  index: 0,
                  windowId: 0,
                  active: false,
                  discarded: false,
                  highlighted: false,
                  addedAt: t.addedAt || Date.now()
                })).slice(0, MAX_TABS_PER_COLLECTION),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isExpanded: false
              });
              addedCount++;
            }
          });
        });

        const newState = await getState();
        renderCollections(newState);
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

  if (api.downloads && api.downloads.download) {
    api.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      URL.revokeObjectURL(url);
      showToast('Collection exported successfully');
    });
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast('Collection exported successfully');
  }
}

function importCollection(collectionId) {
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
        let tabs = null;
        
        // Support both old format (array) and new format (object with tabs array)
        if (Array.isArray(importedData)) {
          tabs = importedData;
        } else if (importedData && typeof importedData === 'object' && Array.isArray(importedData.tabs)) {
          tabs = importedData.tabs;
        } else {
          alert('Invalid file format. The file must contain an array of tabs or a tabs backup object.');
          return;
        }
        
        // Filter out invalid tabs
        const validTabs = tabs.filter(t => t && typeof t === 'object' && t.url);
        if (validTabs.length === 0) {
          alert('No valid tabs found in the imported file.');
          return;
        }

        // Add them to the collection
        await addTabsFromSelection(collectionId, validTabs);
        const state = await getState();
        renderCollections(state);
        showToast(`Imported ${validTabs.length} tabs successfully`);
      } catch (err) {
        console.error('Error importing tabs:', err);
        alert('Failed to parse file. Make sure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

async function toggleCollectionExpanded(collectionId) {
  // Find the already-rendered DOM elements so we can animate in-place.
  // We avoid calling renderCollections() here because it destroys+rebuilds
  // the entire DOM, which kills any in-progress CSS transition.
  const collectionEl = document.querySelector(`[data-id="${collectionId}"]`);
  if (!collectionEl) return;

  const tabsContainer = collectionEl.querySelector('.collection-tabs');
  const expandBtn     = collectionEl.querySelector('.expand-btn');
  if (!tabsContainer) return;

  // Capture intent from current DOM state BEFORE any async work
  const isExpanding = !tabsContainer.classList.contains('expanded');

  if (isExpanding) {
    // If tabs haven't been rendered into the list yet, populate them first.
    // The await below naturally yields to the browser, giving the CSS
    // transition a chance to start from the collapsed baseline.
    const tabsList = tabsContainer.querySelector('.tabs-list');
    if (tabsList && tabsList.children.length === 0) {
      const state = await getState();
      const collection = state.collections.find(c => c.id === collectionId);
      if (collection) renderTabs(collection, tabsList);
    }
    tabsContainer.classList.add('expanded');
    if (expandBtn) expandBtn.classList.add('rotated');
  } else {
    tabsContainer.classList.remove('expanded');
    if (expandBtn) expandBtn.classList.remove('rotated');
  }

  // Persist to storage using deterministic isExpanding flag
  // (avoids mismatch if storage and DOM ever diverge)
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) collection.isExpanded = isExpanding;
  });
}

// ==================== TAB OPERATIONS ====================
async function addManualTab(collectionId, title, url) {
  const trimmedTitle = title.trim() || 'Untitled';
  const trimmedUrl = url.trim();

  if (!validateUrl(trimmedUrl)) {
    alert('Please enter a valid URL (e.g., https://example.com)');
    return false;
  }

  // Check for duplicate URLs across all collections
  const currentState = await getState();
  const duplicates = findDuplicateUrlsAcrossCollections(trimmedUrl, currentState.collections);
  if (duplicates.length > 0) {
    const proceed = await showDuplicateUrlConfirm(trimmedUrl, duplicates);
    if (!proceed) return false;
  }

  let canAdd = true;
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      if (collection.tabs.length >= MAX_TABS_PER_COLLECTION) {
        canAdd = false;
        return;
      }
      collection.tabs.push({
        id: generateId(),
        title: trimmedTitle,
        url: trimmedUrl,
        pinned: false,
        index: collection.tabs.length, // Append at the end
        windowId: 0, // Default window
        active: false,
        discarded: false,
        highlighted: false,
        addedAt: Date.now()
      });
      collection.updatedAt = Date.now();
    }
  });

  if (!canAdd) {
    alert(`Cannot add more tabs. Maximum ${MAX_TABS_PER_COLLECTION} tabs per collection.`);
    return false;
  }

  return true;
}

async function addTabsFromSelection(collectionId, tabsArray) {
  if (!tabsArray.length) return;

  // Check for duplicate URLs across all collections
  const currentState = await getState();
  const duplicateTabs = [];
  const cleanTabs = [];

  for (const tab of tabsArray) {
    if (!validateUrl(tab.url)) continue;
    const duplicates = findDuplicateUrlsAcrossCollections(tab.url, currentState.collections);
    if (duplicates.length > 0) {
      duplicateTabs.push({ tab, duplicates });
    } else {
      cleanTabs.push(tab);
    }
  }

  // If there are duplicate tabs, ask user for confirmation
  let confirmedDupTabs = [];
  if (duplicateTabs.length > 0) {
    // Consolidate all duplicate info for the dialog
    // Show each duplicate tab and which collections it exists in
    const allDuplicateCollections = [];
    const seenCollections = new Set();
    for (const { tab, duplicates } of duplicateTabs) {
      for (const dup of duplicates) {
        const key = `${dup.collectionId}-${tab.url}`;
        if (!seenCollections.has(key)) {
          seenCollections.add(key);
          allDuplicateCollections.push(dup);
        }
      }
    }

    const displayUrl = duplicateTabs.length === 1
      ? duplicateTabs[0].tab.url
      : `${duplicateTabs.length} URLs`;

    const proceed = await showDuplicateUrlConfirm(displayUrl, allDuplicateCollections);
    if (proceed) {
      confirmedDupTabs = duplicateTabs.map(d => d.tab);
    }
  }

  const tabsToAdd = [...cleanTabs, ...confirmedDupTabs];
  if (tabsToAdd.length === 0) return;

  let addedCount = 0;
  let skippedDueToLimit = 0;
  let skippedDueToInvalidUrl = 0;

  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const availableSlots = MAX_TABS_PER_COLLECTION - collection.tabs.length;
      
      tabsToAdd.forEach(tab => {
        // Validate URL before adding
        if (!validateUrl(tab.url)) {
          skippedDueToInvalidUrl++;
          console.warn(`Skipping tab with invalid URL: ${tab.url}`);
          return;
        }
        
        if (collection.tabs.length >= MAX_TABS_PER_COLLECTION) {
          skippedDueToLimit++;
          return;
        }
        
        const trimmedTitle = (tab.title || '').trim() || 'Untitled';
        collection.tabs.push({
          id: generateId(),
          title: trimmedTitle,
          url: tab.url,
          pinned: false,
          index: collection.tabs.length, // Append at the end
          windowId: 0, // Default window
          active: false,
          discarded: false,
          highlighted: false,
          addedAt: tab.addedAt || Date.now()
        });
        addedCount++;
      });
      collection.updatedAt = Date.now();
    }
  });

  // Provide feedback to user
  if (skippedDueToLimit > 0) {
    alert(`Added ${addedCount} tabs. ${skippedDueToLimit} tabs skipped because collection cannot exceed ${MAX_TABS_PER_COLLECTION} tabs.`);
  }
  if (skippedDueToInvalidUrl > 0) {
    console.warn(`${skippedDueToInvalidUrl} tabs had invalid URLs and were skipped`);
  }
}

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

  // Open each tab in the collection (simple fallback)
  for (const tab of collection.tabs) {
    let url = tab.url;
    if (!url) continue;
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      const createdTab = await api.tabs.create({ url, active: false });
      // RAM Saver: discard tab immediately so it only loads when user clicks it
      if (state.ramSaverEnabled && createdTab && createdTab.id) {
        api.tabs.discard(createdTab.id).catch(err => {
          console.warn(`RAM Saver: Failed to discard tab ${createdTab.id}:`, err);
        });
      }
    } catch (err) {
      console.error('Failed to open tab:', url, err);
    }
  }
}

async function removeTab(collectionId, tabId) {
  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      collection.tabs = collection.tabs.filter(t => t.id !== tabId);
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
async function updateAutoSaveConfig(enabled) {
  await updateState(state => {
    if (enabled) {
      state.autoSaveCollectionId = CURRENT_SESSION_ID; // Always default to Current Session
    } else {
      state.autoSaveCollectionId = null;
    }
  });
}

// ==================== UI RENDERING ====================
function renderEmptyState(show) {
  elements.emptyState.classList.toggle('hidden', !show);
}

function renderCollections(state) {
  const { collections, autoSaveCollectionId, collectionSortType } = state;
  const container = elements.collectionsContainer;
  const fragment = document.createDocumentFragment();

  // Highlight active collection sort option in the collectionsSortMenu
  const colSortType = collectionSortType || 'custom';
  const sortMenu = document.getElementById('collectionsSortMenu');
  if (sortMenu) {
    sortMenu.querySelectorAll('.sort-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === colSortType);
    });
  }

  // Toggle sort-active class on collectionsContainer to hide drag handles when sorted
  container.classList.toggle('sort-active', colSortType !== 'custom');

  // Sort collections before rendering, keeping CURRENT_SESSION_ID always at the top
  let sortedCollections = [...collections];
  const currentSessionIdx = sortedCollections.findIndex(c => c.id === CURRENT_SESSION_ID);
  let currentSession = null;
  if (currentSessionIdx !== -1) {
    currentSession = sortedCollections.splice(currentSessionIdx, 1)[0];
  }

  if (colSortType === 'lastModified') {
    sortedCollections.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } else if (colSortType === 'nameAsc') {
    sortedCollections.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  } else if (colSortType === 'nameDesc') {
    sortedCollections.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' }));
  } else if (colSortType === 'dateCreated') {
    sortedCollections.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (colSortType === 'tabCount') {
    sortedCollections.sort((a, b) => (b.tabs?.length || 0) - (a.tabs?.length || 0));
  }

  if (currentSession) {
    sortedCollections.unshift(currentSession);
  }

  sortedCollections.forEach(collection => {
    const collectionEl = renderCollection(collection, autoSaveCollectionId);
    fragment.appendChild(collectionEl);
  });

  // Clear and append
  while (container.firstChild && container.firstChild.id !== 'emptyState') {
    container.removeChild(container.firstChild);
  }
  container.insertBefore(fragment, elements.emptyState);

  renderEmptyState(collections.length === 0);
  renderAutoSaveSelect(collections, autoSaveCollectionId);
  renderBackupButton(state.lastSessionBackup);
}

function renderBackupButton(backup) {
  const backupContainer = document.getElementById('backupContainer');
  if (!backupContainer) return;

  if (!backup || !backup.tabs || backup.tabs.length === 0) {
    backupContainer.classList.add('hidden');
    return;
  }

  backupContainer.classList.remove('hidden');
  const backupInfo = backupContainer.querySelector('.backup-info');
  const restoreBtn = document.getElementById('restoreBackupBtn');

  const date = new Date(backup.timestamp).toLocaleString();
  backupInfo.innerHTML = `
    <div class="backup-header">
      <i class="fas fa-history"></i>
      <span>Backup available from ${formatTime(backup.timestamp)}</span>
    </div>
    <div class="backup-meta">${backup.tabs.length} tabs from "${backup.name || 'Unknown'}"</div>
  `;

  // Remove old listener if exists
  const newRestoreBtn = restoreBtn.cloneNode(true);
  restoreBtn.parentNode.replaceChild(newRestoreBtn, restoreBtn);

  newRestoreBtn.addEventListener('click', async () => {
    if (confirm(`Restore ${backup.tabs.length} tabs from backup?`)) {
      await api.runtime.sendMessage({
        command: 'restoreSession',
        collectionId: backup.collectionId,
        backupData: backup // Pass backup data in case the collection was overwritten
      });
      alert('Restoring session...');
    }
  });
}

function renderCollection(collection, autoSaveCollectionId) {
  const template = document.getElementById('collectionTemplate');
  const clone = template.content.cloneNode(true);
  const collectionEl = clone.querySelector('.collection');
  collectionEl.dataset.id = collection.id;

  // Header elements
  const expandBtn = collectionEl.querySelector('.expand-btn');
  const expandIcon = expandBtn ? expandBtn.querySelector('i') : null;
  const nameInput = collectionEl.querySelector('.collection-name');
  const tabCount = collectionEl.querySelector('.tab-count');
  const updatedTime = collectionEl.querySelector('.updated-time');
  const openAllBtn = collectionEl.querySelector('.open-all-tabs-btn');
  const addTabsBtn = collectionEl.querySelector('.add-tabs-btn');
  const editBtn = collectionEl.querySelector('.edit-collection-btn');
  const deleteBtn = collectionEl.querySelector('.delete-collection-btn');
  const tabsContainer = collectionEl.querySelector('.collection-tabs');

  // Set values
  nameInput.value = collection.name;
  tabCount.textContent = `${collection.tabs.length} tab${collection.tabs.length !== 1 ? 's' : ''}`;
  updatedTime.textContent = formatTime(collection.updatedAt);

  // Special handling for Current Session collection
  if (collection.id === CURRENT_SESSION_ID) {
    deleteBtn.style.display = 'none';
    addTabsBtn.style.display = 'none';
    editBtn.style.display = 'none';
    nameInput.readOnly = true;
    nameInput.title = 'Current Session collection cannot be renamed or have tabs added';
    // Add a visual indicator
    collectionEl.classList.add('current-session-collection');
  }

  // Expanded state
  if (collection.isExpanded) {
    if (expandBtn) expandBtn.classList.add('rotated');
    tabsContainer.classList.add('expanded');
    renderTabs(collection, tabsContainer.querySelector('.tabs-list'));
  } else {
    tabsContainer.classList.remove('expanded');
  }

  // Per-collection tab search bar
  const tabSearchInput = collectionEl.querySelector('.collection-tab-search-input');
  if (tabSearchInput) {
    // Prevent header click-to-toggle when interacting with the search input
    tabSearchInput.addEventListener('click', (e) => e.stopPropagation());

    tabSearchInput.addEventListener('input', () => {
      // Debounce per collection
      clearTimeout(tabSearchDebounceTimers[collection.id]);
      tabSearchDebounceTimers[collection.id] = setTimeout(() => {
        filterTabsInCollection(collectionEl, tabSearchInput.value);
      }, 150);
    });

    tabSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        tabSearchInput.value = '';
        filterTabsInCollection(collectionEl, '');
        tabSearchInput.blur();
      }
    });
  }

  // Import / Export button listeners inside tab search row
  const importBtn = collectionEl.querySelector('.import-tabs-btn');
  const exportBtn = collectionEl.querySelector('.export-tabs-btn');

  if (importBtn) {
    importBtn.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    if (collection.id === CURRENT_SESSION_ID) {
      importBtn.style.display = 'none'; // Current Session is dynamic/readonly
    } else {
      importBtn.addEventListener('click', () => {
        importCollection(collection.id);
      });
    }
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportCollection(collection);
    });
  }

  // Tab sort button listeners inside the collection search row
  const sortTabsBtn = collectionEl.querySelector('.sort-tabs-btn');
  const sortTabsMenu = collectionEl.querySelector('.sort-dropdown-menu');

  if (sortTabsBtn && sortTabsMenu) {
    // Highlight the active tab sort option for this collection
    const activeSortType = collection.tabSortType || 'custom';
    sortTabsMenu.querySelectorAll('.sort-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === activeSortType);
    });

    sortTabsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close other dropdowns first
      document.querySelectorAll('.sort-dropdown-menu').forEach(menu => {
        if (menu !== sortTabsMenu) menu.classList.add('hidden');
      });
      sortTabsMenu.classList.toggle('hidden');
    });

    sortTabsMenu.addEventListener('click', async (e) => {
      const option = e.target.closest('.sort-option');
      if (option) {
        const value = option.dataset.value;
        await updateState(state => {
          const col = state.collections.find(c => c.id === collection.id);
          if (col) {
            col.tabSortType = value;
            col.updatedAt = Date.now();
          }
        });
        const state = await getState();
        renderCollections(state);
      }
    });
  }

  // Auto‑save indicator
  if (collection.id === autoSaveCollectionId) {
    collectionEl.classList.add('auto-save-target');
  }

  // Event listeners
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollectionExpanded(collection.id);
    });
  }
  
  // Also allow clicking header to toggle
  const header = collectionEl.querySelector('.collection-header');
  header.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT' && !e.target.closest('.collection-actions')) {
      toggleCollectionExpanded(collection.id);
    }
  });
  
  // Edit button toggle logic
  editBtn.addEventListener('click', () => {
    const isEditing = nameInput.readOnly === false;
    if (isEditing) {
      // Currently editing, save and switch back to edit icon
      nameInput.readOnly = true;
      editBtn.querySelector('i').className = 'fas fa-edit';
      editBtn.title = 'Edit collection name';
      // Trigger rename
      renameCollection(collection.id, nameInput.value);
    } else {
      // Start editing, switch to tick icon
      nameInput.readOnly = false;
      nameInput.focus();
      nameInput.select();
      editBtn.querySelector('i').className = 'fas fa-check';
      editBtn.title = 'Save collection name';
    }
  });
  
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.readOnly = true;
      editBtn.querySelector('i').className = 'fas fa-edit';
      editBtn.title = 'Edit collection name';
      renameCollection(collection.id, nameInput.value);
      nameInput.blur();
    } else if (e.key === 'Escape') {
      nameInput.value = collection.name; // Revert to original
      nameInput.readOnly = true;
      editBtn.querySelector('i').className = 'fas fa-edit';
      editBtn.title = 'Edit collection name';
      nameInput.blur();
    }
  });
  nameInput.addEventListener('change', (e) => renameCollection(collection.id, e.target.value));
  nameInput.addEventListener('blur', (e) => {
    // If we're editing and blur, save and switch back to edit icon
    if (nameInput.readOnly === false) {
      nameInput.readOnly = true;
      editBtn.querySelector('i').className = 'fas fa-edit';
      editBtn.title = 'Edit collection name';
      renameCollection(collection.id, e.target.value);
    }
  });
  openAllBtn.addEventListener('click', () => openAllTabsInCollection(collection.id));
  addTabsBtn.addEventListener('click', () => openAddTabsModal(collection.id));
  deleteBtn.addEventListener('click', () => deleteCollection(collection.id));

  // Drag and drop events for collections
  const dragHandle = collectionEl.querySelector('.collection-drag-handle');
  if (dragHandle) {
    dragHandle.addEventListener('mousedown', () => {
      collectionEl.setAttribute('draggable', 'true');
    });
    dragHandle.addEventListener('mouseup', () => {
      collectionEl.setAttribute('draggable', 'false');
    });
    dragHandle.addEventListener('touchstart', () => {
      collectionEl.setAttribute('draggable', 'true');
    });
    dragHandle.addEventListener('touchend', () => {
      collectionEl.setAttribute('draggable', 'false');
    });
  }

  collectionEl.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('collection')) {
      draggedItem = {
        type: 'collection',
        id: collection.id
      };
      e.dataTransfer.effectAllowed = 'move';
      collectionEl.classList.add('dragging');
      e.stopPropagation();
    }
  });

  collectionEl.addEventListener('dragend', (e) => {
    collectionEl.classList.remove('dragging');
    collectionEl.setAttribute('draggable', 'false');
    draggedItem = null;
    document.querySelectorAll('.collection').forEach(c => c.classList.remove('drag-over'));
  });

  collectionEl.addEventListener('dragover', (e) => {
    if (draggedItem && draggedItem.type === 'collection' && draggedItem.id !== collection.id) {
      e.preventDefault();
      collectionEl.classList.add('drag-over');
    }
    if (draggedItem && draggedItem.type === 'tab' && draggedItem.sourceCollectionId !== collection.id) {
      e.preventDefault();
      collectionEl.classList.add('drag-over');
    }
  });

  collectionEl.addEventListener('dragleave', () => {
    collectionEl.classList.remove('drag-over');
  });

  collectionEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    collectionEl.classList.remove('drag-over');
    
    if (draggedItem) {
      if (draggedItem.type === 'collection') {
        const sourceId = draggedItem.id;
        const targetId = collection.id;
        if (sourceId !== targetId) {
          await reorderCollections(sourceId, targetId);
        }
      } else if (draggedItem.type === 'tab') {
        const sourceTabId = draggedItem.id;
        const sourceCollId = draggedItem.sourceCollectionId;
        const targetCollId = collection.id;
        if (sourceCollId !== targetCollId) {
          await moveTabToCollection(sourceTabId, sourceCollId, targetCollId);
        }
      }
    }
  });

  return collectionEl;
}

function renderTabs(collection, container) {
  if (!container) return;
  container.innerHTML = '';

  const tabSortType = collection.tabSortType || 'custom';
  let sortedTabs = [...(collection.tabs || [])];

  // Toggle sort-active class on tabs container to hide drag handles when sorted
  container.classList.toggle('sort-active', tabSortType !== 'custom');

  if (tabSortType === 'dateAddedNewest') {
    sortedTabs.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } else if (tabSortType === 'dateAddedOldest') {
    sortedTabs.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  } else if (tabSortType === 'titleAsc') {
    sortedTabs.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  } else if (tabSortType === 'titleDesc') {
    sortedTabs.sort((a, b) => (b.title || '').localeCompare(a.title || '', undefined, { sensitivity: 'base' }));
  }

  if (sortedTabs.length === 0) {
    container.innerHTML = '<div class="empty-tabs-message"><i class="fas fa-info-circle"></i> No tabs in this collection</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  sortedTabs.forEach((tab, index) => {
    const tabEl = renderTab(tab, collection.id, index + 1);
    fragment.appendChild(tabEl);
  });
  container.appendChild(fragment);
}

function renderTab(tab, collectionId, tabNumber) {
  const template = document.getElementById('tabTemplate');
  const clone = template.content.cloneNode(true);
  const tabEl = clone.querySelector('.tab-item');
  tabEl.dataset.id = tab.id;

  const tabNumberEl = tabEl.querySelector('.tab-number');
  const tabFaviconImg = tabEl.querySelector('.tab-favicon-img');
  const titleInput = tabEl.querySelector('.tab-title');
  const urlSpan = tabEl.querySelector('.tab-url');
  const editBtn = tabEl.querySelector('.edit-tab-btn');
  const openBtn = tabEl.querySelector('.open-tab-btn');
  const removeBtn = tabEl.querySelector('.remove-tab-btn');

  if (tabNumberEl) {
    tabNumberEl.textContent = tabNumber;
  }
  if (tabFaviconImg) {
    tabFaviconImg.src = getFaviconUrl(tab.url);
  }

  titleInput.value = tab.title;
  urlSpan.textContent = tab.url.length > 50 ? tab.url.slice(0, 50) + '...' : tab.url;
  urlSpan.title = tab.url;

  // Editing state
  if (editingTabId === tab.id) {
    titleInput.focus();
    titleInput.select();
  }

  // Event listeners
  titleInput.addEventListener('change', (e) => {
    updateTabTitle(collectionId, tab.id, e.target.value);
  });
  titleInput.addEventListener('blur', (e) => {
    if (editingTabId === tab.id) editingTabId = null;
    updateTabTitle(collectionId, tab.id, e.target.value);
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.target.value = tab.title;
      e.target.blur();
    }
  });
  titleInput.addEventListener('focus', () => {
    editingTabId = tab.id;
  });

  // Edit button for tab title
  editBtn.addEventListener('click', () => {
    const isEditing = titleInput.readOnly === false;
    if (isEditing) {
      // Currently editing, save and switch back to edit icon
      titleInput.readOnly = true;
      editBtn.querySelector('i').className = 'fas fa-edit';
      editBtn.title = 'Edit tab title';
      // Trigger update
      updateTabTitle(collectionId, tab.id, titleInput.value);
    } else {
      // Start editing, switch to tick icon
      titleInput.readOnly = false;
      titleInput.focus();
      titleInput.select();
      editBtn.querySelector('i').className = 'fas fa-check';
      editBtn.title = 'Save tab title';
    }
  });

  // Open tab button — honours RAM Saver: discards tab so it only loads when clicked
  openBtn.addEventListener('click', async () => {
    let url = tab.url;
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      const createdTab = await api.tabs.create({ url, active: false });
      const state = await getState();
      if (state.ramSaverEnabled && createdTab && createdTab.id) {
        api.tabs.discard(createdTab.id).catch(err => {
          console.warn(`RAM Saver: Failed to discard tab ${createdTab.id}:`, err);
        });
        showToast('Tab opened (RAM Saver — loads on click)');
      } else {
        showToast('Tab opened in background');
      }
    } catch (err) {
      console.error('Failed to open tab:', url, err);
    }
  });

  removeBtn.addEventListener('click', () => removeTab(collectionId, tab.id));

  // Drag and drop events for tabs
  const tabDragHandle = tabEl.querySelector('.tab-drag-handle');
  if (tabDragHandle) {
    tabDragHandle.addEventListener('mousedown', () => {
      tabEl.setAttribute('draggable', 'true');
    });
    tabDragHandle.addEventListener('mouseup', () => {
      tabEl.setAttribute('draggable', 'false');
    });
    tabDragHandle.addEventListener('touchstart', () => {
      tabEl.setAttribute('draggable', 'true');
    });
    tabDragHandle.addEventListener('touchend', () => {
      tabEl.setAttribute('draggable', 'false');
    });
  }

  tabEl.addEventListener('dragstart', (e) => {
    draggedItem = {
      type: 'tab',
      id: tab.id,
      sourceCollectionId: collectionId
    };
    e.dataTransfer.effectAllowed = 'move';
    tabEl.classList.add('dragging');
    e.stopPropagation();
  });

  tabEl.addEventListener('dragend', (e) => {
    tabEl.classList.remove('dragging');
    tabEl.setAttribute('draggable', 'false');
    draggedItem = null;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
  });

  tabEl.addEventListener('dragover', (e) => {
    if (draggedItem && draggedItem.type === 'tab') {
      e.preventDefault();
      tabEl.classList.add('drag-over');
    }
  });

  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drag-over');
  });

  tabEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    tabEl.classList.remove('drag-over');
    
    if (draggedItem && draggedItem.type === 'tab') {
      const sourceTabId = draggedItem.id;
      const sourceCollId = draggedItem.sourceCollectionId;
      const targetTabId = tab.id;
      const targetCollId = collectionId;
      
      if (sourceCollId === targetCollId) {
        if (sourceTabId !== targetTabId) {
          await reorderTabsWithinCollection(sourceCollId, sourceTabId, targetTabId);
        }
      } else {
        await moveTabToCollectionAtPosition(sourceTabId, sourceCollId, targetCollId, targetTabId);
      }
    }
  });

  return tabEl;
}

function renderAutoSaveSelect(collections, autoSaveCollectionId) {
  elements.autoSaveToggle.checked = !!autoSaveCollectionId;
}

// ==================== RAM SAVER TOGGLE ====================
async function setupRamSaverToggle() {
  const ramSaverToggle = document.getElementById('ramSaverToggle');
  if (!ramSaverToggle) return;

  // Read persisted state and reflect in UI
  const state = await getState();
  ramSaverToggle.checked = state.ramSaverEnabled;

  ramSaverToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await api.storage.local.set({ ramSaverEnabled: enabled });
    if (enabled) {
      showToast('💾 RAM Saver ON — tabs will lazy‑load on click');
    } else {
      showToast('RAM Saver OFF — tabs load normally');
    }
    console.log('RAM Saver:', enabled ? 'enabled' : 'disabled');
  });
}

// ==================== SEARCH / FILTER ====================
let searchDebounceTimer = null;
let tabSearchDebounceTimers = {};

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
    container.querySelectorAll('.collection').forEach(el => {
      el.classList.remove('search-hidden', 'search-fade-in');
    });
    elements.emptyState.classList.toggle(
      'hidden', container.querySelectorAll('.collection').length > 0
    );
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
          toggleCollectionExpanded(collId);
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
          api.tabs.discard(created.id).catch(() => {});
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


/**
 * Live‑filter tabs within a single expanded collection.
 * Walks every `.tab-item` inside the given collection element,
 * matching tab title and URL against the query.
 */
function filterTabsInCollection(collectionEl, query) {
  const q = (query || '').trim().toLowerCase();
  const tabsList = collectionEl.querySelector('.tabs-list');
  if (!tabsList) return;

  // Remove any previous per-collection "no results" banner
  const oldNoResults = collectionEl.querySelector('.collection-tabs-no-results');
  if (oldNoResults) oldNoResults.remove();

  const tabItems = tabsList.querySelectorAll('.tab-item');

  // If the query is empty, show all tabs
  if (!q) {
    tabItems.forEach(tabEl => {
      tabEl.classList.remove('search-hidden', 'search-highlight');
    });
    return;
  }

  let anyVisible = false;

  tabItems.forEach(tabEl => {
    const titleInput = tabEl.querySelector('.tab-title');
    const urlDiv = tabEl.querySelector('.tab-url');
    const title = (titleInput ? titleInput.value : '').toLowerCase();
    const url = (urlDiv ? (urlDiv.title || urlDiv.textContent) : '').toLowerCase();

    if (title.includes(q) || url.includes(q)) {
      tabEl.classList.remove('search-hidden');
      tabEl.classList.add('search-highlight');
      anyVisible = true;
    } else {
      tabEl.classList.add('search-hidden');
      tabEl.classList.remove('search-highlight');
    }
  });

  if (!anyVisible) {
    const noResults = document.createElement('div');
    noResults.className = 'collection-tabs-no-results';
    noResults.textContent = 'No tabs match your search.';
    const tabsContainer = collectionEl.querySelector('.collection-tabs');
    tabsContainer.appendChild(noResults);
  }
}

async function renderOpenTabsList() {
  const tabs = await api.tabs.query({ currentWindow: true });
  const container = elements.openTabsList;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();
  tabs.forEach(tab => {
    const template = document.getElementById('openTabTemplate');
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.open-tab-item');
    const checkbox = item.querySelector('.tab-checkbox');
    const faviconImg = item.querySelector('.open-tab-favicon');
    const titleSpan = item.querySelector('.tab-title');
    const urlSpan = item.querySelector('.tab-url');

    const displayTitle = (tab.title || '').trim() || 'Untitled';
    checkbox.dataset.id = tab.id;
    checkbox.dataset.title = displayTitle;
    checkbox.dataset.url = tab.url;
    if (faviconImg) {
      faviconImg.src = getFaviconUrl(tab.url);
    }
    titleSpan.textContent = displayTitle;
    urlSpan.textContent = tab.url.length > 50 ? tab.url.slice(0, 50) + '...' : tab.url;
    urlSpan.title = tab.url;

    fragment.appendChild(item);
  });
  container.appendChild(fragment);
}

// ==================== MODAL MANAGEMENT ====================
function openAddTabsModal(collectionId) {
  currentCollectionId = collectionId;
  elements.addTabsModal.style.display = 'flex';
  renderOpenTabsList();
  switchTabMode('manual');
}

function closeAddTabsModal() {
  elements.addTabsModal.style.display = 'none';
  currentCollectionId = null;
  elements.tabTitle.value = '';
  elements.tabUrl.value = '';
}

function switchTabMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  elements.manualForm.style.display = mode === 'manual' ? 'flex' : 'none';
  elements.multiForm.style.display = mode === 'multi' ? 'flex' : 'none';
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  // Search box – live filter with debounce
  if (elements.searchBox) {
    elements.searchBox.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        filterResults(elements.searchBox.value);
      }, 150);
    });

    // Allow Escape to clear the search
    elements.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.searchBox.value = '';
        filterResults('');
        elements.searchBox.blur();
      }
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

  // Collection sort button toggle inside backup banner
  const sortColBtn = document.querySelector('.sort-collections-btn');
  const sortColMenu = document.getElementById('collectionsSortMenu');
  if (sortColBtn && sortColMenu) {
    sortColBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close other dropdowns first
      document.querySelectorAll('.sort-dropdown-menu').forEach(menu => {
        if (menu !== sortColMenu) menu.classList.add('hidden');
      });
      sortColMenu.classList.toggle('hidden');
    });

    sortColMenu.addEventListener('click', async (e) => {
      const option = e.target.closest('.sort-option');
      if (option) {
        const value = option.dataset.value;
        await updateState(state => {
          state.collectionSortType = value;
        });
        const state = await getState();
        renderCollections(state);
        sortColMenu.classList.add('hidden');
      }
    });
  }

  // Close any open sort dropdown menus on click outside
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.sort-dropdown-menu').forEach(menu => {
      if (!menu.classList.contains('hidden') && !menu.parentNode.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  });

  // Create collection
  elements.createCollection.addEventListener('click', async () => {
    const name = elements.newCollectionName.value;
    if (await createCollection(name)) {
      elements.newCollectionName.value = '';
      const state = await getState();
      renderCollections(state);
    }
  });

  elements.newCollectionName.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const name = elements.newCollectionName.value;
      if (await createCollection(name)) {
        elements.newCollectionName.value = '';
        const state = await getState();
        renderCollections(state);
      }
    }
  });

  // Auto‑save toggle
  elements.autoSaveToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await updateAutoSaveConfig(enabled);
    const state = await getState();
    renderCollections(state);
  });

  // Modal
  elements.closeModal.addEventListener('click', closeAddTabsModal);
  elements.cancelModal.addEventListener('click', closeAddTabsModal);

  // Tab mode switching
  elements.tabModeSelector.addEventListener('click', (e) => {
    if (e.target.classList.contains('mode-btn')) {
      switchTabMode(e.target.dataset.mode);
    }
  });

  // Add manual tab
  elements.addManualTab.addEventListener('click', async () => {
    const title = elements.tabTitle.value;
    const url = elements.tabUrl.value;
    if (await addManualTab(currentCollectionId, title, url)) {
      elements.tabTitle.value = '';
      elements.tabUrl.value = '';
      const state = await getState();
      renderCollections(state);
      closeAddTabsModal();
    }
  });

  // Add selected tabs
  elements.addSelectedTabs.addEventListener('click', async () => {
    const checkboxes = elements.openTabsList.querySelectorAll('.tab-checkbox:checked');
    const tabs = Array.from(checkboxes).map(cb => ({
      title: cb.dataset.title,
      url: cb.dataset.url
    }));
    await addTabsFromSelection(currentCollectionId, tabs);
    const state = await getState();
    renderCollections(state);
    closeAddTabsModal();
  });

  // Select All Tabs logic
  const selectAllCheckbox = document.getElementById('selectAllTabs');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const checkboxes = elements.openTabsList.querySelectorAll('.tab-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = isChecked;
      });
    });
  }

  // Listen for storage changes (e.g., when background.js auto-saves tabs)
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      // Check if collections or autoSaveCollectionId changed
      if (changes.collections || changes.autoSaveCollectionId) {
        console.log('Storage changed, refreshing UI');
        // Refresh the UI with updated state
        getState().then(state => {
          renderCollections(state);
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
  await setupRamSaverToggle();
  
  // Force an auto-save to ensure the Current Session is completely up-to-date
  try {
    await api.runtime.sendMessage({ command: 'forceAutoSave' });
  } catch (err) {
    console.warn('Failed to force auto-save on popup init:', err);
  }
  
  const state = await getState();
  
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
  
  let needsUpdate = false;
  
  // Collapse all collections by default whenever the popup is opened
  if (state.collections) {
    state.collections.forEach(c => {
      if (c.isExpanded) {
        c.isExpanded = false;
        needsUpdate = true;
      }
    });
  }

  // Migrate existing tabs to have addedAt if they don't have it
  if (state.collections) {
    state.collections.forEach(c => {
      const collCreatedAt = c.createdAt || Date.now();
      if (c.tabs) {
        c.tabs.forEach((t, idx) => {
          if (!t.addedAt) {
            t.addedAt = collCreatedAt + (idx * 1000);
            needsUpdate = true;
          }
        });
      }
    });
  }
  
  // Clean up any stale auto‑save collection IDs (safety check)
  if (state.autoSaveCollectionId && state.collections) {
    const collectionExists = state.collections.some(c => c.id === state.autoSaveCollectionId);
    if (!collectionExists) {
      console.warn(`Popup: Cleaning up stale auto‑save ID: ${state.autoSaveCollectionId}`);
      state.autoSaveCollectionId = null;
      needsUpdate = true;
    }
  }
  
  if (needsUpdate) {
    await setState(state);
    // Re‑fetch state after update
    const updatedState = await getState();
    renderCollections(updatedState);
  } else {
    renderCollections(state);
  }
}

// Start the extension
document.addEventListener('DOMContentLoaded', init);

// ==================== DRAG AND DROP HELPERS ====================
async function reorderCollections(sourceId, targetId) {
  const newState = await updateState(state => {
    // Force collection sort type back to custom order on drag reorder
    state.collectionSortType = 'custom';

    const sourceIdx = state.collections.findIndex(c => c.id === sourceId);
    const targetIdx = state.collections.findIndex(c => c.id === targetId);
    if (sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx) {
      const [movedCollection] = state.collections.splice(sourceIdx, 1);
      state.collections.splice(targetIdx, 0, movedCollection);
    }
  });
  renderCollections(newState);
}

async function moveTabToCollection(tabId, sourceCollId, targetCollId) {
  let canMove = true;
  const newState = await updateState(state => {
    const sourceColl = state.collections.find(c => c.id === sourceCollId);
    const targetColl = state.collections.find(c => c.id === targetCollId);
    if (sourceColl && targetColl) {
      if (targetColl.tabs.length >= MAX_TABS_PER_COLLECTION) {
        canMove = false;
        return;
      }
      const tabIdx = sourceColl.tabs.findIndex(t => t.id === tabId);
      if (tabIdx !== -1) {
        const [movedTab] = sourceColl.tabs.splice(tabIdx, 1);
        targetColl.tabs.push(movedTab);
        sourceColl.updatedAt = Date.now();
        targetColl.updatedAt = Date.now();
      }
    }
  });
  if (!canMove) {
    alert(`Cannot move tab. Maximum ${MAX_TABS_PER_COLLECTION} tabs per collection.`);
  } else {
    renderCollections(newState);
  }
}

async function reorderTabsWithinCollection(collectionId, sourceTabId, targetTabId) {
  const newState = await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      // Force tab sort type back to custom order on drag reorder
      collection.tabSortType = 'custom';

      const sourceIdx = collection.tabs.findIndex(t => t.id === sourceTabId);
      const targetIdx = collection.tabs.findIndex(t => t.id === targetTabId);
      if (sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx) {
        const [movedTab] = collection.tabs.splice(sourceIdx, 1);
        collection.tabs.splice(targetIdx, 0, movedTab);
        collection.updatedAt = Date.now();
      }
    }
  });
  renderCollections(newState);
}

async function moveTabToCollectionAtPosition(tabId, sourceCollId, targetCollId, targetTabId) {
  let canMove = true;
  const newState = await updateState(state => {
    const sourceColl = state.collections.find(c => c.id === sourceCollId);
    const targetColl = state.collections.find(c => c.id === targetCollId);
    if (sourceColl && targetColl) {
      if (targetColl.tabs.length >= MAX_TABS_PER_COLLECTION) {
        canMove = false;
        return;
      }
      // Force tab sort type back to custom order on drag reorder
      targetColl.tabSortType = 'custom';

      const sourceTabIdx = sourceColl.tabs.findIndex(t => t.id === tabId);
      const targetTabIdx = targetColl.tabs.findIndex(t => t.id === targetTabId);
      if (sourceTabIdx !== -1 && targetTabIdx !== -1) {
        const [movedTab] = sourceColl.tabs.splice(sourceTabIdx, 1);
        targetColl.tabs.splice(targetTabIdx, 0, movedTab);
        sourceColl.updatedAt = Date.now();
        targetColl.updatedAt = Date.now();
      }
    }
  });
  if (!canMove) {
    alert(`Cannot move tab. Maximum ${MAX_TABS_PER_COLLECTION} tabs per collection.`);
  } else {
    renderCollections(newState);
  }
}