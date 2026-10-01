import { useEffect } from 'react';

/**
 * Hand focus back to whatever was focused before this component mounted.
 *
 * The search and create slides replace the actions bar, so the button that opened them is hidden
 * while the slide is up. Without this, closing a slide drops focus onto `<body>` and a keyboard
 * user has to tab through the whole panel again (react-migration-plan.md §8, Phase 5.4). The Modal
 * primitive does the same for dialogs.
 *
 * Call it before any effect that moves focus into the component, so the trigger is captured before
 * the input steals it.
 *
 * @returns {void}
 */
export function useRestoreFocus() {
  useEffect(() => {
    const previous = /** @type {HTMLElement|null} */ (document.activeElement);
    return () => {
      // Skip a detached trigger (e.g. re-render). Focusing a `display: none` element is a silent
      // no-op, so a trigger that is still hidden simply keeps focus where it is.
      if (previous?.isConnected) previous.focus();
    };
  }, []);
}
