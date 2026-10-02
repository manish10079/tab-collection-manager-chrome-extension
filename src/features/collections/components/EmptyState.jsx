/**
 * Shown when there is nothing to list. Mirrors the legacy `#emptyState` markup (same classes)
 * so the existing stylesheet applies untouched.
 *
 * @returns {import('react').ReactElement}
 */
export function EmptyState() {
  return (
    <div className="ut-empty-state" id="emptyState">
      <i className="fas fa-inbox" />
      <h3>No collections yet</h3>
      <p>Create your first collection to start organizing tabs</p>
    </div>
  );
}
