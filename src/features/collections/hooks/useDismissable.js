import { useEffect, useRef } from 'react';

/**
 * Keeps a popup menu open until the user clicks outside its wrapper or presses Escape.
 * Attach the returned ref to the wrapper that contains *both* the trigger and the menu, so
 * the click that opens the menu is never mistaken for a click outside it.
 *
 * @param {boolean} isOpen
 * @param {() => void} onDismiss
 * @returns {import('react').RefObject<HTMLElement>}
 */
export function useDismissable(isOpen, onDismiss) {
  const ref = useRef(/** @type {HTMLElement|null} */ (null));

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onDismiss();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onDismiss]);

  return ref;
}
