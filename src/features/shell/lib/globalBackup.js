// Global import/export as pure functions: the legacy `exportAllCollections` and
// `importAllCollections` lived in popup.js and mixed file I/O, validation and mutation in one
// blocker-heavy function. The payload shape and the merge rules are unchanged
// (react-migration-plan.md §8, Phase 5.2); only the `alert()`s became toasts.
import { LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { partitionCollections, partitionTabs } from '../../../lib/sort.js';
import { isValidUrl } from '../../../lib/url.js';

/**
 * The global export payload. The legacy file carried the same two fields, so an old backup still
 * imports and a new one stays readable by an older build.
 *
 * @param {import('../../../store/schema.js').Collection[]} collections
 * @param {Date} [now]
 * @returns {{exportedAt: string, collections: import('../../../store/schema.js').Collection[]}}
 */
export function buildCollectionsExport(collections, now = new Date()) {
  return { exportedAt: now.toISOString(), collections };
}

/**
 * Accept both shapes the legacy importer understood: a bare array of collections, or the export
 * object wrapping one. Returns the list, or null when the file is neither.
 *
 * @param {unknown} parsed
 * @returns {unknown[]|null}
 */
export function extractImportedCollections(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray(/** @type {any} */ (parsed).collections)
  ) {
    return /** @type {any} */ (parsed).collections;
  }
  return null;
}

/** A collection entry the importer will accept: a name and a tabs array. */
export function isValidImportedCollection(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    Boolean(/** @type {any} */ (entry).name) &&
    Array.isArray(/** @type {any} */ (entry).tabs)
  );
}

/** URLs compare the way the legacy duplicate check compared them: trimmed, lower-cased, no trailing slash. */
function normalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

/**
 * @param {{title?: string, url?: string, addedAt?: number}} tab
 * @param {boolean} pinned
 * @param {number} index
 * @returns {import('../../../store/schema.js').TabItem}
 */
function makeTab(tab, pinned, index) {
  return {
    id: crypto.randomUUID(),
    title: String(tab.title ?? '').trim() || 'Untitled',
    url: /** @type {string} */ (tab.url),
    pinned,
    index,
    windowId: 0,
    active: false,
    discarded: false,
    highlighted: false,
    addedAt: tab.addedAt || Date.now(),
  };
}

/**
 * @typedef {object} ImportOutcome
 * @property {number} added    New collections created
 * @property {number} merged   Existing collections that gained tabs
 * @property {number} skipped  Entries that were not importable
 */

/**
 * Merge an imported backup into the draft. Preserves the legacy rules: a `current-session` entry is
 * never imported, a matching name (case-insensitive) merges tabs into the existing collection,
 * duplicate URLs and the 200-tab cap are respected, a tab past the pinned limit lands unpinned, and
 * a collection past the pinned-collection limit lands unpinned.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {unknown[]} importedCollections
 * @returns {ImportOutcome}
 */
export function mergeImportedCollections(draft, importedCollections = []) {
  /** @type {ImportOutcome} */
  const outcome = { added: 0, merged: 0, skipped: 0 };
  const maxPinnedTabs = Number(draft.settings.maxPinnedTabs);
  const maxPinnedCollections = Number(draft.settings.maxPinnedCollections);

  for (const raw of importedCollections) {
    if (!isValidImportedCollection(raw) || /** @type {any} */ (raw).id === CURRENT_SESSION_ID) {
      outcome.skipped += 1;
      continue;
    }

    const imported = /** @type {{name: string, tabs: any[], pinned?: boolean}} */ (raw);
    const existing = draft.collections.find(
      (collection) => String(collection.name).toLowerCase() === String(imported.name).toLowerCase()
    );

    if (existing) {
      const before = existing.tabs.length;
      let pinnedTabs = existing.tabs.filter((tab) => tab.pinned).length;

      for (const tab of imported.tabs) {
        if (!isValidUrl(tab?.url)) continue;
        if (existing.tabs.length >= LIMITS.MAX_TABS_PER_COLLECTION) break;
        if (existing.tabs.some((saved) => normalizeUrl(saved.url) === normalizeUrl(tab.url)))
          continue;

        let pinned = Boolean(tab.pinned);
        if (pinned && pinnedTabs >= maxPinnedTabs) pinned = false;
        if (pinned) pinnedTabs += 1;

        existing.tabs.push(makeTab(tab, pinned, existing.tabs.length));
      }

      existing.tabs = partitionTabs(existing.tabs);
      if (existing.tabs.length > before) {
        existing.updatedAt = Date.now();
        outcome.merged += 1;
      }
      continue;
    }

    let pinned = Boolean(imported.pinned);
    if (pinned) {
      const pinnedCollections = draft.collections.filter(
        (collection) => collection.pinned && collection.id !== CURRENT_SESSION_ID
      ).length;
      if (pinnedCollections >= maxPinnedCollections) pinned = false;
    }

    let pinnedTabs = 0;
    const tabs = imported.tabs
      .filter((tab) => isValidUrl(tab?.url))
      .map((tab) => {
        let tabPinned = Boolean(tab.pinned);
        if (tabPinned && pinnedTabs >= maxPinnedTabs) tabPinned = false;
        if (tabPinned) pinnedTabs += 1;
        return makeTab(tab, tabPinned, 0);
      })
      .slice(0, LIMITS.MAX_TABS_PER_COLLECTION);

    draft.collections.push({
      id: crypto.randomUUID(),
      name: imported.name,
      pinned,
      tabs: partitionTabs(tabs),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
    });
    outcome.added += 1;
  }

  draft.collections = partitionCollections(draft.collections);
  return outcome;
}
