// Pure display formatters. Ported byte-for-byte from the legacy popup.js helpers so the
// React list renders identical strings (react-migration-plan.md §8, Phase 2).

/**
 * Relative "x ago" label for a stored timestamp. A missing or bogus timestamp reads as
 * "just now" (the legacy helper rendered `NaNd ago` for those).
 *
 * @param {number} [timestamp] Milliseconds since epoch.
 * @returns {string}
 */
export function formatTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'just now';

  const now = Date.now();
  const diff = now - value;
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff >= 0) {
    // Past timestamp
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  // Future timestamp (clock skew, or a tab added with a future date)
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `in ${minutes}m`;
  if (hours < 24) return `in ${hours}h`;
  return `in ${days}d`;
}

/**
 * `YYYY-MM-DD_HH-mm-ss`, the stamp the legacy export filenames used.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function formatFileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/**
 * "12 tabs" / "1 tab" — the label shown in a collection header.
 *
 * @param {number} count
 * @returns {string}
 */
export function formatTabCount(count) {
  const safe = Number.isFinite(count) ? count : 0;
  return `${safe} tab${safe === 1 ? '' : 's'}`;
}
