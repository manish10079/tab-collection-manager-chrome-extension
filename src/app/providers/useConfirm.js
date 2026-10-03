import { requestConfirm } from './confirmStore.js';

/**
 * The way React code asks the user to confirm a destructive action, replacing the native
 * `window.confirm()` that used to block the panel.
 *
 * It returns a stable function, so it is safe in dependency arrays and can be called from a feature
 * hook or component without threading a prop down from the composition root — the same reasoning as
 * `useToast`. Callers `await` the reply; the promise never rejects.
 *
 * @returns {(options: import('./confirmStore.js').ConfirmOptions) => Promise<boolean>}
 */
export function useConfirm() {
  return requestConfirm;
}
