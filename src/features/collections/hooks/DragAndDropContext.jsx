import { createContext, useContext, useMemo, useState } from 'react';

/**
 * @typedef {object} DraggedItem
 * @property {'collection' | 'tab'} type
 * @property {string} id
 * @property {string} [sourceCollectionId] Set for tabs — the collection it came from
 */

const DragAndDropContext = createContext(null);

/** Used when a card is rendered outside the list (component tests, isolated previews). */
const NO_DRAG = Object.freeze({ dragged: null, setDragged: () => {} });

/**
 * Holds the item currently being dragged. Native drag events cannot carry data during
 * `dragover`, so a drop target cannot otherwise tell whether the tab it is hovering comes
 * from its own collection. Depth makes a context worth it: the payload is needed by both the
 * collection card and every tab row underneath it.
 *
 * @param {{children: import('react').ReactNode}} props
 * @returns {import('react').ReactElement}
 */
export function DragAndDropProvider({ children }) {
  const [dragged, setDragged] = useState(/** @type {DraggedItem|null} */ (null));
  const value = useMemo(() => ({ dragged, setDragged }), [dragged]);

  return <DragAndDropContext.Provider value={value}>{children}</DragAndDropContext.Provider>;
}

/**
 * @returns {{dragged: DraggedItem|null, setDragged: (item: DraggedItem|null) => void}}
 */
export function useDragAndDrop() {
  return useContext(DragAndDropContext) ?? NO_DRAG;
}
