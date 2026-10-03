// The pending-confirmation slot, outside React on purpose — the same pattern as `toastStore.js`.
// A plain module any feature can ask a question of, and the `ConfirmProvider` merely renders
// whatever is pending. Keeping the resolver out of React means `await confirm(...)` cannot be
// stranded by a re-render or a commit timing race, and the tests can answer a confirmation
// without mounting a provider.
//
// Replaces the native `window.confirm()` calls, which blocked the panel thread and could not be
// styled, keyboard-navigated or asserted by role.

/**
 * @typedef {object} ConfirmOptions
 * @property {string} [title]        Dialog title, and the accessible name of the dialog
 * @property {import('react').ReactNode} message Body copy — a node, so a confirm can name items
 * @property {string} [confirmLabel] Label of the affirmative button (default "Confirm")
 * @property {string} [cancelLabel]  Label of the dismissive button (default "Cancel")
 * @property {boolean} [danger]      Paint the affirmative button as destructive
 * @property {string} [icon]         Font Awesome class for the header icon
 */

/**
 * @typedef {object} ConfirmRequest
 * @property {number} id
 * @property {ConfirmOptions} options
 * @property {(result: boolean) => void} resolve
 */

/** @type {ConfirmRequest|null} */
let pending = null;
let nextId = 1;

/** @type {Set<() => void>} */
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The confirmation currently on screen, or `null`. A stable reference between changes, so it is
 * safe as a `useSyncExternalStore` snapshot.
 *
 * @returns {ConfirmRequest|null}
 */
export function getConfirm() {
  return pending;
}

/**
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe
 */
export function subscribeConfirm(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask the user to confirm something. The promise settles `true` for the affirmative button and
 * `false` for Cancel, Escape, the close button or an overlay click — every dismiss path counts as
 * a refusal, so a destructive caller that forgets to handle dismissal still does nothing.
 *
 * @param {ConfirmOptions} options
 * @returns {Promise<boolean>}
 */
export function requestConfirm(options) {
  // A second question must never strand the first promise. Answer the one on screen "cancel"
  // before replacing it, so no awaiting caller is left hanging.
  if (pending) settleConfirm(false);

  return new Promise((resolve) => {
    pending = { id: nextId++, options, resolve };
    emit();
  });
}

/**
 * Answer the pending confirmation, if there is one. Idempotent: settling an empty slot is a no-op.
 *
 * @param {boolean} result
 */
export function settleConfirm(result) {
  const current = pending;
  pending = null;
  emit();
  if (current) current.resolve(result);
}

/** Drop any pending confirmation without resolving it. Exists for test isolation. */
export function resetConfirm() {
  pending = null;
  emit();
}
