import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { useDialogs } from '../hooks/useDialogs.js';

/**
 * The history snapshot's "Open All" against the real store and the worker message channel.
 *
 * This is the one restore path that used to create its tabs from the panel, which is why it could
 * not rebuild Chrome tab groups: only the worker owns `restoreSession` and the group rebuild, so
 * the snapshot now goes back through it whole — tabs *and* the group metadata they reference.
 */

function setup() {
  const { chrome } = installChromeMock({});
  const toast = vi.fn();
  const { result } = renderHook(() => useDialogs({ toast }));
  return { chrome, toast, dialogs: result.current };
}

describe('openAllFromHistory', () => {
  it('hands the snapshot to the worker with its Chrome tab groups', async () => {
    const { chrome, toast, dialogs } = setup();
    await hydrate();
    const send = vi.fn(async () => ({ success: true }));
    chrome.runtime.sendMessage = send;

    const snapshot = {
      tabs: [
        { id: 't1', title: 'Alpha', url: 'https://a.test', chromeGroupId: 4 },
        { id: 't2', title: 'Beta', url: 'https://b.test', chromeGroupId: 4 },
      ],
      chromeGroups: { 4: { title: 'Docs', color: 'blue', collapsed: false } },
      name: 'Snapshot',
    };

    await dialogs.actions.openAllFromHistory(snapshot);

    expect(send).toHaveBeenCalledWith({
      command: 'restoreSession',
      backupData: {
        tabs: snapshot.tabs,
        chromeGroups: snapshot.chromeGroups,
        name: 'Snapshot',
      },
    });
    expect(toast).toHaveBeenCalledWith('Restoring 2 tabs…', 1500);
  });

  it('defaults the groups for an entry saved before they were carried', async () => {
    const { chrome, dialogs } = setup();
    await hydrate();
    const send = vi.fn(async () => ({ success: true }));
    chrome.runtime.sendMessage = send;

    await dialogs.actions.openAllFromHistory({ tabs: [{ id: 't1', url: 'https://a.test' }] });

    expect(send).toHaveBeenCalledWith({
      command: 'restoreSession',
      backupData: {
        tabs: [{ id: 't1', url: 'https://a.test' }],
        chromeGroups: {},
        name: 'Session History',
      },
    });
  });

  it('does not bother the worker when the snapshot has nothing to open', async () => {
    const { chrome, toast, dialogs } = setup();
    await hydrate();
    const send = vi.fn(async () => ({ success: true }));
    chrome.runtime.sendMessage = send;

    await dialogs.actions.openAllFromHistory({
      tabs: [
        { id: 't1', url: 'about:blank' },
        { id: 't2', url: '' },
      ],
    });

    expect(send).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Nothing to restore in that session.', 1500);
  });

  it('reports a failed restore instead of failing silently', async () => {
    const { chrome, toast, dialogs } = setup();
    await hydrate();
    chrome.runtime.sendMessage = vi.fn(async () => {
      throw new Error('no worker');
    });

    await dialogs.actions.openAllFromHistory({ tabs: [{ id: 't1', url: 'https://a.test' }] });

    expect(toast).toHaveBeenCalledWith('Could not restore that session.', 1500);
  });
});
