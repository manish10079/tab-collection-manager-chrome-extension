import { useAppState } from '../../../store/hooks.js';
import { DragAndDropProvider } from '../hooks/DragAndDropContext.jsx';
import { useOrderedCollections } from '../hooks/useOrderedCollections.js';
import { CollectionCard } from './CollectionCard.jsx';
import { EmptyState } from './EmptyState.jsx';
import { GridCollectionModal } from './GridCollectionModal.jsx';

/**
 * @typedef {object} CollectionListProps
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Every saved collection, in display order, driven by the store. This is the React
 * replacement for the legacy `renderCollections` fragment build; it renders straight into
 * `#collectionsContainer`, so the legacy ids, classes and stylesheet keep working.
 *
 * @param {CollectionListProps} props
 * @returns {import('react').ReactElement}
 */
export function CollectionList({ actions }) {
  const ordered = useOrderedCollections();
  const { settings } = useAppState();
  const isGrid = settings.layoutViewMode === 'grid';
  const expanded = isGrid ? ordered.find((collection) => collection.isExpanded) : null;

  return (
    <DragAndDropProvider>
      {ordered.length === 0 ? (
        <EmptyState />
      ) : (
        ordered.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={collection}
            isGrid={isGrid}
            isAutoSaveTarget={collection.id === settings.autoSaveCollectionId}
            actions={actions}
          />
        ))
      )}

      {expanded ? <GridCollectionModal collection={expanded} actions={actions} /> : null}
    </DragAndDropProvider>
  );
}
