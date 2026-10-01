import { useEffect } from 'react';

/**
 * Keep `<html data-theme>` in step with the persisted theme.
 *
 * The settings modal writes the theme through the store instead of setting the attribute itself
 * (Phase 4), so the shell has to apply it: that is what makes a theme change from another panel or
 * from storage show up here too. `popup.js` still sets it once on DOMContentLoaded, before React
 * mounts, to avoid a flash of the wrong theme.
 *
 * Pass `undefined` while the store is still hydrating: the attribute then keeps whatever
 * `popup.js` set, instead of React overwriting the user's theme with the default before the
 * persisted value arrives.
 *
 * @param {string} [theme]
 * @returns {void}
 */
export function useThemeAttribute(theme) {
  useEffect(() => {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}
