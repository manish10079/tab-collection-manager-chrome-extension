import { useCallback, useRef, useState } from 'react';
import { useCollections } from '../../../store/hooks.js';
import { openSessionTabs } from '../lib/openSessionTabs.js';
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
 * @property {(tabs: object[], ramSaverEnabled: boolean) => Promise<void>} openAllFromHistory
 */

/**
 * `useDialogs` owns every React modal's visibility, so `App` stays a shell and the legacy runtime
 * only has to ask for one by name (`window.__tcmReact`). Nothing here renders: `DialogHost` reads
 * this object, which keeps the state and the markup independently testable.
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

  const openAllFromHistory = useCallback(
    async (tabs, ramSaverEnabled) => {
      const opened = await openSessionTabs(tabs, { ramSaverEnabled });
      if (opened > 0) toast(`Opened ${opened} tabs in the background`, 1500);
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
