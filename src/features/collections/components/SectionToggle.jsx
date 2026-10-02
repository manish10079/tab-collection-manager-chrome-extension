/**
 * @typedef {object} SectionToggleProps
 * @property {string} label      Visible section name, e.g. "Folders"
 * @property {number} count      Live number of items in the section
 * @property {boolean} collapsed Whether the section is folded away
 * @property {() => void} onToggle
 */

/**
 * The clickable heading of a collection-list section (Folders / Collections). Pressing it folds
 * the whole section away, leaving the heading and its count in place.
 *
 * @param {SectionToggleProps} props
 * @returns {import('react').ReactElement}
 */
export function SectionToggle({ label, count, collapsed, onToggle }) {
  return (
    <button
      type="button"
      className="section-toggle"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} section`}
      onClick={onToggle}
    >
      <i className={`fas fa-chevron-${collapsed ? 'right' : 'down'}`} aria-hidden="true" />
      <span className="section-heading-label">{label}</span>
      <span className="section-count">{count}</span>
    </button>
  );
}
