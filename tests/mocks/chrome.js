// Central chrome API mock (skill.md §6). Every test file uses this one — never hand-roll a
// mock locally, so a chrome API change only has to be modelled once.

/**
 * Install a chrome mock on globalThis.
 *
 * @param {Record<string, unknown>} [initial] Starting storage contents
 * @returns {{store: Record<string, unknown>, chrome: Record<string, any>}}
 */
export function installChromeMock(initial = {}) {
  const store = { ...initial };
  /** @type {(changes: Record<string, {newValue: unknown}>, area: string) => void} */
  let notify = () => {};

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '2.0.0' }),
      sendMessage: async () => ({ success: true }),
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
          notify(
            Object.fromEntries(
              Object.entries(values).map(([key, value]) => [key, { newValue: value }])
            ),
            'local'
          );
        },
      },
      onChanged: {
        /** @param {(changes: any, area: string) => void} listener */
        addListener: (listener) => {
          notify = listener;
        },
      },
    },
    tabs: {
      create: async () => ({ id: 1 }),
      query: async () => [],
    },
    tabGroups: {
      get: async () => ({ title: 'Group', color: 'blue', collapsed: false }),
      update: async () => {},
      TAB_ID_NONE: -1,
    },
  };

  globalThis.chrome = /** @type {any} */ (chrome);
  return { store, chrome };
}
