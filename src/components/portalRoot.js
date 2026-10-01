// The single portal root every React modal renders into (skill.md §5.2 — one Modal primitive and
// one root, not one per modal).
//
// It hangs off `document.body` rather than `#collectionsContainer`, because the collections
// container is a scroll container with grid/list classes on it; a modal inside it would clip and
// would inherit layout the overlay does not want.

/** @type {HTMLElement|null} */
let root = null;

/**
 * The shared modal root, created on first use and reused afterwards.
 *
 * @returns {HTMLElement}
 */
export function getPortalRoot() {
  if (root && root.isConnected) return root;
  root = document.createElement('div');
  root.id = 'tcm-modal-root';
  document.body.appendChild(root);
  return root;
}
