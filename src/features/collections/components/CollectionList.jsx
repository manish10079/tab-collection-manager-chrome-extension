import { useState } from 'react';
import { useAppState } from '../../../store/hooks.js';
import { DragAndDropProvider } from '../hooks/DragAndDropContext.jsx';
import { useGroupedCollections } from '../hooks/useGroupedCollections.js';
import { CollectionCard } from './CollectionCard.jsx';
import { EmptyState } from './EmptyState.jsx';
import { FolderSection } from './FolderSection.jsx';
import { GridCollectionModal } from './GridCollectionModal.jsx';
import { RootDropZone } from './RootDropZone.jsx';
import { SectionToggle } from './SectionToggle.jsx';

/**
 * @typedef {object} CollectionListProps
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Every saved collection, in display order, driven by the store. This is the React
 * replacement for the legacy `renderCollections` fragment build; it renders straight into
 * `#collectionsContainer`, so the legacy ids, classes and stylesheet keep working.
 *
 * The list is two stacked sections: **Folders** first, each folder holding its own collections
 * nested inside, then **Collections** with the root-level ones. A section is marked by a heading
 * element rather than a wrapper, so `.folder` and the root `.collection` stay direct children of
 * `#collectionsContainer` — the keyboard jump and the E2E helpers query exactly that shape. The
 * heading is a button, so a whole section can be folded away.
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

  // The headings exist to tell the two sections apart, so they only appear once there is at least
  // one folder; a folder-less profile stays the plain list it always was.
  const hasFolders = folders.length > 0;

  // Which whole sections are folded away. Local UI state on purpose: it needs no storage key, and
  // persisting it would mean a new setting plus a migration (skill.md §2.3, §7.1).
  const [collapsed, setCollapsed] = useState({ folders: false, collections: false });
  const toggleSection = (section) =>
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));

  return (
    <DragAndDropProvider>
      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {hasFolders ? (
            <h2 className="section-heading folders-heading" id="foldersHeading">
              <SectionToggle
                label="Folders"
                count={folders.length}
                collapsed={collapsed.folders}
                onToggle={() => toggleSection('folders')}
              />
            </h2>
          ) : null}
          {collapsed.folders
            ? null
            : groups.map((group) => (
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

          {/* Sits between the sections: it appears while a nested collection is dragged, as the
              explicit way back down into the Collections section. */}
          <RootDropZone collections={collections} actions={actions} />

          {hasFolders && root.length > 0 ? (
            <h2 className="section-heading collections-heading" id="collectionsHeading">
              <SectionToggle
                label="Collections"
                count={root.length}
                collapsed={collapsed.collections}
                onToggle={() => toggleSection('collections')}
              />
            </h2>
          ) : null}
          {collapsed.collections
            ? null
            : root.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  folders={folders}
                  isGrid={isGrid}
                  isAutoSaveTarget={collection.id === settings.autoSaveCollectionId}
                  actions={actions}
                />
              ))}
        </>
      )}

      {expanded ? <GridCollectionModal collection={expanded} actions={actions} /> : null}
    </DragAndDropProvider>
  );
}
