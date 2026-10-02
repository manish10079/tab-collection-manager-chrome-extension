// The toast queue, outside React on purpose: a plain module the features push to directly, and
// the `ToastProvider` merely renders whatever is queued. Keeping it out of React means a toast
// pushed from an event handler is never lost to a commit timing race, and the tests can reset it
// without unmounting a provider (react-migration-plan.md §8, Phase 5).
//
// Replaces the legacy `showToast()` DOM builder and its `#toastContainer`.

/** @typedef {object} ToastEntry
 * @property {number} id
 * @property {string} message
 * @property {number} duration Milliseconds the toast stays fully visible
 */

/** @type {ToastEntry[]} */
let toasts = [];
let nextId = 1;

/** @type {Set<() => void>} */
const listeners = new Set();

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const timers = new Map();

// How long the hide animation runs before the entry is dropped (`src/styles/toast.css`
// `.toast.hide`).
const HIDE_MS = 400;

function emit() {
  for (const listener of listeners) listener();
}

/** @returns {ToastEntry[]} */
export function getToasts() {
  return toasts;
}

/**
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe
 */
export function subscribeToasts(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Queue a toast. Identical messages stack rather than replace each other, which matches the
 * legacy behaviour — a batch add that toasts twice should show twice.
 *
 * @param {string} message
 * @param {number} [duration]
 */
export function pushToast(message, duration = 3000) {
  if (!message) return;

  const id = nextId++;
  toasts = [...toasts, { id, message, duration }];
  emit();

  // Remove after the visible window plus the hide animation.
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration + HIDE_MS)
  );
}

/**
 * @param {number} id
 */
export function dismissToast(id) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }

  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/** Empty the queue and cancel pending dismissals. Exists for test isolation. */
export function resetToasts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  emit();
}
