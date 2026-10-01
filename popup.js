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

// ==================== TAB GROUP HELPERS ====================
// Chrome reports TAB_ID_NONE (-1) for tabs that are not part of any group.
const TAB_GROUP_ID_NONE = (typeof chrome !== 'undefined' && chrome.tabGroups &&
  typeof chrome.tabGroups.TAB_ID_NONE === 'number') ? chrome.tabGroups.TAB_ID_NONE : -1;

function normalizeGroupId(groupId) {
  return (typeof groupId === 'number' && groupId !== TAB_GROUP_ID_NONE && groupId >= 0) ? groupId : null;
}

// Metadata for the tab groups currently listed in the "Add tabs" modal.
let openTabsGroupMeta = {};

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

// ==================== SESSION HISTORY MODAL CONTROLLER ====================
document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements Setup ---
  const historyBtn = document.getElementById('historyBtn');
  const historyModal = document.getElementById('historyModal');
  const closeHistoryModal = document.getElementById('closeHistoryModal');
  const historyListContainer = document.getElementById('historyListContainer');

  const sessionDetailsModal = document.getElementById('sessionDetailsModal');
  const closeDetailsModal = document.getElementById('closeDetailsModal');
  const detailsTabList = document.getElementById('detailsTabList');

  // --- Modal Visibility Handlers ---
  if (historyBtn) {
    historyBtn.addEventListener('click', openHistoryModal);
  }
  if (closeHistoryModal) {
    closeHistoryModal.addEventListener('click', () => {
      historyModal.style.display = 'none';
    });
  }
  if (closeDetailsModal) {
    closeDetailsModal.addEventListener('click', () => {
      sessionDetailsModal.style.display = 'none';
    });
  }

  // Close modals when clicking on the transparent background overlay
  if (historyModal) {
    historyModal.addEventListener('click', (e) => {
      if (e.target === historyModal) {
        historyModal.style.display = 'none';
      }
    });
  }
  if (sessionDetailsModal) {
    sessionDetailsModal.addEventListener('click', (e) => {
      if (e.target === sessionDetailsModal) {
        sessionDetailsModal.style.display = 'none';
      }
    });
  }

  // --- Helper Function: Show Read-Only Session Details ---
  function showSessionDetails(session, dateString) {
    if (!detailsTabList || !sessionDetailsModal) return;
    
    detailsTabList.innerHTML = '';
    
    const header = sessionDetailsModal.querySelector('h3');
    if (header) {
      header.innerHTML = `<i class="fas fa-list"></i> <span style="font-size: 0.7rem;">Session Detail</span> <span style="font-size: 11px; font-weight: normal; display: block; color: var(--text-secondary); margin-top: 4px;">Saved on ${dateString}</span>`;
    }

    session.tabs.forEach(tab => {
      const tabDetailRow = document.createElement('div');
      tabDetailRow.className = 'tab-item';
      tabDetailRow.style.padding = '8px';
      tabDetailRow.style.borderBottom = '1px solid var(--border-color, #eee)';
      tabDetailRow.style.display = 'flex';
      tabDetailRow.style.alignItems = 'center';
      tabDetailRow.style.gap = '10px';

      const faviconSrc = tab.url ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32` : 'icons/icon16.png';

      tabDetailRow.innerHTML = `
        <img src="${faviconSrc}" style="width: 16px; height: 16px; flex-shrink: 0; border-radius: 2px;" />
        <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 500; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${tab.title}">
            ${tab.title || 'Untitled'}
          </span>
          <span style="font-size: 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${tab.url}">
            ${tab.url}
          </span>
        </div>
      `;
      detailsTabList.appendChild(tabDetailRow);
    });

    sessionDetailsModal.style.display = 'flex';
  }

  // --- Core Function: Open History Modal ---
  async function openHistoryModal() {
    // 1. Fetch current extension state
    const state = await chrome.storage.local.get(['sessionHistory', 'ramSaverEnabled']);
    const history = state.sessionHistory || [];
    const ramSaverEnabled = !!state.ramSaverEnabled;

    // 2. Clear previous contents
    historyListContainer.innerHTML = '';

    if (history.length === 0) {
      historyListContainer.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-clock"></i>
          <h3>No sessions saved yet</h3>
          <p>Once you modify your open tabs, past snapshots will show up here.</p>
        </div>`;
      historyModal.style.display = 'flex';
      return;
    }

    // 3. Render each session item
    history.forEach((session, index) => {
      const dateString = new Date(session.timestamp).toLocaleString();
      const tabCount = session.tabs.length;

      const sessionCard = document.createElement('div');
      sessionCard.className = 'tab-item';
      
      // UI styling for card interaction
      sessionCard.style.cursor = 'pointer'; 
      sessionCard.style.flexDirection = 'column';
      sessionCard.style.alignItems = 'stretch';
      sessionCard.style.gap = '8px';
      sessionCard.style.padding = '12px';
      sessionCard.style.transition = 'background-color 0.2s';

      // Hover interaction
      sessionCard.addEventListener('mouseenter', () => sessionCard.style.backgroundColor = 'var(--bg-card-hover)');
      sessionCard.addEventListener('mouseleave', () => sessionCard.style.backgroundColor = 'transparent');

      sessionCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="card-click-area" style="flex-grow: 1; margin-right: 8px;">
            <strong style="font-size: 13.5px; color: var(--text-primary);">
              Snapshot #${history.length - index}
            </strong>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
              <i class="far fa-calendar-alt"></i> ${dateString} • <strong>${tabCount} tabs</strong>
            </div>
          </div>
          <button class="btn-success open-all-session-btn" style="padding: 6px 12px; font-size: 11px; z-index: 10;">
            <i class="fas fa-external-link-alt"></i> Open All
          </button>
        </div>
        <div class="tabs-preview card-click-area" style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; flex-grow: 1;">
          <!-- Favicon list previews -->
        </div>
      `;

      // 4. Generate visual small favicon list inside the session list row
      const previewContainer = sessionCard.querySelector('.tabs-preview');
      session.tabs.slice(0, 10).forEach(tab => {
        const img = document.createElement('img');
        img.src = tab.url ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32` : 'icons/icon16.png';
        img.style.width = '16px';
        img.style.height = '16px';
        img.style.borderRadius = '3px';
        img.title = tab.title;
        previewContainer.appendChild(img);
      });
      if (session.tabs.length > 10) {
        const moreCount = document.createElement('span');
        moreCount.style.fontSize = '10px';
        moreCount.style.color = 'var(--text-secondary)';
        moreCount.style.alignSelf = 'center';
        moreCount.textContent = `+${session.tabs.length - 10}`;
        previewContainer.appendChild(moreCount);
      }

      // 5. View Details Event Handler
      const clickAreas = sessionCard.querySelectorAll('.card-click-area');
      clickAreas.forEach(area => {
        area.addEventListener('click', (e) => {
          e.stopPropagation(); // Stop click bleeding
          showSessionDetails(session, dateString);
        });
      });

      // 6. Attach event handler for "Open All"
      const openBtn = sessionCard.querySelector('.open-all-session-btn');
      openBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevents details modal from opening when clicking 'Open All'
        
        // Close modal
        historyModal.style.display = 'none';
        
        // Target current active window
        const currentWindow = await chrome.windows.getLastFocused();
        const targetWindowId = currentWindow ? currentWindow.id : undefined;

        // Restore all tabs asynchronously
        const tabPromises = session.tabs.map(tab => {
          let url = tab.url;
          if (!url || url === 'about:blank') return Promise.resolve();
          if (!url.startsWith('http')) url = 'https://' + url;

          return chrome.tabs.create({
            windowId: targetWindowId,
            url: url,
            pinned: !!tab.pinned,
            active: false
          }).then(createdTab => {
            if (ramSaverEnabled && createdTab && createdTab.id) {
              discardWhenLoaded(createdTab.id);
            }
          }).catch(err => console.error('Failed to restore historical tab:', err));
        });

        await Promise.all(tabPromises);
      });

      historyListContainer.appendChild(sessionCard);
    });

    historyModal.style.display = 'flex';
  }
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

