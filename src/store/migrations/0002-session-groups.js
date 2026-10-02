// Migration 0002 — session snapshots carry their Chrome tab-group metadata (skill.md §7.1).
//
// The worker has always written `chromeGroupId` onto every saved tab, but the two snapshots it
// keeps — `lastSessionBackup` (the "Restore Previous Session" point) and each `sessionHistory`
// entry — recorded only the tabs. Those ids therefore pointed at a map that was never stored, so
// neither snapshot could rebuild the groups it had captured.
//
// The shape change is purely additive: a snapshot that predates this migration gains an empty
// `chromeGroups`, which is exactly how it behaved before (its tabs restore ungrouped), and a
// snapshot that already has one keeps it. Additive and idempotent, and dependency-free so it stays
// immutable once released.

/**
 * A snapshot's group map: whatever was stored, or an empty object when it is not a usable map.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function chromeGroups(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

/**
 * @param {Record<string, unknown>} data Raw storage as read
 * @returns {Record<string, unknown>} Migrated data
 */
export function up(data) {
  const migrated = { ...data };

  const backup = migrated.lastSessionBackup;
  if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
    migrated.lastSessionBackup = {
      .../** @type {Record<string, unknown>} */ (backup),
      chromeGroups: chromeGroups(/** @type {Record<string, unknown>} */ (backup).chromeGroups),
    };
  }

  if (Array.isArray(migrated.sessionHistory)) {
    migrated.sessionHistory = migrated.sessionHistory.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      return {
        .../** @type {Record<string, unknown>} */ (entry),
        chromeGroups: chromeGroups(/** @type {Record<string, unknown>} */ (entry).chromeGroups),
      };
    });
  }

  return migrated;
}
