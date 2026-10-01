// React -> legacy seam. Until Phase 5 deletes popup.js, some actions (CRUD, pinning,
// import/export, toasts) still live in the legacy runtime, which exposes them on
// `window.TCMLegacyUI`. Everything is looked up lazily per call so script order never
// matters, and every method degrades to a warning instead of throwing when the legacy
// runtime is absent (unit tests, `vite dev` outside the extension).
//
// This file is deleted when the last legacy action moves into React.

/**
 * @param {string} name
 * @param {unknown[]} args
 * @returns {any}
 */
function callLegacy(name, ...args) {
  const legacy = globalThis.TCMLegacyUI;
  if (!legacy || typeof legacy[name] !== 'function') {
    console.warn(`[react-bridge] legacy action "${name}" is unavailable`);
    return undefined;
  }
  return legacy[name](...args);
}

/** Adapter handed to `useCollectionActions`. */
export const legacyUi = Object.freeze({
  toggleCollectionPin: (collectionId) => callLegacy('toggleCollectionPin', collectionId),
  toggleTabPin: (collectionId, tabId) => callLegacy('toggleTabPin', collectionId, tabId),
  renameCollection: (collectionId, name) => callLegacy('renameCollection', collectionId, name),
  deleteCollection: (collectionId) => callLegacy('deleteCollection', collectionId),
  removeTab: (collectionId, tabId) => callLegacy('removeTab', collectionId, tabId),
  renameTab: (collectionId, tabId, title) => callLegacy('renameTab', collectionId, tabId, title),
  openSavedTab: (url, options) => callLegacy('openSavedTab', url, options),
  openAllTabs: (collectionId) => callLegacy('openAllTabs', collectionId),
  exportCollection: (collection) => callLegacy('exportCollection', collection),
  toast: (message, duration) => callLegacy('toast', message, duration),
});