function showToast(message, duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after the specified duration
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) container.removeChild(toast);
    }, 400);
  }, duration);
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


function updateCollectionSortIcon(sortType) {
    const icon = document.getElementById('collectionSortIcon');

    if (!icon) return;

    icon.className =
        `fa-solid ${COLLECTION_SORT_ICONS[sortType] || 'fa-arrow-up-wide-short'}`;
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
  autoSaveToggle: null, // now lives inside settingsModal, resolved at runtime
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
  searchBox: document.getElementById('searchBox'),
  toggleLayoutBtn: document.getElementById('toggleLayoutBtn')
};

// ==================== STATE VARIABLES ====================
let currentCollectionId = null; // For modal context

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
        syncLegacyChrome(state);
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
      collection.tabs = partitionTabs(collection.tabs);
      collection.updatedAt = Date.now();
    }
  });

  if (!canAdd) {
    alert(`Cannot add more tabs. Maximum ${MAX_TABS_PER_COLLECTION} tabs per collection.`);
    return false;
  }

  return true;
}

async function addTabsFromSelection(collectionId, tabsArray, groupsMeta = {}) {
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

      // Merge Chrome tab-group metadata for the groups being imported so the
      // groups can be rebuilt when this collection is restored.
      const referencedGroups = {};
      tabsToAdd.forEach(t => {
        const gid = normalizeGroupId(t.groupId);
        if (gid !== null && groupsMeta[gid]) referencedGroups[gid] = groupsMeta[gid];
      });
      if (Object.keys(referencedGroups).length > 0) {
        collection.chromeGroups = { ...(collection.chromeGroups || {}), ...referencedGroups };
      }
      let currentPinnedTabsCount = collection.tabs.filter(t => t.pinned).length;
      
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
        
        let isTabPinned = !!tab.pinned;
        if (isTabPinned) {
          if (currentPinnedTabsCount < state.maxPinnedTabs) {
            currentPinnedTabsCount++;
          } else {
            isTabPinned = false;
          }
        }

        const trimmedTitle = (tab.title || '').trim() || 'Untitled';
        collection.tabs.push({
          id: generateId(),
          title: trimmedTitle,
          url: tab.url,
          pinned: isTabPinned,
          index: collection.tabs.length, // Append at the end
          windowId: 0, // Default window
          active: false,
          discarded: false,
          highlighted: false,
          addedAt: tab.addedAt || Date.now(),
          chromeGroupId: normalizeGroupId(tab.groupId)
        });
        addedCount++;
      });
      collection.tabs = partitionTabs(collection.tabs);
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
async function updateAutoSaveConfig(enabled) {
  await updateState(state => {
    if (enabled) {
      state.autoSaveCollectionId = CURRENT_SESSION_ID; // Always default to Current Session
    } else {
      state.autoSaveCollectionId = null;
    }
  });
}

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
 * the layout icon toggle, the auto-save toggle and the restore-backup button.
 *
 * Every caller that used to repaint the collection list now just calls this, because the list
 * renders itself from the store — any write lands in chrome.storage.local and the React store
 * re-renders from there (react-migration-plan.md §8, Phase 2).
 *
 * @param {object} state Result of getState()
 */
