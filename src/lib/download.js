// Save a payload to the user's disk through a temporary object URL and a synthetic anchor click.
// The legacy code did this inline in `exportCollection` and `exportAllCollections`; one
// implementation means the two export paths cannot drift (react-migration-plan.md §8, Phase 5).
// It touches `document`, so it is not part of the pure `lib/` core — but it has no feature logic.

/**
 * Download a payload as pretty-printed JSON.
 *
 * @param {unknown} payload
 * @param {string} filename
 * @returns {void}
 */
export function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
