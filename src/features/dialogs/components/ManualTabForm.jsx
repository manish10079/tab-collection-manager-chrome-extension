import { useState } from 'react';

/**
 * @typedef {object} ManualTabFormProps
 * @property {string} collectionId
 * @property {import('../hooks/useTabIntake.js').TabIntake} intake
 * @property {() => void} onDone Called after the tab lands, so the modal can close
 */

/**
 * The "Manual" half of the add-tabs modal. It owns only the two draft fields: validation, the
 * 200-tab cap and the duplicate confirmation all live in `useTabIntake`, so the manual form and
 * the multi-select picker cannot disagree about what is accepted.
 *
 * @param {ManualTabFormProps} props
 * @returns {import('react').ReactElement}
 */
export function ManualTabForm({ collectionId, intake, onDone }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const added = await intake.addManualTab(collectionId, title, url);
      if (added) {
        setTitle('');
        setUrl('');
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="tab-form manual-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="tabTitle">Title</label>
        <input
          id="tabTitle"
          type="text"
          placeholder="Enter tab title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="tabUrl">URL</label>
        <input
          id="tabUrl"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <button type="submit" className="btn-secondary" disabled={busy}>
        <i className="fas fa-plus" /> Add Tab
      </button>
    </form>
  );
}
