// "Add to Collection" context menu: one parent item with a child per user collection, rebuilt
// whenever the collections list changes. Current Session is excluded because it auto-saves.
import { api } from './api.js';
import { CONTEXT_MENU_PARENT_ID, STORAGE_KEYS, TIMING } from './constants.js';
import { getState, updateState } from './state.js';
import { findDuplicateCollections } from './lib/duplicates.js';
import { isSaveableUrl } from './lib/tabs.js';
import { CURRENT_SESSION_ID } from '../src/shared/storage-keys.js';
import { LIMITS } from '../src/shared/constants.js';

/** Rebuild the whole context-menu tree from the current collections. */
export async function buildContextMenus() {
  await api.contextMenus.removeAll();

  const state = await getState();
  const collections = (state.collections || []).filter(
    (collection) => collection.id !== CURRENT_SESSION_ID
  );

  if (collections.length === 0) {
    // A single disabled item so users know where to look.
    api.contextMenus.create({
      id: CONTEXT_MENU_PARENT_ID,
      title: 'Add to Collection (no collections yet)',
      contexts: ['page', 'link'],
      enabled: false,
    });
    return;
  }

  api.contextMenus.create({
    id: CONTEXT_MENU_PARENT_ID,
    title: 'Add to Collection',
    contexts: ['page', 'link'],
  });

  for (const collection of collections) {
    api.contextMenus.create({
      id: `collection-${collection.id}`,
      parentId: CONTEXT_MENU_PARENT_ID,
      title: collection.name,
      contexts: ['page', 'link'],
    });
  }

  console.log(`Context menus built: ${collections.length} collection(s)`);
}

/**
 * Flash a short badge on the toolbar action. The badge API is not available in every context, so
 * failures are swallowed on purpose.
 *
 * @param {string} color
 * @param {string} text
 * @param {number} clearAfterMs
 * @returns {Promise<void>}
 */
async function flashBadge(color, text, clearAfterMs) {
  try {
    await api.action.setBadgeBackgroundColor({ color });
    await api.action.setBadgeText({ text });
    setTimeout(() => api.action.setBadgeText({ text: '' }), clearAfterMs);
  } catch {
    // Badge API may not be available in all contexts.
  }
}

/**
 * Handle a context-menu click: add the page (or link) to the chosen collection, refusing
 * duplicates anymore the URL already lives in.
 *
 * @param {Record<string, any>} info
 * @param {Record<string, any>} [tab]
 * @returns {Promise<void>}
 */
export async function handleContextMenuClick(info, tab) {
  const menuId = info.menuItemId;
  if (typeof menuId !== 'string' || !menuId.startsWith('collection-')) return;

  const collectionId = menuId.replace('collection-', '');
  const url = info.linkUrl || info.pageUrl || (tab ? tab.url : '');
  const title = info.linkUrl
    ? info.selectionText || info.linkUrl // link context: selected text or raw URL
    : tab
      ? tab.title
      : 'Untitled';

  if (!url) {
    console.warn('Context menu: no URL to add');
    return;
  }
  if (!isSaveableUrl(url)) {
    console.warn('Context menu: invalid URL skipped:', url);
    return;
  }

  // Duplicate detection across every collection except Current Session.
  const currentState = await getState();
  const duplicateIn = findDuplicateCollections(url, currentState.collections, CURRENT_SESSION_ID);
  if (duplicateIn.length > 0) {
    console.warn(
      `Context menu: duplicate URL already exists in: ${duplicateIn.join(', ')}. Skipping add.`
    );
    await flashBadge('#e74c3c', '!', 3000);
    return;
  }

  let added = false;
  await updateState((state) => {
    const collection = state.collections.find((candidate) => candidate.id === collectionId);
    if (!collection) return;
    if (collection.tabs.length >= LIMITS.MAX_TABS_PER_COLLECTION) {
      console.warn(
        `Context menu: collection "${collection.name}" is full (${LIMITS.MAX_TABS_PER_COLLECTION} tabs)`
      );
      return;
    }
    collection.tabs.push({
      id: crypto.randomUUID(),
      title: (title || '').trim() || 'Untitled',
      url,
      pinned: false,
      index: collection.tabs.length,
      windowId: tab ? tab.windowId : 0,
      active: false,
      discarded: false,
      highlighted: false,
      addedAt: Date.now(),
    });
    collection.updatedAt = Date.now();
    added = true;
  });

  if (!added) return;

  await flashBadge('#4ecdc4', '✓', 2000);
  console.log(`Context menu: added "${title}" to collection ${collectionId}`);
}

/** Wire the menu click and the storage-driven rebuild (debounced to avoid duplicate-id races). */
export function registerContextMenuListeners() {
  api.contextMenus.onClicked.addListener((info, tab) => handleContextMenuClick(info, tab));

  /** @type {ReturnType<typeof setTimeout>|null} */
  let rebuildTimer = null;
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes[STORAGE_KEYS.collections]) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      buildContextMenus();
    }, TIMING.CONTEXT_MENU_DEBOUNCE_MS);
  });
}
