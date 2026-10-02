import { useAppState } from '../../../store/hooks.js';
import { DragAndDropProvider } from '../hooks/DragAndDropContext.jsx';
import { useGroupedCollections } from '../hooks/useGroupedCollections.js';
import { CollectionCard } from './CollectionCard.jsx';
import { EmptyState } from './EmptyState.jsx';
import { FolderSection } from './FolderSection.jsx';
import { GridCollectionModal } from './GridCollectionModal.jsx';
import { RootDropZone } from './RootDropZone.jsx';

/**
 * @typedef {object} CollectionListProps
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Every saved collection, in display order, driven by the store. This is the React
 * replacement for the legacy `renderCollections` fragment build; it renders straight into
 * `#collectionsContainer`, so the legacy ids, classes and stylesheet keep working.
 *
 * Folders (Phase 8) render as sibling sections after the root collections: root collections stay
 * direct children of `#collectionsContainer` (the keyboard jump and the e2e helpers rely on that),
 * and a folder's collections nest inside its own `.folder-body`.
 *
 * @param {CollectionListProps} props
 * @returns {import('react').ReactElement}
 */
export function CollectionList({ actions }) {
  const { collections, folders, settings } = useAppState();
  const { root, groups } = useGroupedCollections();
  const isGrid = settings.layoutViewMode === 'grid';
  const expanded = isGrid ? collections.find((collection) => collection.isExpanded) : null;
  const isEmpty = collections.length === 0 && folders.length === 0;

  return (
    <DragAndDropProvider>
      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <RootDropZone collections={collections} actions={actions} />
          {root.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              folders={folders}
              isGrid={isGrid}
              isAutoSaveTarget={collection.id === settings.autoSaveCollectionId}
              actions={actions}
            />
          ))}
          {groups.map((group) => (
            <FolderSection
              key={group.folder.id}
              folder={group.folder}
              collections={group.collections}
              folders={folders}
              isGrid={isGrid}
              autoSaveCollectionId={settings.autoSaveCollectionId}
              actions={actions}
            />
          ))}
        </>
      )}

      {expanded ? <GridCollectionModal collection={expanded} actions={actions} /> : null}
    </DragAndDropProvider>
  );
}
