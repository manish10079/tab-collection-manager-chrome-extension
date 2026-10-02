import { useDragAndDrop } from '../hooks/DragAndDropContext.jsx';
import { useDropZone } from '../hooks/useDropZone.js';

/**
 * @typedef {object} RootDropZoneProps
 * @property {import('../../../store/schema.js').Collection[]} collections
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * The "move out of a folder" target. It is only rendered while a collection that lives inside a
 * folder is being dragged — otherwise the list stays exactly as it was, with no extra row.
 *
 * Dropping a collection onto another collection reorders it and adopts that collection's folder;
 * this is the explicit way back to the root, and the only drag affordance for a folder with no
 * collections outside it.
 *
 * @param {RootDropZoneProps} props
 * @returns {import('react').ReactElement|null}
 */
export function RootDropZone({ collections, actions }) {
  const { dragged } = useDragAndDrop();
  const draggedCollection =
    dragged && dragged.type === 'collection'
      ? collections.find((collection) => collection.id === dragged.id)
      : null;
  const isNested = Boolean(draggedCollection && draggedCollection.folderId);

  const { isDragOver, dropProps } = useDropZone({
    accepts: (item) => item.type === 'collection',
    onDrop: (item) => actions.moveCollectionToFolder(item.id, null),
  });

  if (!isNested) return null;

  return (
    <div className={`cc-folder-root-dropzone${isDragOver ? ' ut-drag-over' : ''}`} {...dropProps}>
      <i className="fas fa-folder-open" aria-hidden="true" /> Drop here to move out of the folder
    </div>
  );
}
