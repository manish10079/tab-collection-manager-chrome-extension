import { Modal } from '../../../components/Modal.jsx';
import { EXTENSION_ID } from '../../../shared/extension-id.js';
import { resolveFaviconUrl } from '../../../lib/url.js';

/**
 * @typedef {object} SessionDetailsModalProps
 * @property {import('../../../store/schema.js').SessionBackup} session
 * @property {string} label Pre-formatted timestamp
 * @property {() => void} onClose
 */

/**
 * The read-only list of one snapshot's tabs, opened from a history card. Replaces
 * `#sessionDetailsModal` + `showSessionDetails()`; it stacks above the history modal via
 * `zIndex`, and the `Modal` primitive already keeps Escape on the topmost dialog.
 *
 * @param {SessionDetailsModalProps} props
 * @returns {import('react').ReactElement}
 */
export function SessionDetailsModal({ session, label, onClose }) {
  const tabs = Array.isArray(session.tabs) ? session.tabs : [];

  return (
    <Modal
      title={
        <>
          <span style={{ fontSize: '0.7rem' }}>Session Detail</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 'normal',
              display: 'block',
              color: 'var(--text-secondary)',
              marginTop: '4px',
            }}
          >
            Saved on {label}
          </span>
        </>
      }
      icon="fa-list"
      className="dl-session-details-modal"
      bodyClassName="dl-history-modal-body"
      zIndex={2000}
      onClose={onClose}
    >
      <div className="tabs-list">
        {tabs.map((tab, index) => (
          <div
            className="tab-item"
            key={tab.id ?? index}
            style={{
              padding: '8px',
              borderBottom: '1px solid var(--border-color, #eee)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <img
              src={resolveFaviconUrl(tab.url, EXTENSION_ID)}
              alt=""
              style={{ width: '16px', height: '16px', flexShrink: 0, borderRadius: '2px' }}
            />
            <div
              style={{
                flexGrow: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <span
                style={{
                  fontWeight: 500,
                  fontSize: '12.5px',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={tab.title}
              >
                {tab.title || 'Untitled'}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={tab.url}
              >
                {tab.url}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
