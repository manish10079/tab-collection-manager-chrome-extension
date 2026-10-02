// The ordered migration list (skill.md §7.1). Append only: a released migration is immutable, and
// `SCHEMA_VERSION` (shared/constants.js) is bumped with each new entry.
//
// The runner is deliberately tiny — it applies every migration newer than the stored version once
// and stamps the result. `normalizeState` still defends against missing fields, so a profile whose
// write-back failed is readable even before the migration succeeds.
import { SCHEMA_VERSION } from '../../shared/constants.js';
import { up as foldersUp } from './0001-folders.js';

/**
 * @typedef {{version: number, name: string, up: (data: Record<string, unknown>) => Record<string, unknown>}} Migration
 */

/** @type {Migration[]} */
export const MIGRATIONS = Object.freeze([{ version: 1, name: 'folders', up: foldersUp }]);

export { SCHEMA_VERSION };

/**
 * Bring raw storage up to `SCHEMA_VERSION`.
 *
 * @param {Record<string, unknown>} raw Storage as read
 * @returns {{data: Record<string, unknown>, from: number, changed: boolean}}
 */
export function runMigrations(raw) {
  const from = Number.isFinite(raw.schemaVersion) ? /** @type {number} */ (raw.schemaVersion) : 0;
  if (from >= SCHEMA_VERSION) return { data: raw, from, changed: false };

  let data = raw;
  for (const migration of MIGRATIONS) {
    if (migration.version > from) data = migration.up(data);
  }
  data = { ...data, schemaVersion: SCHEMA_VERSION };
  return { data, from, changed: true };
}
