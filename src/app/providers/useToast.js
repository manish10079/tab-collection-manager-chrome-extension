import { pushToast } from './toastStore.js';

/**
 * The way React code reports something to the user. It returns a stable function, so it is safe to
 * put in dependency arrays and to hand to feature hooks (which must not import from `app/`).
 *
 * @returns {(message: string, duration?: number) => void}
 */
export function useToast() {
  return pushToast;
}
