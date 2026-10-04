// Central chrome API mock (skill.md §6). Every test file uses this one — never hand-roll a
// mock locally, so a chrome API change only has to be modelled once.
//
// The manifest is imported rather than copied, so `runtime.getManifest()` reports the real extension
// name and version. A hard-coded pair here was one of several places the version lived, and it
// drifted from `manifest.json` silently; `tests/version-alignment.test.js` guards the rest.
import manifest from '../../manifest.json';

/**
 * Install a chrome mock on globalThis.
 *
 * @param {Record<string, unknown>} [initial] Starting storage contents
 * @returns {{store: Record<string, unknown>, chrome: Record<string, any>}}
 */
export function installChromeMock(initial = {}) {
  const store = { ...initial };
  /** @type {Set<(changes: Record<string, {newValue: unknown}>, area: string) => void>} */
  const changeListeners = new Set();
  /** @type {Set<(tabId: number, changeInfo: Record<string, unknown>, tab: Record<string, unknown>) => void>} */
  const tabUpdateListeners = new Set();

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({
        name: manifest.name,
        version: manifest.version,
        oauth2: manifest.oauth2,
      }),
      sendMessage: async () => ({ success: true }),
      // Registration-only in tests unless a listener set is needed; the worker imports its
      // modules for their pure exports, and a module-level addListener must not throw.
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: {
        /**
         * @param {string|string[]|Record<string, unknown>|null} [keys]
         * @returns {Promise<Record<string, unknown>>}
         */
        get: async (keys) => {
          if (keys === undefined || keys === null) return { ...store };
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            const result = {};
            for (const key of keys) result[key] = store[key];
            return result;
          }
          const result = {};
          for (const [key, fallback] of Object.entries(keys)) {
            result[key] = store[key] === undefined ? fallback : store[key];
          }
          return result;
        },
        /** @param {Record<string, unknown>} values */
        set: async (values) => {
          Object.assign(store, values);
          const changes = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, { newValue: value }])
          );
          for (const listener of changeListeners) listener(changes, 'local');
        },
        /** @param {string|string[]} keys */
        remove: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          /** @type {Record<string, {newValue: undefined}>} */
          const changes = {};
          for (const key of list) {
            delete store[key];
            changes[key] = { newValue: undefined };
          }
          for (const listener of changeListeners) listener(changes, 'local');
        },
      },
      session: null,
      onChanged: {
        /** @param {(changes: any, area: string) => void} listener */
        addListener: (listener) => {
          changeListeners.add(listener);
        },
        /** @param {(changes: any, area: string) => void} listener */
        removeListener: (listener) => {
          changeListeners.delete(listener);
        },
      },
    },
    tabs: {
      create: async () => ({ id: 1 }),
      query: async () => [],
      group: async () => 99,
      onCreated: {
        /** @param {() => void} listener */
        addListener: (listener) => void listener,
      },
      onRemoved: {
        /** @param {() => void} listener */
        addListener: (listener) => void listener,
      },
      /** @param {number} tabId */
      get: async (tabId) => ({ id: tabId, active: false, status: 'complete' }),
      /** @param {number} _tabId */
      discard: async (_tabId) => {},
      onUpdated: {
        /** @param {(tabId: number, changeInfo: any, tab: any) => void} listener */
        addListener: (listener) => {
          tabUpdateListeners.add(listener);
        },
        /** @param {(tabId: number, changeInfo: any, tab: any) => void} listener */
        removeListener: (listener) => {
          tabUpdateListeners.delete(listener);
        },
        /**
         * Test-only helper: fire an update at every registered listener. Not part of the chrome
         * API, but the only way to drive code that waits for `tabs.onUpdated`.
         *
         * @param {number} tabId
         * @param {Record<string, unknown>} [changeInfo]
         * @param {Record<string, unknown>} [tab]
         */
        emit: (tabId, changeInfo = {}, tab = { id: tabId, active: false }) => {
          for (const listener of tabUpdateListeners) listener(tabId, changeInfo, tab);
        },
      },
    },
    tabGroups: {
      get: async () => ({ title: 'Group', color: 'blue', collapsed: false }),
      update: async () => {},
      TAB_ID_NONE: -1,
    },
    windows: {
      getLastFocused: async () => ({ id: 1 }),
      onRemoved: {
        /** @param {() => void} listener */
        addListener: (listener) => void listener,
      },
      onFocusChanged: {
        /** @param {() => void} listener */
        addListener: (listener) => void listener,
      },
    },
    contextMenus: {
      create: () => {},
      removeAll: async () => {},
      onClicked: {
        /** @param {(info: any, tab: any) => void} listener */
        addListener: (listener) => void listener,
      },
    },
    action: {
      onClicked: {
        /** @param {(tab: any) => void} listener */
        addListener: (listener) => void listener,
      },
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
    },
    sidePanel: {
      open: async () => {},
    },
    alarms: {
      create: async () => {},
      clearAlarm: async () => {},
      onAlarm: {
        /** @param {(alarm: any) => void} listener */
        addListener: (listener) => void listener,
      },
    },
    identity: {
      getAuthToken: (_options, callback) => callback('test-token'),
      removeCachedAuthToken: (_options, callback) => callback(),
      getRedirectURL: () => 'https://test-extension-id.chromiumapp.org/',
      launchWebAuthFlow: (_options, callback) =>
        callback(
          'https://test-extension-id.chromiumapp.org/#access_token=test-token&token_type=Bearer&expires_in=3600'
        ),
    },
  };

  chrome.storage.session = chrome.storage.local;

  globalThis.chrome = /** @type {any} */ (chrome);
  return { store, chrome };
}
