// Migration 0003 — colour labels join the storage contract (skill.md §7.1).
//
// Additive and idempotent: it pins `color` to a string or null on every collection and folder, so a
// profile written before colours existed reads back exactly as it did (everything unlabelled). The
// palette itself is a setting (`customColors`), not part of this migration — `normalizeState` gives
// an absent palette its default. Dependency-free, so it stays immutable once released.

/**
 * Give one folder/collection a well-formed `color`.
 *
 * @param {unknown} entry
 * @returns {unknown}
 */
function withColor(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const next = /** @type {Record<string, unknown>} */ ({ ...entry });
  if (typeof next.color !== 'string' || !next.color) next.color = null;
  return next;
}

/**
 * @param {Record<string, unknown>} data Raw storage as read
 * @returns {Record<string, unknown>} Migrated data
 */
export function up(data) {
  const migrated = { ...data };
  if (Array.isArray(migrated.collections))
    migrated.collections = migrated.collections.map(withColor);
  if (Array.isArray(migrated.folders)) migrated.folders = migrated.folders.map(withColor);
  return migrated;
}
