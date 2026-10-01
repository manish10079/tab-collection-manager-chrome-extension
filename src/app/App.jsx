import { useEffect, useState } from 'react';
import { useAppState, useSettings } from '../store/hooks.js';
import { CollectionList, useCollectionActions } from '../features/collections/index.js';
import { SettingsModal, useSettingsActions } from '../features/settings/index.js';
import { legacyUi } from './legacy-ui.js';
import { registerSettingsOpener } from './legacy-handle.js';
import { useContainerClasses } from './hooks/useContainerClasses.js';
import { useThemeAttribute } from './hooks/useThemeAttribute.js';

/**
 * @typedef {object} AppProps
 * @property {HTMLElement|null} [mountPoint] The element React renders into, so the app layer
 *   can keep the legacy container's layout classes in sync (see `useContainerClasses`).
 */

/**
 * The app shell: the collection list and its tab lists, and — since Phase 4 — the settings modal.
 * The controls bar, the remaining modals and the worker-backed features are still legacy, sharing
 * the same store.
 *
 * @param {AppProps} props
 * @returns {import('react').ReactElement}
 */
export function App({ mountPoint = null }) {
  const { ready, error } = useAppState();
  const settings = useSettings();
  const actions = useCollectionActions(legacyUi);
  const settingsActions = useSettingsActions(legacyUi);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The header's settings button is legacy markup, so it asks the app to open the modal.
  useEffect(() => registerSettingsOpener(() => setSettingsOpen(true)), []);

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
    </>
  );
}
