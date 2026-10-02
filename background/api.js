// Cross-browser API handle (skill.md §5.4). Chromium is the only supported target today, but the
// worker has always preferred `browser` when a polyfill is present.
//
// This is a proxy rather than a captured constant on purpose: a polyfill can install `browser`
// after this module evaluates, and the test setup swaps `globalThis.chrome` between cases
// (`tests/setup.js`), so every access has to resolve the global at call time.
export const api = new Proxy(/** @type {any} */ ({}), {
  /**
   * @param {object} _target
   * @param {string|symbol} property
   */
  get(_target, property) {
    const namespace = typeof browser !== 'undefined' ? browser : chrome;
    return Reflect.get(namespace, property);
  },
});
