// Tab Collection Manager — boot script.
//
// Since Phase 5.2 the panel is React-rendered and the state layer lives in the bundled store
// (react-migration-plan.md §8). What is left here is the sequence that has to happen before React
// can render correctly and that talks to the worker:
//
//   1. read the store once and apply the persisted theme, so the panel never flashes the wrong
//      palette before React's first paint;
//   2. ask the worker for an auto-save of the live session and re-read storage, because the write
//      comes from a different context;
//   3. normalise the opened state (collapse every collection, backfill `addedAt`, drop a stale
//      Auto-Save id) through the same write queue React uses.
//
// The store bridge is `window.__tcmStore` (src/app/legacy-store.js); popup.js is a classic script
// and cannot import it. This file and the whole legacy shell go away in Phase 5.3.

document.addEventListener('DOMContentLoaded', async () => {
  const bridge = globalThis.__tcmStore;
  if (!bridge) {
    // `dist/` is the loadable build (README); a missing bridge means the page was opened without
    // the bundle, so fail loudly rather than run half a panel.
    console.error('[boot] React store bridge missing — run `npm run build` and load dist/.');
    return;
  }

  // --- 1. theme, as early as possible -----------------------------------------
  try {
    if (!bridge.isReady()) await bridge.hydrate();
    const early = bridge.getLegacyState();
    document.documentElement.setAttribute('data-theme', early.theme || 'dark');
  } catch (error) {
    console.warn('[boot] failed to apply the persisted theme:', error);
  }

  // --- 2. worker auto-save + fresh read ---------------------------------------
  try {
    await chrome.runtime.sendMessage({ command: 'forceAutoSave' });
    await bridge.hydrate();
  } catch (error) {
    console.warn('[boot] failed to force auto-save on panel open:', error);
  }

  // --- 3. normalise the opened state through the shared queue ------------------
  try {
    const state = bridge.getLegacyState();
    if (normalizeOpenedState(state)) {
      await bridge.mutateLegacy((draft) => normalizeOpenedState(draft));
    }
  } catch (error) {
    console.warn('[boot] failed to normalise the opened state:', error);
  }
});

/**
 * Normalise the state a panel open should not keep as-is: every collection collapsed, every saved
 * tab carrying an `addedAt`, and no auto-save pointing at a collection that is gone. Idempotent —
 * returns whether anything changed, so the caller only writes when it has to.
 *
 * @param {object} state Flat state: a read copy, or the draft being written
 * @returns {boolean} Whether the state was changed
 */
function normalizeOpenedState(state) {
  let changed = false;

  // Collapse all collections by default whenever the panel is opened.
  (state.collections || []).forEach((collection) => {
    if (collection.isExpanded) {
      collection.isExpanded = false;
      changed = true;
    }
  });

  // Migrate existing tabs to have `addedAt` if they don't have it.
  (state.collections || []).forEach((collection) => {
    const collectionCreatedAt = collection.createdAt || Date.now();
    if (collection.tabs) {
      collection.tabs.forEach((tab, index) => {
        if (!tab.addedAt) {
          tab.addedAt = collectionCreatedAt + index * 1000;
          changed = true;
        }
      });
    }
  });

  // Clean up any stale auto-save collection id (safety check).
  if (state.autoSaveCollectionId) {
    const exists = (state.collections || []).some(
      (collection) => collection.id === state.autoSaveCollectionId
    );
    if (!exists) {
      console.warn(`[boot] cleaning up stale auto-save id: ${state.autoSaveCollectionId}`);
      state.autoSaveCollectionId = null;
      changed = true;
    }
  }

  return changed;
}
