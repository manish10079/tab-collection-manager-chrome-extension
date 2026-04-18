// Tab Collection Manager - Popup Logic
// STRICT STATE MANAGEMENT: READ → CLONE → MODIFY → SAVE → RENDER

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
  addSelectedTabs: document.getElementById('addSelectedTabs')
};

// ==================== STATE VARIABLES ====================
let currentCollectionId = null; // For modal context
let editingTabId = null; // Local UI state only

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

async function toggleCollectionExpanded(collectionId) {
  const newState = await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      collection.isExpanded = !collection.isExpanded;
    }
  });
  renderCollections(newState);
}

// ==================== TAB OPERATIONS ====================
async function addManualTab(collectionId, title, url) {
  const trimmedTitle = title.trim() || 'Untitled';
  const trimmedUrl = url.trim();

  if (!validateUrl(trimmedUrl)) {
    alert('Please enter a valid URL (e.g., https://example.com)');
    return false;
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
        highlighted: false
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

  let addedCount = 0;
  let skippedDueToLimit = 0;
  let skippedDueToInvalidUrl = 0;

  await updateState(state => {
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const availableSlots = MAX_TABS_PER_COLLECTION - collection.tabs.length;
      
      tabsArray.forEach(tab => {
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
          highlighted: false
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
      await api.tabs.create({ url });
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
  const { collections, autoSaveCollectionId } = state;
  const container = elements.collectionsContainer;
  const fragment = document.createDocumentFragment();

  collections.forEach(collection => {
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
    tabsContainer.style.display = 'block';
    renderTabs(collection, tabsContainer.querySelector('.tabs-list'));
  } else {
    tabsContainer.style.display = 'none';
  }

  // Auto‑save indicator
  if (collection.id === autoSaveCollectionId) {
    collectionEl.style.borderLeft = '4px solid var(--accent)';
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

  return collectionEl;
}

function renderTabs(collection, container) {
  const fragment = document.createDocumentFragment();
  collection.tabs.forEach(tab => {
    const tabEl = renderTab(tab, collection.id);
    fragment.appendChild(tabEl);
  });
  container.innerHTML = '';
  container.appendChild(fragment);
}

function renderTab(tab, collectionId) {
  const template = document.getElementById('tabTemplate');
  const clone = template.content.cloneNode(true);
  const tabEl = clone.querySelector('.tab-item');
  tabEl.dataset.id = tab.id;

  const titleInput = tabEl.querySelector('.tab-title');
  const urlSpan = tabEl.querySelector('.tab-url');
  const editBtn = tabEl.querySelector('.edit-tab-btn');
  const openBtn = tabEl.querySelector('.open-tab-btn');
  const removeBtn = tabEl.querySelector('.remove-tab-btn');

  titleInput.value = tab.title;
  urlSpan.textContent = tab.url;
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

  // Open tab button
  openBtn.addEventListener('click', () => {
    let url = tab.url;
    if (url && url.startsWith('http')) {
      api.tabs.create({ url: url, active: false });
    } else {
      // If URL is not valid, try to make it valid
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      api.tabs.create({ url, active: false });
    }
    showToast('Tab opened in background');
  });

  removeBtn.addEventListener('click', () => removeTab(collectionId, tab.id));

  return tabEl;
}

function renderAutoSaveSelect(collections, autoSaveCollectionId) {
  elements.autoSaveToggle.checked = !!autoSaveCollectionId;
}

async function renderOpenTabsList() {
  const tabs = await api.tabs.query({});
  const container = elements.openTabsList;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();
  tabs.forEach(tab => {
    const template = document.getElementById('openTabTemplate');
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.open-tab-item');
    const checkbox = item.querySelector('.tab-checkbox');
    const titleSpan = item.querySelector('.tab-title');
    const urlSpan = item.querySelector('.tab-url');

    const displayTitle = (tab.title || '').trim() || 'Untitled';
    checkbox.dataset.id = tab.id;
    checkbox.dataset.title = displayTitle;
    checkbox.dataset.url = tab.url;
    titleSpan.textContent = displayTitle;
    urlSpan.textContent = tab.url;

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
        });
      }
    }
  });
}

// ==================== INITIALIZATION ====================
async function init() {
  console.log('--- POPUP INIT ---');
  setupEventListeners();
  const state = await getState();
  
  // Debug logging
  console.log('Popup State:', {
    collectionsCount: state.collections?.length || 0,
    autoSaveCollectionId: state.autoSaveCollectionId,
    backupAvailable: !!(state.lastSessionBackup && state.lastSessionBackup.tabs?.length),
    backupTabCount: state.lastSessionBackup?.tabs?.length || 0,
    currentSessionExists: state.collections?.some(c => c.id === CURRENT_SESSION_ID) || false
  });
  
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
  
  // Ensure Current Session collection is expanded by default for better UX
  let needsUpdate = false;
  if (state.collections) {
    const currentSession = state.collections.find(c => c.id === CURRENT_SESSION_ID);
    // Expand if not already expanded (isExpanded is false, undefined, or any falsy value)
    if (currentSession && currentSession.isExpanded !== true) {
      console.log('Expanding Current Session collection by default (was:', currentSession.isExpanded, ')');
      currentSession.isExpanded = true;
      needsUpdate = true;
    }
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