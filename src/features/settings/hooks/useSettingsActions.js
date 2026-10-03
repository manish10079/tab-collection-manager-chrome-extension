import { mutate } from '../../../store/store.js';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import {
  addCustomColor as addCustomColorDraft,
  removeCustomColor as removeCustomColorDraft,
} from '../lib/customColors.js';

/** Bounds the legacy number inputs enforced, kept so the clamping rules stay in one place. */
const LIMIT_BOUNDS = Object.freeze({
  collections: { min: 1, max: 20 },
  tabs: { min: 1, max: 50 },
});

/**
 * @typedef {object} SettingsActions
 * @property {(key: string, value: unknown) => Promise<void>} setSetting
 * @property {(enabled: boolean) => Promise<void>} setAutoSave
 * @property {(theme: string) => Promise<void>} setTheme
 * @property {(enabled: boolean) => Promise<void>} setRamSaver
 * @property {(enabled: boolean, limit: number) => Promise<void>} setEnforcePinnedCollections
 * @property {(enabled: boolean, limit: number) => Promise<void>} setEnforcePinnedTabs
 * @property {(kind: 'collections' | 'tabs', value: number) => Promise<number>} setPinnedLimit
 * @property {(name: string, value: string) => Promise<'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'>} addCustomColor
 * @property {(id: string) => Promise<boolean>} removeCustomColor
 * @property {(message: string, duration?: number) => void} toast
 */

/**
 * Everything the settings modal can change. Each action writes through the store's queue — the
 * settings modal is the last place that used to write `chrome.storage.local` directly, and it no
 * longer does (ADR-0004, ADR-0005).
 *
 * @param {{toast: (message: string, duration?: number) => void}} deps Injected by the app layer
 * @returns {SettingsActions}
 */
export function useSettingsActions({ toast }) {
  /** @param {string} key @param {unknown} value */
  const setSetting = (key, value) =>
    mutate((draft) => {
      draft.settings[key] = value;
    });

  return {
    setSetting,

    setAutoSave: async (enabled) => {
      // Auto-save always targets Current Session, exactly like the legacy toggle.
      await setSetting('autoSaveCollectionId', enabled ? CURRENT_SESSION_ID : null);
      toast(enabled ? 'Auto-Save enabled' : 'Auto-Save disabled');
    },

    setTheme: async (theme) => {
      await setSetting('theme', theme);
      toast(theme === 'light' ? 'Light Mode enabled' : 'Dark Mode enabled');
    },

    setRamSaver: async (enabled) => {
      await setSetting('ramSaverEnabled', enabled);
      toast(
        enabled
          ? '💾 RAM Saver ON — tabs will lazy‑load on click'
          : 'RAM Saver OFF — tabs load normally'
      );
    },

    setEnforcePinnedCollections: async (enabled, limit) => {
      await setSetting('enforceMaxPinnedCollections', enabled);
      toast(
        enabled
          ? `Pinned collection limit enabled (max ${limit})`
          : 'Pinned collection limit removed'
      );
    },

    setEnforcePinnedTabs: async (enabled, limit) => {
      await setSetting('enforceMaxPinnedTabs', enabled);
      toast(
        enabled
          ? `Pinned tab limit enabled (max ${limit} per collection)`
          : 'Pinned tab limit removed'
      );
    },

    /**
     * Clamp and store a pinned limit. Returns what was stored so the input can show it.
     *
     * @param {'collections' | 'tabs'} kind
     * @param {number} value
     * @returns {Promise<number>}
     */
    setPinnedLimit: async (kind, value) => {
      const { min, max } = LIMIT_BOUNDS[kind];
      const parsed = Number.parseInt(String(value), 10);
      const clamped = Number.isNaN(parsed) ? min : Math.min(Math.max(parsed, min), max);
      await setSetting(kind === 'tabs' ? 'maxPinnedTabs' : 'maxPinnedCollections', clamped);
      toast(
        kind === 'tabs'
          ? `Pinned tabs limit set to ${clamped} per collection`
          : `Pinned collections limit set to ${clamped}`
      );
      return clamped;
    },

    /**
     * Add a colour to the palette. The refusal reasons are reported so the form can show one.
     *
     * @param {string} name
     * @param {string} value
     * @returns {Promise<'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'>}
     */
    addCustomColor: async (name, value) => {
      /** @type {'added'|'empty'|'too-long'|'invalid'|'duplicate'|'too-many'} */
      let outcome = 'invalid';
      await mutate((draft) => {
        outcome = addCustomColorDraft(draft, name, value, `custom-${crypto.randomUUID()}`);
      });

      if (outcome === 'added') toast(`Color "${String(name).trim()}" added`);
      return outcome;
    },

    /**
     * Remove a custom colour; every folder/collection using it becomes unlabelled.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    removeCustomColor: async (id) => {
      let removed = false;
      await mutate((draft) => {
        removed = removeCustomColorDraft(draft, id);
      });
      if (removed) toast('Color removed');
      return removed;
    },

    toast: (message, duration) => toast(message, duration),
  };
}