function syncLegacyChrome(state) {
  const { collections, autoSaveCollectionId, collectionSortType, layoutViewMode } = state;

  updateLayoutIcon(layoutViewMode === 'grid');

  // Highlight the active option in the collections sort menu
  const colSortType = collectionSortType || 'custom';
  const sortMenu = document.getElementById('collectionsSortMenu');
  if (sortMenu) {
    sortMenu.querySelectorAll('.sort-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === colSortType);
    });
  }

  renderAutoSaveSelect(collections, autoSaveCollectionId);
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

function renderAutoSaveSelect(collections, autoSaveCollectionId) {
  const autoSaveToggle = document.getElementById('autoSaveToggle');
  if (autoSaveToggle) autoSaveToggle.checked = !!autoSaveCollectionId;
}

// ==================== RAM SAVER TOGGLE ====================
async function setupSettingsModal() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModal = document.getElementById('closeSettingsModal');
  const autoSaveToggle = document.getElementById('autoSaveToggle');
  const ramSaverToggle = document.getElementById('ramSaverToggle');
  const lightModeToggle = document.getElementById('lightModeToggle');
  const enforceMaxPinnedCollectionsToggle = document.getElementById('enforceMaxPinnedCollectionsToggle');
  const enforceMaxPinnedTabsToggle = document.getElementById('enforceMaxPinnedTabsToggle');
  const maxPinnedCollectionsInput = document.getElementById('maxPinnedCollectionsInput');
  const maxPinnedTabsInput = document.getElementById('maxPinnedTabsInput');
  const maxPinnedCollectionsGroup = document.getElementById('maxPinnedCollectionsGroup');
  const maxPinnedTabsGroup = document.getElementById('maxPinnedTabsGroup');

  // Load current state and initialise checkboxes & inputs
  const state = await getState();
  if (autoSaveToggle) autoSaveToggle.checked = !!state.autoSaveCollectionId;
  if (ramSaverToggle) ramSaverToggle.checked = state.ramSaverEnabled;
  if (lightModeToggle) lightModeToggle.checked = state.theme === 'light';
  if (enforceMaxPinnedCollectionsToggle) enforceMaxPinnedCollectionsToggle.checked = state.enforceMaxPinnedCollections;
  if (enforceMaxPinnedTabsToggle) enforceMaxPinnedTabsToggle.checked = state.enforceMaxPinnedTabs;
  if (maxPinnedCollectionsInput) maxPinnedCollectionsInput.value = state.maxPinnedCollections;
  if (maxPinnedTabsInput) maxPinnedTabsInput.value = state.maxPinnedTabs;

  if (maxPinnedCollectionsGroup) {
    maxPinnedCollectionsGroup.classList.toggle('disabled', !state.enforceMaxPinnedCollections);
  }
  if (maxPinnedTabsGroup) {
    maxPinnedTabsGroup.classList.toggle('disabled', !state.enforceMaxPinnedTabs);
  }

  // Open / close the settings modal
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
    });
  }
  if (closeSettingsModal && settingsModal) {
    closeSettingsModal.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  // Close on overlay click
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.style.display = 'none';
    });
  }

  // Auto-save toggle
  if (autoSaveToggle) {
    autoSaveToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await updateAutoSaveConfig(enabled);
      const newState = await getState();
      syncLegacyChrome(newState);
      showToast(enabled ? 'Auto-Save enabled' : 'Auto-Save disabled');
    });
  }

  // RAM Saver toggle
  if (ramSaverToggle) {
    ramSaverToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.storage.local.set({ ramSaverEnabled: enabled });
      if (enabled) {
        showToast('💾 RAM Saver ON — tabs will lazy‑load on click');
      } else {
        showToast('RAM Saver OFF — tabs load normally');
      }
    });
  }

  // Light Mode toggle
  if (lightModeToggle) {
    lightModeToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      const theme = enabled ? 'light' : 'dark';
      await api.storage.local.set({ theme });
      document.documentElement.setAttribute('data-theme', theme);
      showToast(theme === 'light' ? 'Light Mode enabled' : 'Dark Mode enabled');
    });
  }

  // Enforce max pinned collections toggle
  if (enforceMaxPinnedCollectionsToggle) {
    enforceMaxPinnedCollectionsToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.storage.local.set({ enforceMaxPinnedCollections: enabled });
      if (maxPinnedCollectionsGroup) {
        maxPinnedCollectionsGroup.classList.toggle('disabled', !enabled);
      }
      const currentLimit = maxPinnedCollectionsInput ? parseInt(maxPinnedCollectionsInput.value, 10) : 3;
      showToast(enabled ? `Pinned collection limit enabled (max ${currentLimit})` : 'Pinned collection limit removed');
    });
  }

  // Enforce max pinned tabs toggle
  if (enforceMaxPinnedTabsToggle) {
    enforceMaxPinnedTabsToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.storage.local.set({ enforceMaxPinnedTabs: enabled });
      if (maxPinnedTabsGroup) {
        maxPinnedTabsGroup.classList.toggle('disabled', !enabled);
      }
      const currentLimit = maxPinnedTabsInput ? parseInt(maxPinnedTabsInput.value, 10) : 3;
      showToast(enabled ? `Pinned tab limit enabled (max ${currentLimit} per collection)` : 'Pinned tab limit removed');
    });
  }

  // Max pinned collections input
  if (maxPinnedCollectionsInput) {
    maxPinnedCollectionsInput.addEventListener('change', async (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 20) val = 20;
      e.target.value = val;
      await api.storage.local.set({ maxPinnedCollections: val });
      showToast(`Pinned collections limit set to ${val}`);
    });
  }

  // Max pinned tabs input
  if (maxPinnedTabsInput) {
    maxPinnedTabsInput.addEventListener('change', async (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 50) val = 50;
      e.target.value = val;
      await api.storage.local.set({ maxPinnedTabs: val });
      showToast(`Pinned tabs limit set to ${val} per collection`);
    });
  }

  // ── Google Drive Cloud Backup ───────────────────────────────────────────
  const gdriveBackupToggle = document.getElementById('gdriveBackupToggle');
  const gdriveAutoBackupToggle = document.getElementById('gdriveAutoBackupToggle');
  const gdriveAutoBackupRow = document.getElementById('gdriveAutoBackupRow');
  const gdriveLastBackupRow = document.getElementById('gdriveLastBackupRow');
  const gdriveLastBackupLabel = document.getElementById('gdriveLastBackupLabel');
  const gdriveActionsRow = document.getElementById('gdriveActionsRow');
  const gdriveManualBackupBtn = document.getElementById('gdriveManualBackupBtn');
  const gdriveRestoreBtn = document.getElementById('gdriveRestoreBtn');
  const gdriveDisconnectBtn = document.getElementById('gdriveDisconnectBtn');

  async function loadGDriveStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ command: 'gdriveGetStatus' });
      if (!status || !status.success) return;

      if (gdriveBackupToggle) gdriveBackupToggle.checked = status.enabled;
      if (gdriveAutoBackupToggle) gdriveAutoBackupToggle.checked = status.autoBackupEnabled;

      const showSubRows = status.enabled;
      if (gdriveAutoBackupRow) gdriveAutoBackupRow.style.display = showSubRows ? '' : 'none';
      if (gdriveLastBackupRow) gdriveLastBackupRow.style.display = showSubRows ? '' : 'none';
      if (gdriveActionsRow) gdriveActionsRow.style.display = showSubRows ? '' : 'none';

      if (gdriveLastBackupLabel) {
        if (status.lastBackupTimestamp) {
          const d = new Date(status.lastBackupTime);
          gdriveLastBackupLabel.textContent = `Last backup: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
        } else {
          gdriveLastBackupLabel.textContent = 'Last backup: —';
        }
      }
    } catch (err) {
      console.warn('Failed to load GDrive status:', err);
    }
  }

  // Load status when settings modal opens
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      loadGDriveStatus();
    });
  }

  // Enable / disable cloud backup
  if (gdriveBackupToggle) {
    gdriveBackupToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.storage.local.set({ gdriveBackupEnabled: enabled });

      if (enabled) {
        // Trigger initial backup + schedule auto-backup alarm if auto-backup is on
        showToast('☁️ Connecting to Google Drive...');
        try {
          const result = await chrome.runtime.sendMessage({ command: 'gdriveBackup' });
          if (result && result.success) {
            showToast('☁️ Cloud backup enabled! Data saved to Google Drive.');
          } else {
            // Revert toggle on failure
            gdriveBackupToggle.checked = false;
            await api.storage.local.set({ gdriveBackupEnabled: false });
            showToast(`❌ Backup failed: ${result?.error || 'Unknown error'}`);
          }
        } catch (err) {
          gdriveBackupToggle.checked = false;
          await api.storage.local.set({ gdriveBackupEnabled: false });
          showToast(`❌ Connection failed: ${err.message}`);
        }
      } else {
        // Disable auto-backup too
        await api.storage.local.set({ gdriveAutoBackupEnabled: false });
        await chrome.runtime.sendMessage({ command: 'gdriveEnableAutoBackup', enabled: false });
        showToast('Cloud backup disabled');
      }
      loadGDriveStatus();
    });
  }

  // Toggle auto-backup
  if (gdriveAutoBackupToggle) {
    gdriveAutoBackupToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.storage.local.set({ gdriveAutoBackupEnabled: enabled });
      await chrome.runtime.sendMessage({ command: 'gdriveEnableAutoBackup', enabled });
      showToast(enabled ? '🔄 Daily auto-backup enabled' : 'Auto-backup disabled');
    });
  }

  // Manual backup button
  if (gdriveManualBackupBtn) {
    gdriveManualBackupBtn.addEventListener('click', async () => {
      gdriveManualBackupBtn.disabled = true;
      gdriveManualBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Backing up...';
      try {
        const result = await chrome.runtime.sendMessage({ command: 'gdriveBackup' });
        if (result && result.success) {
          showToast('☁️ Backup saved to Google Drive!');
        } else {
          showToast(`❌ Backup failed: ${result?.error || 'Unknown error'}`);
        }
      } catch (err) {
        showToast(`❌ Backup failed: ${err.message}`);
      } finally {
        gdriveManualBackupBtn.disabled = false;
        gdriveManualBackupBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Backup Now';
        loadGDriveStatus();
      }
    });
  }

  // Restore from Drive button
  if (gdriveRestoreBtn) {
    gdriveRestoreBtn.addEventListener('click', async () => {
      if (!confirm('This will overwrite your current collections with the Google Drive backup. Continue?')) return;
      gdriveRestoreBtn.disabled = true;
      gdriveRestoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
      try {
        const result = await chrome.runtime.sendMessage({ command: 'gdriveRestore' });
        if (result && result.success) {
          showToast(`✅ Restored ${result.collectionsCount} collections from Drive!`);
          // Refresh the UI
          const newState = await getState();
          syncLegacyChrome(newState);
        } else {
          showToast(`❌ Restore failed: ${result?.error || 'Unknown error'}`);
        }
      } catch (err) {
        showToast(`❌ Restore failed: ${err.message}`);
      } finally {
        gdriveRestoreBtn.disabled = false;
        gdriveRestoreBtn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Restore from Drive';
        loadGDriveStatus();
      }
    });
  }

  // Disconnect button
  if (gdriveDisconnectBtn) {
    gdriveDisconnectBtn.addEventListener('click', async () => {
      if (!confirm('Disconnect Google Drive? This will remove the backup from Drive.')) return;
      try {
        await chrome.runtime.sendMessage({ command: 'gdriveDeleteBackup' });
      } catch (e) { /* ignore */ }
      await api.storage.local.set({ gdriveBackupEnabled: false, gdriveAutoBackupEnabled: false });
      await chrome.runtime.sendMessage({ command: 'gdriveEnableAutoBackup', enabled: false });
      try {
        await chrome.runtime.sendMessage({ command: 'gdriveSignOut' });
      } catch (e) { /* ignore */ }
      showToast('Google Drive disconnected');
      loadGDriveStatus();
    });
  }

}



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

async function renderOpenTabsList() {
  const tabs = await api.tabs.query({ currentWindow: true });
  openTabsGroupMeta = await captureGroupMeta(tabs);
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
    checkbox.dataset.groupId = normalizeGroupId(tab.groupId) ?? '';
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

  // Auto‑save toggle is now handled in setupSettingsModal

  // Modal
  elements.closeModal.addEventListener('click', closeAddTabsModal);
  elements.cancelModal.addEventListener('click', closeAddTabsModal);

  // The grid-view collection modal is React-owned (src/features/collections).

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
      syncLegacyChrome(state);
      closeAddTabsModal();
    }
  });

  // Add selected tabs
  elements.addSelectedTabs.addEventListener('click', async () => {
    const checkboxes = elements.openTabsList.querySelectorAll('.tab-checkbox:checked');
    const tabs = Array.from(checkboxes).map(cb => ({
      title: cb.dataset.title,
      url: cb.dataset.url,
      groupId: cb.dataset.groupId === '' ? null : Number(cb.dataset.groupId)
    }));
    await addTabsFromSelection(currentCollectionId, tabs, openTabsGroupMeta);
    const state = await getState();
    syncLegacyChrome(state);
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
  setupShortcutsHelpModal();
  await setupSettingsModal();
  
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
  toast: (message, duration) => showToast(message, duration),
  toggleCollectionPin: (collectionId) => togglePinCollection(collectionId),
  toggleTabPin: (collectionId, tabId) => togglePinTab(collectionId, tabId),
  renameCollection: (collectionId, name) => renameCollection(collectionId, name),
  deleteCollection: (collectionId) => deleteCollection(collectionId),
  removeTab: (collectionId, tabId) => removeTab(collectionId, tabId),
  renameTab: (collectionId, tabId, title) => updateTabTitle(collectionId, tabId, title),
  openSavedTab,
  openAllTabs: (collectionId) => openAllTabsInCollection(collectionId),
  openAddTabs: (collectionId) => openAddTabsModal(collectionId),
  importTabs: (collectionId) => importCollection(collectionId),
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

// Shared list of modal overlay IDs — used by closeTopModal() and isAnyModalOpen()
const MODAL_IDS = ['shortcutsHelpModal', 'sessionDetailsModal', 'historyModal', 'duplicateUrlDialog', 'settingsModal', 'addTabsModal'];

function openShortcutsHelp() {
  const modal = document.getElementById('shortcutsHelpModal');
  if (!modal) return;
  modal.style.display = 'flex';
}

function setupShortcutsHelpModal() {
  const modal = document.getElementById('shortcutsHelpModal');
  const closeBtn = document.getElementById('closeShortcutsHelpModal');
  if (!modal || !closeBtn) return;

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Close when clicking the transparent overlay background
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
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

function isAnyModalOpen() {
  return MODAL_IDS.some(id => {
    const m = document.getElementById(id);
    return m && m.style.display === 'flex';
  });
}

function closeTopModal() {
  // Close the topmost open modal (sessionDetailsModal sits above historyModal)
  for (const id of MODAL_IDS) {
    const modal = document.getElementById(id);
    if (modal && modal.style.display === 'flex') {
      if (id === 'addTabsModal') {
        closeAddTabsModal(); // resets modal state & currentCollectionId
      } else if (id === 'duplicateUrlDialog') {
        // Click cancel so the awaiting duplicate-confirm promise resolves
        const cancelBtn = document.getElementById('duplicateCancelBtn');
        if (cancelBtn) cancelBtn.click();
        else modal.style.display = 'none';
      } else {
        modal.style.display = 'none';
      }
      return true;
    }
  }
  return false;
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

  // Esc → close topmost modal, then open slides, then dropdowns
  if (e.key === 'Escape') {
    if (closeTopModal()) return;
    if (closeOpenSlides()) return;
    closeOpenDropdowns();
    return;
  }

  // Ignore plain keys while typing in a field
  if (isTyping) return;

  // ? → open the keyboard shortcuts help overlay
  if (!mod && e.key === '?') {
    openShortcutsHelp();
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