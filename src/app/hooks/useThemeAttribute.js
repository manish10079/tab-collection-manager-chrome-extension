import { useEffect } from 'react';

/**
 * Keep `<html data-theme>` in step with the persisted theme.
 *
 * The settings modal writes the theme through the store instead of setting the attribute itself
 * (Phase 4), so the shell has to apply it: that is what makes a theme change from another panel or
 * from storage show up here too. Since Phase 5.3 this hook is the only place that sets the
 * attribute — the deleted boot script applied the same value at the same moment, right after the
 * first hydration.
 *
 * Pass `undefined` while the store is still hydrating, so React does not overwrite the user's theme
 * with the default before the persisted value arrives.
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
