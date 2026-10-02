// Migration 0001 — folders land in the storage contract (skill.md §7.1).
//
// Additive and idempotent: it introduces the `folders` array and pins `folderId` to a string or
// null on every collection, so a profile written before folders existed reads back exactly as it
// did (every collection at the root). It never imports the schema module, so migrations stay
// dependency-free and immutable once released.

/**
 * @param {Record<string, unknown>} data Raw storage as read
 * @returns {Record<string, unknown>} Migrated data
 */
export function up(data) {
  const collections = Array.isArray(data.collections) ? data.collections : [];

  return {
    ...data,
    folders: Array.isArray(data.folders) ? data.folders : [],
    collections: collections.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const collection = /** @type {Record<string, unknown>} */ ({ ...entry });
      const folderId = collection.folderId;
      collection.folderId = typeof folderId === 'string' && folderId ? folderId : null;
      return collection;
    }),
  };
}
