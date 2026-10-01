import { LIMITS } from '../../../shared/constants.js';
import { isValidUrl } from '../../../lib/url.js';
import { mutate } from '../../../store/store.js';
import { addTabsToCollection } from '../lib/tabIntake.js';
import { consolidateDuplicates, findDuplicateCollections } from '../lib/duplicates.js';

/**
 * @typedef {object} TabIntakeOutcome
 * @property {number} added
 * @property {number} skippedByLimit
 * @property {number} skippedInvalid
 */

/**
 * @typedef {object} TabIntake
 * @property {(collectionId: string, title: string, url: string) => Promise<boolean>} addManualTab
 * @property {(collectionId: string, tabs: any[], groupsMeta?: Record<string, any>) => Promise<TabIntakeOutcome>} addSelectedTabs
 * @property {(collectionId: string) => Promise<void>} importTabs
 */

/**
 * Everything that puts tabs into a collection, moved off `popup.js`: the manual form, the
 * multi-select picker and the JSON import all funnel through `addSelectedTabs`, so the cap, the
 * pin rule and the duplicate confirmation exist once.
 *
 * The legacy versions used blocking `alert()`s; failures are toasts here, like the rest of the
 * React UI. `confirmDuplicates` is what the duplicate-URL dialog answers — it is injected because
 * the dialog lives a level up, where it can stack on top of the add-tabs modal.
 *
 * @param {object} options
 * @param {import('../../../store/schema.js').Collection[]} options.collections
 * @param {(url: string, duplicates: {collectionId: string, collectionName: string}[]) => Promise<boolean>} options.confirmDuplicates
 * @param {(message: string, duration?: number) => void} options.toast
 * @returns {TabIntake}
 */
export function useTabIntake({ collections, confirmDuplicates, toast }) {
  /**
   * One queued write for a batch of tabs, reporting what the mutator actually did.
   *
   * @param {string} collectionId
   * @param {any[]} tabs
   * @param {Record<string, any>} [groupsMeta]
   * @returns {Promise<TabIntakeOutcome>}
   */
  async function commit(collectionId, tabs, groupsMeta = {}) {
    let outcome = { added: 0, skippedByLimit: 0, skippedInvalid: 0 };
    await mutate((draft) => {
      outcome = addTabsToCollection(draft, collectionId, tabs, groupsMeta);
    });
    return outcome;
  }

  /**
   * Warn when a batch was cut short by the 200-tab cap. The legacy code alerted here; a toast
   * keeps the panel responsive and matches how the React list reports its refusals.
   *
   * @param {TabIntakeOutcome} outcome
   */
  function reportTruncation(outcome) {
    if (outcome.skippedByLimit > 0) {
      toast(
        `Added ${outcome.added} tabs. ${outcome.skippedByLimit} tabs skipped because the collection cannot exceed ${LIMITS.MAX_TABS_PER_COLLECTION} tabs.`
      );
    }
    if (outcome.skippedInvalid > 0) {
      console.warn(`[dialogs] ${outcome.skippedInvalid} tabs had invalid URLs and were skipped`);
    }
  }

  /**
   * @param {string} collectionId
   * @param {any[]} tabs
   * @param {Record<string, any>} [groupsMeta]
   * @returns {Promise<TabIntakeOutcome>}
   */
  async function addSelectedTabs(collectionId, tabs, groupsMeta = {}) {
    const valid = (tabs || []).filter((tab) => isValidUrl(tab?.url));
    if (valid.length === 0) return { added: 0, skippedByLimit: 0, skippedInvalid: 0 };

    const fresh = [];
    const duplicateEntries = [];
    for (const tab of valid) {
      const duplicates = findDuplicateCollections(tab.url, collections);
      if (duplicates.length > 0) duplicateEntries.push({ tab, duplicates });
      else fresh.push(tab);
    }

    let confirmed = [];
    if (duplicateEntries.length > 0) {
      const label =
        duplicateEntries.length === 1
          ? duplicateEntries[0].tab.url
          : `${duplicateEntries.length} URLs`;
      const proceed = await confirmDuplicates(label, consolidateDuplicates(duplicateEntries));
      if (proceed) confirmed = duplicateEntries.map((entry) => entry.tab);
    }

    const toAdd = [...fresh, ...confirmed];
    if (toAdd.length === 0) return { added: 0, skippedByLimit: 0, skippedInvalid: 0 };

    const outcome = await commit(collectionId, toAdd, groupsMeta);
    reportTruncation(outcome);
    return outcome;
  }

  return {
    async addManualTab(collectionId, title, url) {
      const trimmedUrl = String(url ?? '').trim();
      if (!isValidUrl(trimmedUrl)) {
        toast('Please enter a valid URL (e.g., https://example.com)');
        return false;
      }

      const duplicates = findDuplicateCollections(trimmedUrl, collections);
      if (duplicates.length > 0 && !(await confirmDuplicates(trimmedUrl, duplicates))) {
        return false;
      }

      const outcome = await commit(collectionId, [{ title, url: trimmedUrl }]);
      if (outcome.skippedByLimit > 0) {
        toast(
          `Cannot add more tabs. Maximum ${LIMITS.MAX_TABS_PER_COLLECTION} tabs per collection.`
        );
        return false;
      }
      return outcome.added > 0;
    },

    addSelectedTabs,

    async importTabs(collectionId) {
      const file = await pickJsonFile();
      if (!file) return;

      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast('Failed to parse file. Make sure it is a valid JSON file.');
        return;
      }

      // Both the old format (a bare array) and the export format (an object with `tabs`).
      const tabs = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.tabs)
          ? parsed.tabs
          : null;
      if (!tabs) {
        toast(
          'Invalid file format. The file must contain an array of tabs or a tabs backup object.'
        );
        return;
      }

      const valid = tabs.filter((tab) => tab && typeof tab === 'object' && tab.url);
      if (valid.length === 0) {
        toast('No valid tabs found in the imported file.');
        return;
      }

      const outcome = await addSelectedTabs(collectionId, valid);
      if (outcome.added > 0) toast(`Imported ${outcome.added} tabs successfully`);
    },
  };
}

/**
 * Open the file picker and resolve with the chosen file, or null when the user cancels.
 *
 * @returns {Promise<File|null>}
 */
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    // Chrome fires `cancel` when the picker is dismissed; without it the promise would hang.
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
