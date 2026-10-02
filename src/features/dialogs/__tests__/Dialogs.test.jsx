import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddTabsModal } from '../components/AddTabsModal.jsx';
import { DuplicateUrlDialog } from '../components/DuplicateUrlDialog.jsx';
import { HistoryModal } from '../components/HistoryModal.jsx';
import { SessionDetailsModal } from '../components/SessionDetailsModal.jsx';
import { ShortcutsHelpModal } from '../components/ShortcutsHelpModal.jsx';
import { SHORTCUTS } from '../../../shared/shortcuts.js';

const COLLECTION = { id: 'c1', name: 'Research', tabs: [] };

/** @returns {import('../hooks/useTabIntake.js').TabIntake} */
function makeIntake() {
  return {
    addManualTab: vi.fn(async () => true),
    addSelectedTabs: vi.fn(async () => ({ added: 0, skippedByLimit: 0, skippedInvalid: 0 })),
    importTabs: vi.fn(async () => {}),
  };
}

describe('AddTabsModal', () => {
  it('adds a manual tab through the intake and closes on success', async () => {
    const user = userEvent.setup();
    const intake = makeIntake();
    const onClose = vi.fn();
    render(<AddTabsModal collection={COLLECTION} intake={intake} onClose={onClose} />);

    await user.type(screen.getByLabelText('Title'), 'Alpha');
    await user.type(screen.getByLabelText('URL'), 'https://alpha.test');
    await user.click(screen.getByRole('button', { name: /Add Tab/ }));

    await waitFor(() =>
      expect(intake.addManualTab).toHaveBeenCalledWith('c1', 'Alpha', 'https://alpha.test')
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open when the intake refuses the tab', async () => {
    const user = userEvent.setup();
    const intake = makeIntake();
    // The duplicate prompt was cancelled, so the intake reports the tab was not added.
    intake.addManualTab = vi.fn(async () => false);
    const onClose = vi.fn();
    render(<AddTabsModal collection={COLLECTION} intake={intake} onClose={onClose} />);

    await user.type(screen.getByLabelText('URL'), 'https://dupe.test');
    await user.click(screen.getByRole('button', { name: /Add Tab/ }));

    await waitFor(() => expect(intake.addManualTab).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lists the window tabs in multi-select mode and passes their group id', async () => {
    globalThis.chrome.tabs.query = vi.fn(async () => [
      { id: 1, title: 'Alpha', url: 'https://alpha.test', groupId: 5 },
      { id: 2, title: 'Beta', url: 'https://beta.test', groupId: -1 },
    ]);
    const user = userEvent.setup();
    const intake = makeIntake();
    render(<AddTabsModal collection={COLLECTION} intake={intake} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Multi‑Select' }));
    await screen.findByText('Alpha');

    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await user.click(screen.getByRole('button', { name: /Add Selected/ }));

    await waitFor(() =>
      expect(intake.addSelectedTabs).toHaveBeenCalledWith(
        'c1',
        [{ title: 'Alpha', url: 'https://alpha.test', groupId: 5 }],
        expect.any(Object)
      )
    );
  });

  it('closes on Escape through the shared Modal behaviour', () => {
    const onClose = vi.fn();
    render(<AddTabsModal collection={COLLECTION} intake={makeIntake()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DuplicateUrlDialog', () => {
  const request = {
    url: 'https://dupe.test',
    duplicates: [{ collectionId: 'c1', collectionName: 'Research' }],
  };

  it('names the collections already holding the URL and adds anyway', async () => {
    const user = userEvent.setup();
    const onSettle = vi.fn();
    render(<DuplicateUrlDialog request={request} onSettle={onSettle} />);

    expect(screen.getByText('Research')).toBeTruthy();
    expect(screen.getByText(/already exists in/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Add Anyway/ }));
    expect(onSettle).toHaveBeenCalledWith(true);
  });

  it('treats Escape as a cancel so the awaiting intake promise settles', () => {
    const onSettle = vi.fn();
    render(<DuplicateUrlDialog request={request} onSettle={onSettle} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onSettle).toHaveBeenCalledWith(false);
  });
});

describe('HistoryModal', () => {
  it('shows the empty state when there are no snapshots', async () => {
    render(<HistoryModal onClose={vi.fn()} onOpenDetails={vi.fn()} onOpenAll={vi.fn()} />);

    expect(await screen.findByText('No sessions saved yet')).toBeTruthy();
  });

  it('opens the details for a snapshot and Open All passes the RAM Saver flag', async () => {
    globalThis.chrome.storage.local.get = vi.fn(async () => ({
      sessionHistory: [
        {
          timestamp: 1_700_000_000_000,
          tabs: [{ id: 't1', title: 'Alpha', url: 'https://a.test', chromeGroupId: 4 }],
          chromeGroups: { 4: { title: 'Docs', color: 'blue', collapsed: false } },
        },
      ],
      ramSaverEnabled: true,
    }));
    const user = userEvent.setup();
    const onOpenDetails = vi.fn();
    const onOpenAll = vi.fn();
    render(<HistoryModal onClose={vi.fn()} onOpenDetails={onOpenDetails} onOpenAll={onOpenAll} />);

    await screen.findByText('Snapshot #1');
    await user.click(screen.getByRole('button', { name: 'Open All' }));

    // The whole entry is handed over, not just its tabs: the group metadata has to travel with it
    // so the restore can rebuild the group the tab belonged to.
    expect(onOpenAll).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [{ id: 't1', title: 'Alpha', url: 'https://a.test', chromeGroupId: 4 }],
        chromeGroups: { 4: { title: 'Docs', color: 'blue', collapsed: false } },
      }),
      true
    );
    expect(onOpenDetails).not.toHaveBeenCalled();
  });
});

describe('SessionDetailsModal', () => {
  it('renders the snapshot label and its tabs', () => {
    render(
      <SessionDetailsModal
        session={{ tabs: [{ id: 't1', title: 'Alpha', url: 'https://a.test' }] }}
        label="1/2/2026, 3:00 PM"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Saved on 1\/2\/2026/)).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('https://a.test')).toBeTruthy();
  });
});

describe('ShortcutsHelpModal', () => {
  it('renders every shared shortcut and closes on Escape', () => {
    const onClose = vi.fn();
    render(<ShortcutsHelpModal onClose={onClose} />);

    expect(screen.getAllByText('Show shortcuts help')).toHaveLength(1);
    expect(document.querySelectorAll('.shortcut-row')).toHaveLength(SHORTCUTS.length);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
