import { useState } from 'react';
import { Modal } from '../../../components/Modal.jsx';
import { EXTENSION_ID } from '../../../shared/extension-id.js';
import { resolveFaviconUrl } from '../../../lib/url.js';
import { useSessionHistory } from '../hooks/useSessionHistory.js';

/**
 * @typedef {object} SessionCardProps
 * @property {import('../../../store/schema.js').SessionBackup} session
 * @property {string} label Pre-formatted timestamp
 * @property {number} position Snapshot number, counting from the newest
 * @property {(session: object, label: string) => void} onOpenDetails
 * @property {(session: object) => void} onOpenAll
 */

/**
 * One snapshot row. The legacy card was assembled from an HTML string plus inline styles and two
 * mouse listeners that rewrote `style.backgroundColor`; here the hover is React state and the
 * whole card is one keyboard-reachable control (Open All stops propagation).
 *
 * @param {SessionCardProps} props
 * @returns {import('react').ReactElement}
 */
function SessionCard({ session, label, position, onOpenDetails, onOpenAll }) {
  const [hovered, setHovered] = useState(false);
  const tabs = Array.isArray(session.tabs) ? session.tabs : [];

  return (
    <div
      className="tab-item"
      role="button"
      tabIndex={0}
      style={{
        cursor: 'pointer',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '8px',
        padding: '12px',
        transition: 'background-color 0.2s',
        backgroundColor: hovered ? 'var(--bg-card-hover)' : 'transparent',
      }}
      onClick={() => onOpenDetails(session, label)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpenDetails(session, label);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-click-area" style={{ flexGrow: 1, marginRight: '8px' }}>
          <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
            Snapshot #{position}
          </strong>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            <i className="far fa-calendar-alt" /> {label} • <strong>{tabs.length} tabs</strong>
          </div>
        </div>
        <button
          type="button"
          className="btn-success open-all-session-btn"
          style={{ padding: '6px 12px', fontSize: '11px', zIndex: 10 }}
          onClick={(event) => {
            event.stopPropagation();
            // The whole entry, so the caller can rebuild its Chrome tab groups too.
            onOpenAll(session);
          }}
        >
          <i className="fas fa-external-link-alt" /> Open All
        </button>
      </div>
      <div
        className="tabs-preview"
        style={{
          display: 'flex',
          gap: '4px',
          overflowX: 'auto',
          paddingBottom: '4px',
          flexGrow: 1,
        }}
      >
        {tabs.slice(0, 10).map((tab, index) => (
          <img
            key={tab.id ?? index}
            src={resolveFaviconUrl(tab.url, EXTENSION_ID)}
            alt=""
            title={tab.title}
            style={{ width: '16px', height: '16px', borderRadius: '3px' }}
          />
        ))}
        {tabs.length > 10 ? (
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
            +{tabs.length - 10}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @typedef {object} HistoryModalProps
 * @property {() => void} onClose
 * @property {(session: object, label: string) => void} onOpenDetails
 * @property {(session: object, ramSaverEnabled: boolean) => void} onOpenAll
 */

/**
 * Session history, replacing `#historyModal` and the DOMContentLoaded controller in popup.js.
 * `sessionHistory` is worker-owned (ADR-0004), so this reads it directly instead of through the
 * store's write queue; `ramSaverEnabled` travels with the Open All click so a restored batch can
 * be discarded once loaded.
 *
 * Open All hands the **whole entry** to the caller, not just its tabs: the entry also carries the
 * Chrome tab-group metadata its tabs point at, and only the worker can rebuild those groups.
 *
 * @param {HistoryModalProps} props
 * @returns {import('react').ReactElement}
 */
export function HistoryModal({ onClose, onOpenDetails, onOpenAll }) {
  const { history, ramSaverEnabled, loading } = useSessionHistory(true);

  return (
    <Modal
      title="Session History"
      icon="fa-history"
      className="dl-history-modal"
      bodyClassName="dl-history-modal-body"
      onClose={onClose}
    >
      <div className="tabs-list">
        {!loading && history.length === 0 ? (
          <div className="ut-empty-state">
            <i className="fas fa-clock" />
            <h3>No sessions saved yet</h3>
            <p>Once you modify your open tabs, past snapshots will show up here.</p>
          </div>
        ) : null}
        {history.map((session, index) => {
          const label = new Date(session.timestamp).toLocaleString();
          return (
            <SessionCard
              key={session.timestamp ?? index}
              session={session}
              label={label}
              position={history.length - index}
              onOpenDetails={onOpenDetails}
              onOpenAll={(session) => onOpenAll(session, ramSaverEnabled)}
            />
          );
        })}
      </div>
    </Modal>
  );
}
