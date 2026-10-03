// Global import/export as pure functions: the legacy `exportAllCollections` and
// `importAllCollections` lived in popup.js and mixed file I/O, validation and mutation in one
// blocker-heavy function. The collection payload and merge rules are unchanged
// (react-migration-plan.md §8, Phase 5.2); only the `alert()`s became toasts. Phase 8 adds a
// `folders` field so the hierarchy survives an export/import round trip — a legacy file without it
// still imports, and every imported collection falls back to the root.
import { LIMITS } from '../../../shared/constants.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { isBuiltInColor, normalizeCustomColors } from '../../../lib/colors.js';
import { partitionCollections, partitionTabs } from '../../../lib/sort.js';
import { isValidUrl } from '../../../lib/url.js';

/**
 * The global export payload. A legacy reader only looked at the two original fields, so an old
 * build still imports this file and a legacy file without `folders` still imports here. Folders and
 * the custom colour palette ride along so an export/import round trip restores the hierarchy and
 * the labels instead of flattening them; `color` is already on each collection/folder.
 *
 * @param {import('../../../store/schema.js').Collection[]} collections
 * @param {import('../../../store/schema.js').Folder[]} [folders]
 * @param {Array<{id: string, name: string, value: string}>} [customColors]
 * @param {Date} [now]
 * @returns {{exportedAt: string, collections: import('../../../store/schema.js').Collection[], folders: import('../../../store/schema.js').Folder[], customColors: Array<{id: string, name: string, value: string}>}}
 */
