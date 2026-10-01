import { useEffect, useState } from 'react';
import { useAppState, useSettings } from '../store/hooks.js';
import { CollectionList, useCollectionActions } from '../features/collections/index.js';
import { SettingsModal, useSettingsActions } from '../features/settings/index.js';
import { DialogHost, useDialogs } from '../features/dialogs/index.js';
import { legacyUi } from './legacy-ui.js';
import { registerDialogOpeners, registerSettingsOpener } from './legacy-handle.js';
import { useContainerClasses } from './hooks/useContainerClasses.js';
import { useThemeAttribute } from './hooks/useThemeAttribute.js';

/**
 * @typedef {object} AppProps
 * @property {HTMLElement|null} [mountPoint] The element React renders into, so the app layer
 *   can keep the legacy container's layout classes in sync (see `useContainerClasses`).
 */

/**
 * The app shell: the collection list and its tab lists, plus every React-owned dialog (settings,
 * add tabs, history, session details, duplicates, shortcuts help). The controls bar and the
 * worker-backed features are still legacy, sharing the same store.
 *
 * `useDialogs` is created before `useCollectionActions` because the collections feature no longer
 * owns adding or importing tabs — those are dialogs now, so their handlers are injected back into
 * the actions object the cards call.
 *
 * @param {AppProps} props
 * @returns {import('react').ReactElement}
 */
export function App({ mountPoint = null }) {
  const { ready, error } = useAppState();
  const settings = useSettings();
  const settingsActions = useSettingsActions(legacyUi);
  const dialogs = useDialogs({ toast: legacyUi.toast });
  const actions = useCollectionActions(legacyUi, {
    addTabs: dialogs.actions.addTabs,
    importTabs: dialogs.actions.importTabs,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { openHistory, openShortcuts } = dialogs.actions;

  // The header's settings and history buttons are legacy markup, so they ask the app to open.
  useEffect(() => registerSettingsOpener(() => setSettingsOpen(true)), []);
  useEffect(
    () => registerDialogOpeners({ openHistory, openShortcuts }),
    [openHistory, openShortcuts]
  );

  // Hydrate first: applying the default theme before storage lands would flash the wrong palette.
  useThemeAttribute(ready ? settings.theme : undefined);

  useContainerClasses(mountPoint, {
    isGrid: settings.layoutViewMode === 'grid',
    isSorted: (settings.collectionSortType || 'custom') !== 'custom',
  });

  return (
    <>
      {error ? (
        <p className="rs-error" role="alert">
          Could not read extension storage: {error}
        </p>
      ) : null}
      {ready ? <CollectionList actions={actions} /> : null}
      {settingsOpen ? (
        <SettingsModal actions={settingsActions} onClose={() => setSettingsOpen(false)} />
      ) : null}
      <DialogHost dialogs={dialogs} />
    </>
  );
}
