import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../../shared/storage-keys.js';

const EMPTY = Object.freeze({ history: [], ramSaverEnabled: false, loading: true });

/**
 * Read the worker-owned `sessionHistory` list plus the RAM Saver flag, and follow storage while the
 * dialog is open.
 *
 * Nothing here writes: `sessionHistory` belongs to the service worker (ADR-0004) and both keys are
 * read-only from the UI, so this deliberately bypasses the store's snapshot and its write queue.
 *
 * @param {boolean} [active]
 * @returns {{history: import('../../../store/schema.js').SessionBackup[], ramSaverEnabled: boolean, loading: boolean}}
 */
export function useSessionHistory(active = true) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    const keys = [STORAGE_KEYS.sessionHistory, STORAGE_KEYS.ramSaverEnabled];

    async function read() {
      try {
        const raw = await chrome.storage.local.get(keys);
        if (cancelled) return;
        setState({
          history: Array.isArray(raw[STORAGE_KEYS.sessionHistory])
            ? raw[STORAGE_KEYS.sessionHistory]
            : [],
          ramSaverEnabled: Boolean(raw[STORAGE_KEYS.ramSaverEnabled]),
          loading: false,
        });
      } catch (error) {
        console.error('[dialogs] failed to read session history:', error);
        if (!cancelled) setState({ history: [], ramSaverEnabled: false, loading: false });
      }
    }

    const handleChange = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[STORAGE_KEYS.sessionHistory] || changes[STORAGE_KEYS.ramSaverEnabled]) read();
    };

    read();
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, [active]);

  return state;
}
