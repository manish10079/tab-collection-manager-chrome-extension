// Legacy -> React seam. `popup.js` is a classic script, so it cannot import the store; a few
// legacy call sites still need to drive React-owned state (the global-search result click
// expands a collection, and keyboard shortcuts re-render the list). They call
// `window.__tcmReact` instead, which is published once on start-up below.
//
// Deliberately tiny: add a command only when a legacy call site genuinely needs it, and
// delete the whole file in Phase 5.
import { mutate } from '../store/store.js';
import { setCollectionExpanded } from '../features/collections/index.js';

/** Publish the commands the legacy runtime may call. Safe to call more than once. */
export function publishLegacyHandle() {
  globalThis.__tcmReact = {
    setCollectionExpanded: (collectionId, expanded) =>
      mutate((draft) => setCollectionExpanded(draft, collectionId, expanded)),
  };
}
