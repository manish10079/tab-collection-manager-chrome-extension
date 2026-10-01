// Housekeeping a panel open should not keep as-is. Lifted out of the deleted `popup.js` in
// Phase 5.3 (react-migration-plan.md §8): it is store-level normalisation, not UI logic, so it
// lives beside the schema and is applied through the store's own write queue.

/**
 * Collapse every collection, backfill a missing `addedAt` on every saved tab, and drop an
 * Auto-Save id that points at a collection that is gone.
 *
 * Idempotent: returns whether anything changed, so the caller only writes when it has to. The
 * `addedAt` backfill spreads tabs a second apart from their collection's `createdAt`, matching the
 * legacy behaviour so dates stay stable across opens.
 *
 * @param {import('./schema.js').AppState} draft
 * @returns {boolean} Whether the draft was changed
 */
export function normalizeOpenedState(draft) {
  let changed = false;

  for (const collection of draft.collections) {
    if (collection.isExpanded) {
      collection.isExpanded = false;
      changed = true;
    }

    const createdAt = collection.createdAt || Date.now();
    (collection.tabs || []).forEach((tab, index) => {
      if (!tab.addedAt) {
        tab.addedAt = createdAt + index * 1000;
        changed = true;
      }
    });
  }

  const autoSaveId = draft.settings.autoSaveCollectionId;
  if (autoSaveId) {
    const exists = draft.collections.some((collection) => collection.id === autoSaveId);
    if (!exists) {
      console.warn(`[store] dropping stale auto-save collection id: ${autoSaveId}`);
      draft.settings.autoSaveCollectionId = null;
      changed = true;
    }
  }

  return changed;
}
