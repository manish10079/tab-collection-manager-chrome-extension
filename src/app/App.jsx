import { useState } from 'react';
import { useAppState, useSettings } from '../store/hooks.js';
import { CollectionList, useCollectionActions } from '../features/collections/index.js';
import { SettingsModal, useSettingsActions } from '../features/settings/index.js';
import { DialogHost, useDialogs } from '../features/dialogs/index.js';
import {
  AppHeader,
  ControlsBar,
  GlobalSearchResults,
  useGlobalSearch,
  useGlobalShortcuts,
  useManifestInfo,
  useShellController,
} from '../features/shell/index.js';
import { useToast } from './providers/useToast.js';
import { useBootSequence } from './hooks/useBootSequence.js';
import { useThemeAttribute } from './hooks/useThemeAttribute.js';
import { EXTENSION_ID } from '../shared/extension-id.js';

/**
 * The app shell. Since Phase 5.2 it owns the whole panel: the header, the controls bar (and its
 * search/create slides), the global search results and the collection list, plus every React-owned
 * dialog (settings, add tabs, history, session details, duplicates, shortcuts help).
 *
 * Since Phase 5.3 this is the whole panel: the boot sequence that used to be a separate classic
 * script is `useBootSequence`, and the theme is `useThemeAttribute`.
 *
 * `useDialogs` is created before `useCollectionActions` because the collections feature does not
 * own adding or importing tabs — those are dialogs, so their handlers are injected back into the
 * actions object the cards call.
 *
 * @returns {import('react').ReactElement}
 */
export function App() {
  const { ready, error, lastSessionBackup } = useAppState();
  const settings = useSettings();
  const toast = useToast();
  const settingsActions = useSettingsActions({ toast });
  const dialogs = useDialogs({ toast });
  const actions = useCollectionActions({
    addTabs: dialogs.actions.addTabs,
    importTabs: dialogs.actions.importTabs,
    toast,
  });
  const controller = useShellController({ toast });
  const manifest = useManifestInfo();
  const search = useGlobalSearch(controller.query);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { openHistory, openShortcuts } = dialogs.actions;

  useGlobalShortcuts({ controller, onOpenShortcuts: openShortcuts });

  // Worker auto-save, the fresh read that follows it, and the opened-state normalisation.
  useBootSequence();

  // Hydrate first: applying the default theme before storage lands would flash the wrong palette.
  useThemeAttribute(ready ? settings.theme : undefined);

  const isGrid = settings.layoutViewMode === 'grid';
  const isSorted = (settings.collectionSortType || 'custom') !== 'custom';
  const containerClasses = ['collections-container'];
  if (isGrid) containerClasses.push('grid-view');
  if (isSorted) containerClasses.push('sort-active');

  return (
    <>
      <span className="creator">By Mkn Labs</span>

      <AppHeader
        manifest={manifest}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={controller.closePanel}
      />

      <div className="scrollable-content">
        <ControlsBar
          controller={controller}
          collectionSortType={settings.collectionSortType || 'custom'}
          isGrid={isGrid}
          backup={lastSessionBackup}
          onOpenHistory={openHistory}
        />

        {search.isEmpty ? (
          <div id="collectionsContainer" className={containerClasses.join(' ')}>
            {error ? (
              <p className="rs-error" role="alert">
                Could not read extension storage: {error}
              </p>
            ) : null}
            {ready ? <CollectionList actions={actions} /> : null}
          </div>
        ) : (
          <GlobalSearchResults
            search={search}
            query={controller.query}
            extensionId={EXTENSION_ID}
            onOpenCollection={controller.openCollection}
            onOpenTab={(url) => actions.openTab(url, { active: false })}
          />
        )}
      </div>

      {settingsOpen ? (
        <SettingsModal actions={settingsActions} onClose={() => setSettingsOpen(false)} />
      ) : null}
      <DialogHost dialogs={dialogs} />
    </>
  );
}
