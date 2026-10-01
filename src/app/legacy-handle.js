// Legacy -> React seam. `popup.js` is a classic script, so it cannot import the store; a few
// legacy call sites still need to drive React-owned state (the global-search result click expands
// a collection, keyboard shortcuts re-render the list, the header's settings button opens the
// React settings modal). They call `window.__tcmReact` instead, published once on start-up below.
//
// Deliberately tiny: add a command only when a legacy call site genuinely needs it, and delete
// the whole file in Phase 5.
import { mutate } from '../store/store.js';
import { setCollectionExpanded } from '../features/collections/index.js';

/** Replaced by the app once it mounts, so a click before then is a no-op instead of an error. */
let openSettings = () => {};

/** Publish the commands the legacy runtime may call. Safe to call more than once. */
export function publishLegacyHandle() {
  globalThis.__tcmReact = {
    setCollectionExpanded: (collectionId, expanded) =>
      mutate((draft) => setCollectionExpanded(draft, collectionId, expanded)),
    openSettings: () => openSettings(),
  };
}

/**
 * Let the app own the settings modal's visibility.
 *
 * @param {() => void} handler
 * @returns {() => void} Unregister, for unmount
 */
export function registerSettingsOpener(handler) {
  openSettings = handler;
  return () => {
    if (openSettings === handler) openSettings = () => {};
  };
}
