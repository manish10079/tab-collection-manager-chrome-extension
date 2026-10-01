import { useAppState, useSettings } from '../store/hooks.js';
import { CollectionList, useCollectionActions } from '../features/collections/index.js';
import { legacyUi } from './legacy-ui.js';
import { useContainerClasses } from './hooks/useContainerClasses.js';

/**
 * @typedef {object} AppProps
 * @property {HTMLElement|null} [mountPoint] The element React renders into, so the app layer
 *   can keep the legacy container's layout classes in sync (see `useContainerClasses`).
 */

/**
 * Phase 2 shell: the collection list and its tab lists are rendered from the store. The
 * controls bar and the modals are still owned by the legacy runtime, which shares the same
 * `chrome.storage.local` contract.
 *
 * @param {AppProps} props
 * @returns {import('react').ReactElement}
 */
export function App({ mountPoint = null }) {
  const { ready, error } = useAppState();
  const settings = useSettings();
  const actions = useCollectionActions(legacyUi);

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
    </>
  );
}
