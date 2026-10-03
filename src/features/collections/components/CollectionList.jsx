import { Fragment, useState } from 'react';
import { useAppState } from '../../../store/hooks.js';
import { NO_COLOR, colorName, swatchValue } from '../../../lib/colors.js';
import { DragAndDropProvider } from '../hooks/DragAndDropContext.jsx';
import { useCollectionView } from '../hooks/useCollectionView.js';
import { CollectionCard } from './CollectionCard.jsx';
import { EmptyState } from './EmptyState.jsx';
import { FolderSection } from './FolderSection.jsx';
import { GridCollectionModal } from './GridCollectionModal.jsx';
import { RootDropZone } from './RootDropZone.jsx';
import { SectionToggle } from './SectionToggle.jsx';

/**
 * @typedef {object} CollectionListProps
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 * @property {boolean} [selectionMode]          Show a delete checkbox on every folder/collection
 * @property {Set<string>} [selectedFolderIds]
 * @property {Set<string>} [selectedCollectionIds]
 * @property {(kind: 'folder'|'collection', id: string) => void} [onToggleSelect]
 * @property {Set<string>} [colorFilter]         Colour ids to show; empty means "no filter"
 */

/**
 * Every saved collection, in display order, driven by the store. This is the React
 * replacement for the legacy `renderCollections` fragment build; it renders straight into
 * `#collectionsContainer`, so the legacy ids, classes and stylesheet keep working.
 *
 * Two layouts share this component. The default is two stacked sections: **Folders** first, each
 * folder holding its own collections nested inside, then **Collections** with the root-level ones.
 * When the **Color** sort mode is active it becomes one section per colour label — every folder and
 * collection carrying a colour sits together, in palette order, with the unlabelled items last. A
 * section is marked by a heading element rather than a wrapper, so `.cc-folder` and the root
 * `.cc-collection` stay direct children of `#collectionsContainer` — the keyboard jump and the E2E
 * helpers query exactly that shape. The heading is a button, so a whole section can be folded away.
 *
 * @param {CollectionListProps} props
 * @returns {import('react').ReactElement}
 */
export function CollectionList({
  actions,
  selectionMode = false,
  selectedFolderIds,
  selectedCollectionIds,
  onToggleSelect,
  colorFilter,
}) {
  const { collections, folders, settings } = useAppState();
  const { mode, root, groups, clusters } = useCollectionView(colorFilter);
  const customColors = /** @type {Array<{id: string, name: string, value?: string}>} */ (
    settings.customColors ?? []
  );
  const isGrid = settings.layoutViewMode === 'grid';
  const expanded = isGrid ? collections.find((collection) => collection.isExpanded) : null;
  const isEmpty = collections.length === 0 && folders.length === 0;

  // A colour filter (or a colour mode with everything filtered out) can hide every item, which is a
  // different message from "nothing saved yet".
  const filterActive = Boolean(colorFilter && colorFilter.size > 0);
  const noMatches =
    mode === 'color'
      ? clusters.length === 0
      : filterActive && groups.length === 0 && root.length === 0;

  // The headings exist to tell the two sections apart, so they only appear once there is at least
  // one folder; a folder-less profile stays the plain list it always was. While filtering, only the
  // folders that matched are counted.
  const hasFolders = filterActive ? groups.length > 0 : folders.length > 0;

  // Which sections are folded away, keyed by section name (`folders`, `collections`) or by colour
  // (`color:<id>`). Local UI state on purpose: it needs no storage key, and persisting it would mean
  // a new setting plus a migration (skill.md §2.3, §7.1).
  const [collapsed, setCollapsed] = useState({ folders: false, collections: false });
  const toggleSection = (section) =>
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));

  /** @param {{folder: import('../../../store/schema.js').Folder, collections: import('../../../store/schema.js').Collection[]}} group */
  const renderFolder = (group) => (
    <FolderSection
      key={group.folder.id}
      folder={group.folder}
      collections={group.collections}
      folders={folders}
      isGrid={isGrid}
      autoSaveCollectionId={settings.autoSaveCollectionId}
      actions={actions}
      selectionMode={selectionMode}
      isSelected={selectedFolderIds?.has(group.folder.id) ?? false}
      selectedCollectionIds={selectedCollectionIds}
      onToggleSelect={onToggleSelect}
    />
  );

  /** @param {import('../../../store/schema.js').Collection} collection */
  const renderCollection = (collection) => (
    <CollectionCard
      key={collection.id}
      collection={collection}
      folders={folders}
      isGrid={isGrid}
      isAutoSaveTarget={collection.id === settings.autoSaveCollectionId}
      actions={actions}
      selectionMode={selectionMode}
      isSelected={selectedCollectionIds?.has(collection.id) ?? false}
      onToggleSelect={onToggleSelect}
    />
  );

  return (
    <DragAndDropProvider>
      {isEmpty ? (
        <EmptyState />
      ) : noMatches ? (
        <p className="sh-search-no-results" role="status">
          <i className="fas fa-palette" aria-hidden="true" />
          <span>No folders or collections match this color.</span>
        </p>
      ) : mode === 'color' ? (
        clusters.map((cluster) => {
          const section = `color:${cluster.colorId}`;
          const isCollapsed = Boolean(collapsed[section]);
          const unlabelled = cluster.colorId === NO_COLOR;

          return (
            <Fragment key={cluster.colorId}>
              <h2 className="cc-section-heading color-heading" data-color={cluster.colorId}>
                <SectionToggle
                  label={colorName(cluster.colorId, customColors)}
                  count={cluster.groups.length + cluster.root.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleSection(section)}
                  swatch={
                    <span
                      className={`ut-color-swatch cc-section-swatch${
                        unlabelled ? ' cc-color-swatch-none' : ''
                      }`}
                      style={
                        unlabelled
                          ? undefined
                          : { '--tc-swatch-color': swatchValue(cluster.colorId, customColors) }
                      }
                      aria-hidden="true"
                    />
                  }
                />
              </h2>
              {isCollapsed ? null : (
                <>
                  {cluster.groups.map(renderFolder)}
                  {cluster.root.map(renderCollection)}
                </>
              )}
            </Fragment>
          );
        })
      ) : (
        <>
          {hasFolders ? (
            <h2 className="cc-section-heading folders-heading" id="foldersHeading">
              <SectionToggle
                label="Folders"
                count={groups.length}
                collapsed={collapsed.folders}
                onToggle={() => toggleSection('folders')}
              />
            </h2>
          ) : null}
          {collapsed.folders ? null : groups.map(renderFolder)}

          {/* Sits between the sections: it appears while a nested collection is dragged, as the
              explicit way back down into the Collections section. */}
          <RootDropZone collections={collections} actions={actions} />

          {hasFolders && root.length > 0 ? (
            <h2 className="cc-section-heading collections-heading" id="collectionsHeading">
              <SectionToggle
                label="Collections"
                count={root.length}
                collapsed={collapsed.collections}
                onToggle={() => toggleSection('collections')}
              />
            </h2>
          ) : null}
          {collapsed.collections ? null : root.map(renderCollection)}
        </>
      )}

      {expanded ? <GridCollectionModal collection={expanded} actions={actions} /> : null}
    </DragAndDropProvider>
  );
}
