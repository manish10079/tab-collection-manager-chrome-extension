import { useState } from 'react';
import { useDragAndDrop } from './DragAndDropContext.jsx';

/** Payload MIME type carried by a drag. Never `text/plain` — see `onDragStart` below. */
export const DRAG_DATA_TYPE = 'application/x-tcm-item';

/**
 * Makes an element draggable only while its drag handle is held. That is the legacy
 * behaviour: the whole card stays non-draggable so text selection in the name and title
 * inputs still works, and the handle arms the drag on pointer down.
 *
 * @param {import('./DragAndDropContext.jsx').DraggedItem} payload
 * @returns {{
 *   isDragging: boolean,
 *   dragProps: Record<string, unknown>,
 *   handleProps: Record<string, unknown>,
 * }}
 */
export function useDraggable(payload) {
  const { dragged, setDragged } = useDragAndDrop();
  const [armed, setArmed] = useState(false);

  const isDragging = dragged?.type === payload.type && dragged?.id === payload.id;

  return {
    isDragging,
    dragProps: {
      draggable: armed,
      onDragStart: (event) => {
        setDragged(payload);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          // A private type, not `text/plain`: some browsers refuse to start a drag with no
          // data at all, but a text payload would be pasted into the search box, the
          // collection name or a tab title if the drag ended on one of them.
          event.dataTransfer.setData(DRAG_DATA_TYPE, payload.id);
        }
        // A tab row sits inside a card, so without this the card would drag instead.
        event.stopPropagation();
      },
      onDragEnd: () => {
        setDragged(null);
        setArmed(false);
      },
    },
    handleProps: {
      onPointerDown: () => setArmed(true),
      onPointerUp: () => setArmed(false),
      onPointerCancel: () => setArmed(false),
      onPointerLeave: () => setArmed(false),
    },
  };
}