export function buildCollectionsExport(
  collections,
  folders = [],
  customColors = [],
  now = new Date()
) {
  return { exportedAt: now.toISOString(), collections, folders, customColors };
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

/**
 * The folders from an export object, or an empty list for a bare array / a legacy file without
 * them. Anything that is not an array is ignored, so a malformed field cannot break an import.
 *
 * @param {unknown} parsed
 * @returns {unknown[]}
 */
export function extractImportedFolders(parsed) {
  if (parsed && typeof parsed === 'object' && Array.isArray(/** @type {any} */ (parsed).folders)) {
    return /** @type {any} */ (parsed).folders;
  }
  return [];
}

/**
 * The custom colour palette from an export object, sanitized, or an empty list for a bare array / a
 * legacy file without one.
 *
 * @param {unknown} parsed
 * @returns {Array<{id: string, name: string, value: string}>}
 */
export function extractImportedCustomColors(parsed) {
  if (parsed && typeof parsed === 'object') {
    return normalizeCustomColors(/** @type {any} */ (parsed).customColors);
  }
  return [];
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

/** Folder names compare the way collection names do: trimmed, lower-cased, runs of space collapsed. */
function normalizeFolderName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * The colour id an imported folder/collection may carry, remapped onto the merged palette.
 *
 * A built-in id is always valid. A custom id resolves only when the file carried that colour (or a
 * same-named one already exists here), so an import can never leave an item pointing at a colour
 * the palette does not have.
 *
 * @param {unknown} rawColor
 * @param {Map<string, string>} colorIdMap Imported colour id -> merged palette id
 * @returns {string|null}
 */
function resolveImportedColor(rawColor, colorIdMap) {
  if (typeof rawColor !== 'string' || !rawColor) return null;
  if (isBuiltInColor(rawColor)) return rawColor;
  return colorIdMap.get(rawColor) ?? null;
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
 * @param {number|null} [chromeGroupId] Group the tab belonged to, or null when ungrouped
 * @returns {import('../../../store/schema.js').TabItem}
 */
function makeTab(tab, pinned, index, chromeGroupId = null) {
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
    // Carried through the import so a restored collection can rebuild its Chrome tab groups. The
    // importer used to drop this field, which silently flattened every group in a backup.
    chromeGroupId,
    addedAt: tab.addedAt || Date.now(),
  };
}

/**
 * One group's presentation, defaulted the way the worker's `captureGroupMeta` writes it. Anything
 * that is not a usable object is dropped rather than trusted.
 *
 * @param {unknown} value
 * @returns {import('../../../store/schema.js').ChromeGroupMeta|null}
 */
function sanitizeGroupMeta(value) {
  if (!value || typeof value !== 'object') return null;
  const meta = /** @type {{title?: unknown, color?: unknown, collapsed?: unknown}} */ (value);
  return {
    title: typeof meta.title === 'string' ? meta.title : '',
    color: typeof meta.color === 'string' && meta.color ? meta.color : 'grey',
    collapsed: Boolean(meta.collapsed),
  };
}

/**
 * A collection's `chromeGroups` map from an imported file, with every entry sanitized. A malformed
 * field imports as no groups, which is the same outcome as a backup taken before groups were
 * carried — the tabs still arrive, they just arrive ungrouped.
 *
 * @param {unknown} value
 * @returns {Record<string, import('../../../store/schema.js').ChromeGroupMeta>}
 */
function sanitizeGroups(value) {
  const groups = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return groups;
  for (const [key, meta] of Object.entries(value)) {
    // Only a non-negative integer key is reachable: a tab points at its group by number, and the
    // worker looks the map up with that number stringified.
    if (!/^\d+$/.test(key)) continue;
    const clean = sanitizeGroupMeta(meta);
    if (clean !== null) groups[key] = clean;
  }
  return groups;
}

/**
 * Resolve one tab's group into a group id that exists in `targetGroups`, adding the metadata when
 * it is not there yet.
 *
 * The remap exists because group ids only have to be unique **within a collection**, and a merge
 * adds imported tabs to a collection that already has its own. Reusing an identical group keeps a
 * re-import idempotent; otherwise the imported group takes the next free integer, so it can never
 * overwrite a group the collection already had.
 *
 * @param {unknown} rawGroupId        The imported tab's `chromeGroupId`
 * @param {Record<string, import('../../../store/schema.js').ChromeGroupMeta>} importedGroups
 * @param {Record<string, import('../../../store/schema.js').ChromeGroupMeta>} targetGroups
 * @param {Map<string, number>} remap  Imported group key -> target group id
 * @returns {number|null}
 */
function mapGroupId(rawGroupId, importedGroups, targetGroups, remap) {
  const sourceKey = rawGroupId === null || rawGroupId === undefined ? null : String(rawGroupId);
  if (sourceKey === null || !/^\d+$/.test(sourceKey)) return null;

  const meta = importedGroups[sourceKey];
  if (!meta) return null; // The tab pointed at a group the file did not carry.
  if (remap.has(sourceKey)) return remap.get(sourceKey) ?? null;

  for (const [key, existing] of Object.entries(targetGroups)) {
    if (
      existing.title === meta.title &&
      existing.color === meta.color &&
      existing.collapsed === meta.collapsed
    ) {
      remap.set(sourceKey, Number(key));
      return Number(key);
    }
  }

  // Prefer the file's own key when it is still free, so importing into a fresh collection round
  // trips unchanged. On a merge the key may already mean something else, and then — and only then —
  // the imported group takes the next free integer.
  const targetKey =
    sourceKey in targetGroups ? nextGroupKey(new Set(Object.keys(targetGroups))) : sourceKey;
  targetGroups[targetKey] = meta;
  remap.set(sourceKey, Number(targetKey));
  return Number(targetKey);
}

/**
 * A group key that is free in `taken`. Chrome's own ids are small integers, so the next integer
 * above the highest one in use keeps the imported shape familiar and the result deterministic.
 *
 * @param {Set<string>} taken
 * @returns {string}
 */
function nextGroupKey(taken) {
  let candidate = 1;
  for (const key of taken) {
    const numeric = Number(key);
    if (Number.isInteger(numeric) && numeric >= candidate) candidate = numeric + 1;
  }
  return String(candidate);
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
 * Folders are restored too: an imported folder reuses a same-named draft folder (or is created),
 * and an imported collection's `folderId` is remapped onto it. A collection pointing at a folder
 * the file did not carry stays at the root, so an import can never orphan a collection.
 *
 * Chrome tab groups come back with the tabs: each tab keeps its `chromeGroupId` and the groups
 * those ids reference are carried into `chromeGroups`. On a merge the ids are remapped onto keys
 * that are free in the target collection, so an import can never overwrite a group the existing
 * tabs still point at; an identical group is reused instead, which keeps a re-import idempotent.
 *
 * Colour labels come back too: an item's `color` is restored when the file carried it, and when it
 * is a custom colour it is remapped onto the palette the import merges (a same-named existing
 * colour is reused, so the labels keep meaning the same thing). A label no longer in the palette is
 * dropped rather than trusted, so an import cannot create a dangling reference.
 *
 * @param {import('../../../store/schema.js').AppState} draft
 * @param {unknown[]} importedCollections
 * @param {unknown[]} [importedFolders]
 * @param {unknown[]} [importedColors]
 * @returns {ImportOutcome}
 */
export function mergeImportedCollections(
  draft,
  importedCollections = [],
  importedFolders = [],
  importedColors = []
) {
  /** @type {ImportOutcome} */
  const outcome = { added: 0, merged: 0, skipped: 0 };
  const maxPinnedTabs = Number(draft.settings.maxPinnedTabs);
  const maxPinnedCollections = Number(draft.settings.maxPinnedCollections);
  // A legacy draft (or file) may not carry folders at all.
  if (!Array.isArray(draft.folders)) draft.folders = [];

  // Merge the imported palette first, so a label below can resolve against it. A colour already
  // present by id or name is reused (its id wins), which keeps a re-import idempotent.
  if (!Array.isArray(draft.settings.customColors)) draft.settings.customColors = [];
  const palette = draft.settings.customColors;
  /** @type {Map<string, string>} */
  const colorIdMap = new Map();
  for (const color of normalizeCustomColors(importedColors)) {
    const existing = palette.find(
      (entry) =>
        entry.id === color.id || normalizeFolderName(entry.name) === normalizeFolderName(color.name)
    );
    if (existing) {
      colorIdMap.set(color.id, existing.id);
      continue;
    }
    if (palette.length >= LIMITS.MAX_CUSTOM_COLORS) continue;
    palette.push(color);
    colorIdMap.set(color.id, color.id);
  }

  // Map each imported folder id to a draft folder id, reusing a same-named folder so importing into
  // an existing profile does not duplicate one.
  /** @type {Map<string, string>} */
  const folderIdMap = new Map();
  for (const raw of importedFolders) {
    if (!raw || typeof raw !== 'object') continue;
    const importedFolder = /** @type {{id?: unknown, name?: unknown, color?: unknown}} */ (raw);
    if (!importedFolder.id || !importedFolder.name) continue;

    const color = resolveImportedColor(importedFolder.color, colorIdMap);
    const name = String(importedFolder.name).trim();
    const existing = draft.folders.find(
      (folder) => normalizeFolderName(folder.name) === normalizeFolderName(name)
    );
    if (existing) {
      folderIdMap.set(String(importedFolder.id), existing.id);
      // Adopt the file's label only when this folder has none, so a merge never relabels one.
      if (!existing.color && color) existing.color = color;
      continue;
    }
    if (draft.folders.length >= LIMITS.MAX_FOLDERS) continue;

    const id = crypto.randomUUID();
    draft.folders.push({
      id,
      name,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
    });
    folderIdMap.set(String(importedFolder.id), id);
  }

  for (const raw of importedCollections) {
    if (!isValidImportedCollection(raw) || /** @type {any} */ (raw).id === CURRENT_SESSION_ID) {
      outcome.skipped += 1;
      continue;
    }

    const imported =
      /** @type {{name: string, tabs: any[], pinned?: boolean, folderId?: string|null, color?: unknown, chromeGroups?: unknown}} */ (
        raw
      );
    const importedColor = resolveImportedColor(imported.color, colorIdMap);
    const existing = draft.collections.find(
      (collection) => String(collection.name).toLowerCase() === String(imported.name).toLowerCase()
    );

    if (existing) {
      const before = existing.tabs.length;
      let pinnedTabs = existing.tabs.filter((tab) => tab.pinned).length;

      // Groups the incoming tabs reference are merged into the collection's own map, so a tab
      // appended here can still rebuild the group it came from.
      const importedGroups = sanitizeGroups(/** @type {any} */ (imported).chromeGroups);
      const targetGroups = { ...(existing.chromeGroups || {}) };
      /** @type {Map<string, number>} */
      const remap = new Map();

      for (const tab of imported.tabs) {
        if (!isValidUrl(tab?.url)) continue;
        if (existing.tabs.length >= LIMITS.MAX_TABS_PER_COLLECTION) break;
        if (existing.tabs.some((saved) => normalizeUrl(saved.url) === normalizeUrl(tab.url)))
          continue;

        let pinned = Boolean(tab.pinned);
        if (pinned && pinnedTabs >= maxPinnedTabs) pinned = false;
        if (pinned) pinnedTabs += 1;

        const groupId = mapGroupId(tab.chromeGroupId, importedGroups, targetGroups, remap);
        existing.tabs.push(makeTab(tab, pinned, existing.tabs.length, groupId));
      }

      if (Object.keys(targetGroups).length > 0) existing.chromeGroups = targetGroups;
      existing.tabs = partitionTabs(existing.tabs);
      // Adopt the file's label only when this collection has none, so a merge never relabels one.
      if (!existing.color && importedColor) existing.color = importedColor;
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

    // Only the groups a surviving tab still references are kept, under the same integer keys, so
    // this new collection is self-contained and an export of it looks like the file it came from.
    const importedGroups = sanitizeGroups(/** @type {any} */ (imported).chromeGroups);
    /** @type {Record<string, import('../../../store/schema.js').ChromeGroupMeta>} */
    const chromeGroups = {};
    /** @type {Map<string, number>} */
    const remap = new Map();

    let pinnedTabs = 0;
    const tabs = imported.tabs
      .filter((tab) => isValidUrl(tab?.url))
      .map((tab, index) => {
        let tabPinned = Boolean(tab.pinned);
        if (tabPinned && pinnedTabs >= maxPinnedTabs) tabPinned = false;
        if (tabPinned) pinnedTabs += 1;
        const groupId = mapGroupId(tab.chromeGroupId, importedGroups, chromeGroups, remap);
        // The tab's own position, not a constant: a stored `index` of 0 for every tab was a lie
        // that any future consumer of the field would have inherited.
        return makeTab(tab, tabPinned, index, groupId);
      })
      .slice(0, LIMITS.MAX_TABS_PER_COLLECTION);

    // Only a folder this file actually carried can receive the collection.
    const folderId =
      imported.folderId && folderIdMap.has(String(imported.folderId))
        ? folderIdMap.get(String(imported.folderId))
        : null;

    draft.collections.push({
      id: crypto.randomUUID(),
      name: imported.name,
      pinned,
      tabs: partitionTabs(tabs),
      // Restored with the tabs, so "Open All Tabs" rebuilds the Chrome tab groups the backup was
      // taken with rather than opening a flat list of pages.
      chromeGroups,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isExpanded: false,
      folderId,
      color: importedColor,
    });
    outcome.added += 1;
  }

  draft.collections = partitionCollections(draft.collections);
  return outcome;
}
