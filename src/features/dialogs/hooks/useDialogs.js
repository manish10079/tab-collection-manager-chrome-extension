import { useCallback, useRef, useState } from 'react';
import { useCollections } from '../../../store/hooks.js';
import { useTabIntake } from './useTabIntake.js';

/**
 * @typedef {object} DialogsState
 * @property {string|null} addTabsFor            Collection the add-tabs modal is open for
 * @property {boolean} historyOpen
 * @property {{session: object, label: string}|null} sessionDetails
 * @property {boolean} shortcutsOpen
 * @property {{url: string, duplicates: {collectionId: string, collectionName: string}[]}|null} duplicateRequest
 */

/**
 * @typedef {object} DialogActions
 * @property {(collectionId: string) => void} addTabs
 * @property {(collectionId: string) => Promise<void>} importTabs
 * @property {() => void} openHistory
 * @property {() => void} openShortcuts
 * @property {() => void} closeAddTabs
 * @property {() => void} closeHistory
 * @property {() => void} closeShortcuts
 * @property {(session: object, label: string) => void} openDetails
 * @property {() => void} closeDetails
 * @property {(session: object) => Promise<void>} openAllFromHistory
 */

/**
 * `useDialogs` owns every React modal's visibility, so `App` stays a shell and callers (the shell's
 * header, controls bar and global shortcuts) only have to ask for one by name. Nothing here
 * renders: `DialogHost` reads this object, which keeps the state and the markup independently
 * testable.
 *
 * The duplicate-URL confirmation is a Promise the intake flow awaits, backed by a resolver held in
 * a ref rather than in state — React must never have to replay resolving a promise on a re-render.
 *
 * @param {object} options
 * @param {(message: string, duration?: number) => void} options.toast
 * @returns {{state: DialogsState, actions: DialogActions, intake: import('./useTabIntake.js').TabIntake, confirmDuplicates: (url: string, duplicates: {collectionId: string, collectionName: string}[]) => Promise<boolean>, settleDuplicates: (result: boolean) => void}}
 */
export function useDialogs({ toast }) {
  const collections = useCollections();

  const [addTabsFor, setAddTabsFor] = useState(/** @type {string|null} */ (null));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionDetails, setSessionDetails] = useState(
    /** @type {{session: object, label: string}|null} */ (null)
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [duplicateRequest, setDuplicateRequest] = useState(
    /** @type {{url: string, duplicates: {collectionId: string, collectionName: string}[]}|null} */ (
      null
    )
  );
  /** @type {import('react').MutableRefObject<((result: boolean) => void)|null>} */
  const duplicateResolver = useRef(null);

  const confirmDuplicates = useCallback(
    (url, duplicates) =>
      new Promise((resolve) => {
        duplicateResolver.current = resolve;
        setDuplicateRequest({ url, duplicates });
      }),
    []
  );

  const settleDuplicates = useCallback((result) => {
    const resolve = duplicateResolver.current;
    duplicateResolver.current = null;
    setDuplicateRequest(null);
    if (resolve) resolve(result);
  }, []);

  const intake = useTabIntake({ collections, confirmDuplicates, toast });

  /**
   * Re-open a history snapshot through the worker, the same path "Open All Tabs" on a collection
   * uses. Routing it here rather than creating the tabs from the panel is what lets the snapshot's
   * Chrome tab groups be rebuilt: only the worker owns `restoreSession` (ADR-0004), and it is the
   * single implementation of the group rebuild, so no restore path can silently lose groups.
   *
   * `ramSaverEnabled` is read by the worker from storage, which is where this flag lives.
   */
  const openAllFromHistory = useCallback(
    async (session) => {
      const tabs = Array.isArray(session?.tabs) ? session.tabs : [];
      const restorable = tabs.filter((tab) => {
        const url = String(tab?.url ?? '').trim();
        return url && url !== 'about:blank';
      }).length;
      if (restorable === 0) {
        toast('Nothing to restore in that session.', 1500);
        return;
      }

      try {
        await chrome.runtime.sendMessage({
          command: 'restoreSession',
          backupData: {
            tabs,
            chromeGroups: session?.chromeGroups ?? {},
            name: session?.name || 'Session History',
          },
        });
        toast(`Restoring ${restorable} tabs…`, 1500);
      } catch (error) {
        console.error('[dialogs] failed to restore a history snapshot:', error);
        toast('Could not restore that session.', 1500);
      }
    },
    [toast]
  );

  return {
    state: { addTabsFor, historyOpen, sessionDetails, shortcutsOpen, duplicateRequest },
    intake,
    confirmDuplicates,
    settleDuplicates,
    actions: {
      addTabs: useCallback((collectionId) => setAddTabsFor(collectionId), []),
      importTabs: intake.importTabs,
      openHistory: useCallback(() => setHistoryOpen(true), []),
      openShortcuts: useCallback(() => setShortcutsOpen(true), []),
      closeAddTabs: useCallback(() => setAddTabsFor(null), []),
      closeHistory: useCallback(() => setHistoryOpen(false), []),
      closeShortcuts: useCallback(() => setShortcutsOpen(false), []),
      openDetails: useCallback((session, label) => setSessionDetails({ session, label }), []),
      closeDetails: useCallback(() => setSessionDetails(null), []),
      openAllFromHistory,
    },
  };
}
