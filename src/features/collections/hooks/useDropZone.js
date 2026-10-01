import { useState } from 'react';
import { useDragAndDrop } from './DragAndDropContext.jsx';

/**
 * Marks an element as a drop target for the item being dragged.
 *
 * @param {object} options
 * @param {(dragged: import('./DragAndDropContext.jsx').DraggedItem) => boolean} options.accepts
 *   Whether this target takes the dragged item. Evaluated on every drag event, because a
 *   collection must not highlight for a tab that already lives in it.
 * @param {(dragged: import('./DragAndDropContext.jsx').DraggedItem) => void} options.onDrop
 * @returns {{isDragOver: boolean, dropProps: Record<string, unknown>}}
 */
export function useDropZone({ accepts, onDrop }) {
  const { dragged } = useDragAndDrop();
  const [hovered, setHovered] = useState(false);

  const canAccept = Boolean(dragged) && accepts(dragged);

  return {
    isDragOver: canAccept && hovered,
    dropProps: {
      onDragOver: (event) => {
        if (!canAccept) return;
        // Without preventDefault the browser refuses the drop entirely.
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        setHovered(true);
      },
      onDragLeave: () => setHovered(false),
      onDrop: (event) => {
        setHovered(false);
        if (!canAccept) return;
        event.preventDefault();
        // A tab row lives inside a card, so the card must not also handle this drop.
        event.stopPropagation();
        onDrop(dragged);
      },
    },
  };
}
