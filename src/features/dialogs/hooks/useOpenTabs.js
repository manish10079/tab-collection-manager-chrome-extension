import { useCallback, useEffect, useState } from 'react';
import { listOpenTabs } from '../lib/openTabs.js';

/**
 * The current window's tabs, for the add-tabs picker. The list is queried fresh every time the
 * picker opens (the legacy modal re-rendered it on open for the same reason) and never becomes a
 * second source of truth: the checkbox selection is the only state the picker owns.
 *
 * @param {boolean} [active] Skip the query until the picker is actually on screen
 * @returns {{tabs: any[], groupsMeta: Record<string, import('../../../store/schema.js').ChromeGroupMeta>, loading: boolean}}
 */
export function useOpenTabs(active = true) {
  const [state, setState] = useState({ tabs: [], groupsMeta: {}, loading: true });

  const reload = useCallback(async () => {
    try {
      const { tabs, groupsMeta } = await listOpenTabs();
      setState({ tabs, groupsMeta, loading: false });
    } catch (error) {
      console.error('[dialogs] failed to list open tabs:', error);
      setState({ tabs: [], groupsMeta: {}, loading: false });
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setState((current) => (current.loading ? current : { ...current, loading: true }));
    reload();
  }, [active, reload]);

  return state;
}
