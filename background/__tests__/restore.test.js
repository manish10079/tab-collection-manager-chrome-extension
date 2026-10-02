import { describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../../tests/mocks/chrome.js';
import { discardWhenLoaded, restoreSession, restoreTabGroups } from '../restore.js';

describe('restoreTabGroups', () => {
  it('groups unpinned tabs by their saved group and applies the saved metadata', async () => {
    const { chrome } = installChromeMock();
    const group = vi.fn(async () => 99);
    const update = vi.fn(async () => {});
    chrome.tabs.group = group;
    chrome.tabGroups.update = update;

    const collection = {
      tabs: [
        { chromeGroupId: 1, pinned: false },
        { chromeGroupId: 1, pinned: false },
        { chromeGroupId: 2, pinned: true }, // pinned tabs cannot be grouped
        { chromeGroupId: 9, pinned: false }, // metadata was lost
        { chromeGroupId: null, pinned: false },
      ],
      chromeGroups: { 1: { title: 'Work', color: 'blue', collapsed: true } },
    };
    const createdTabs = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }];

    await restoreTabGroups(collection, createdTabs, 7);

    expect(group).toHaveBeenCalledTimes(1);
    expect(group).toHaveBeenCalledWith({ tabIds: [11, 12], createProperties: { windowId: 7 } });
    expect(update).toHaveBeenCalledWith(99, { title: 'Work', color: 'blue', collapsed: true });
  });

  it('does nothing when the collection has no saved groups', async () => {
    const { chrome } = installChromeMock();
    chrome.tabs.group = vi.fn();
    await restoreTabGroups({ tabs: [{ chromeGroupId: 1 }] }, [{ id: 1 }], 1);
    expect(chrome.tabs.group).not.toHaveBeenCalled();
  });
});

describe('discardWhenLoaded', () => {
  it('discards a tab once it finishes loading', async () => {
    const { chrome } = installChromeMock();
    const discard = vi.fn(async () => {});
    chrome.tabs.discard = discard;

    const promise = discardWhenLoaded(5);
    chrome.tabs.onUpdated.emit(5, { status: 'complete' }, { id: 5, active: false });
    await promise;

    expect(discard).toHaveBeenCalledWith(5);
  });

  it('cancels the discard when the user activates the tab first', async () => {
    const { chrome } = installChromeMock();
    const discard = vi.fn(async () => {});
    chrome.tabs.discard = discard;

    const promise = discardWhenLoaded(6);
    chrome.tabs.onUpdated.emit(6, { status: 'loading' }, { id: 6, active: true });
    await promise;

    expect(discard).not.toHaveBeenCalled();
  });
});

describe('restoreSession', () => {
  it('creates the saved tabs in the focused window and rebuilds their groups', async () => {
    const { chrome } = installChromeMock();
    let nextId = 10;
    const create = vi.fn(async () => ({ id: nextId++ }));
    const group = vi.fn(async () => 99);
    const update = vi.fn(async () => {});
    chrome.tabs.create = create;
    chrome.tabs.group = group;
    chrome.tabGroups.update = update;

    const collection = {
      id: 'c1',
      name: 'Saved',
      tabs: [
        { url: 'https://a.test', index: 0, pinned: false, chromeGroupId: 1 },
        { url: 'https://b.test', index: 1, pinned: false, chromeGroupId: 1 },
      ],
      chromeGroups: { 1: { title: 'T', color: 'grey', collapsed: false } },
    };

    await restoreSession('c1', collection);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 1, url: 'https://a.test', active: false })
    );
    expect(group).toHaveBeenCalledWith({ tabIds: [10, 11], createProperties: { windowId: 1 } });
  });

  it('does nothing for an empty collection', async () => {
    const { chrome } = installChromeMock();
    chrome.tabs.create = vi.fn();
    await restoreSession('c1', { id: 'c1', tabs: [] });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
