import { useEffect, useRef } from 'react';
import { isAnyModalOpen } from '../lib/isAnyModalOpen.js';

/**
 * The panel's global key handler, lifted out of `popup.js` (react-migration-plan.md §8, Phase 5.2):
 *
 *   Ctrl/Cmd + F       toggle global search
 *   Ctrl/Cmd + N       toggle the new-collection input
 *   Ctrl/Cmd + Shift+E expand only the Current Session
 *   Ctrl/Cmd + E       expand / collapse all
 *   Ctrl/Cmd + D       toggle list / grid layout
 *   1-9                jump to the Nth collection (skipped under a dialog)
 *   ?                  open the shortcuts help dialog
 *   Esc                close the open slide (dialogs close themselves)
 *   x / X              close the panel
 *
 * @param {object} deps
 * @param {import('./useShellController.js').ShellController} deps.controller
 * @param {() => void} deps.onOpenShortcuts
 * @returns {void}
 */
export function useGlobalShortcuts({ controller, onOpenShortcuts }) {
  // The controller object is rebuilt every render, so keep it in a ref and subscribe once. The
  // handler always reads the latest actions without re-registering listeners.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    function handleKeyDown(event) {
      const shell = controllerRef.current;
      const target = event.target;
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;

      // Ctrl/Cmd + F -> toggle global search
      if (mod && (key === 'f' || key === 'F')) {
        event.preventDefault();
        if (event.repeat) return;
        shell.toggleSearch();
        return;
      }

      // Ctrl/Cmd + N -> toggle the new-collection input
      if (mod && (key === 'n' || key === 'N')) {
        event.preventDefault();
        if (event.repeat) return;
        shell.toggleCreate();
        return;
      }

      // Ctrl/Cmd + Shift + E -> expand only the Current Session
      if (mod && event.shiftKey && (key === 'e' || key === 'E')) {
        event.preventDefault();
        if (event.repeat) return;
        shell.expandCurrentSession();
        return;
      }

      // Ctrl/Cmd + E -> expand / collapse all
      if (mod && !event.shiftKey && (key === 'e' || key === 'E')) {
        event.preventDefault();
        if (event.repeat) return;
        shell.expandAll();
        return;
      }

      // Ctrl/Cmd + D -> toggle list / grid layout
      if (mod && !event.shiftKey && (key === 'd' || key === 'D')) {
        event.preventDefault();
        if (event.repeat) return;
        shell.toggleLayout();
        return;
      }

      // Esc -> the Modal primitive closes its own topmost dialog; only the slide is ours.
      if (key === 'Escape') {
        if (isAnyModalOpen()) return;
        shell.closeOverlays();
        return;
      }

      // Ignore plain keys while typing in a field.
      if (isTyping) return;

      // ? -> open the shortcuts help dialog
      if (!mod && key === '?') {
        onOpenShortcuts();
        return;
      }

      // 1-9 -> jump to the Nth collection (skipped while a dialog is open)
      if (!mod && /^[1-9]$/.test(key)) {
        if (!isAnyModalOpen()) shell.jumpToCollection(parseInt(key, 10));
        return;
      }

      // x -> close the extension panel
      if (key === 'x' || key === 'X') {
        shell.closePanel();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpenShortcuts]);
}
