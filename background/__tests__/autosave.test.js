import { afterEach, describe, expect, it } from 'vitest';
import { installChromeMock } from '../../tests/mocks/chrome.js';
import { runtime } from '../runtime.js';
import { saveSession, saveSessionIfTabsOpen, triggerAutoSave } from '../autosave.js';

/** @param {Record<string, unknown>} [overrides] */
function tab(overrides = {}) {
  return {
    url: 'https://tab.test',
    title: 'Tab',
    index: 0,
    windowId: 1,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

afterEach(() => {
  runtime.isRestoring = false;
  runtime.startupTime = 0;
  clearTimeout(runtime.autoSaveTimer);
  runtime.autoSaveTimer = null;
});

describe('triggerAutoSave', () => {
  it('does nothing while the worker is restoring', () => {
    installChromeMock();
    runtime.isRestoring = true;
    triggerAutoSave();
    expect(runtime.autoSaveTimer).toBeNull();
  });

  it('does nothing inside the startup stabilization window', () => {
    installChromeMock();
    runtime.startupTime = Date.now();
    triggerAutoSave();
    expect(runtime.autoSaveTimer).toBeNull();
  });

  it('debounces a save once the worker has settled', () => {
    installChromeMock();
    runtime.startupTime = Date.now() - 60_000;
    triggerAutoSave();
    expect(runtime.autoSaveTimer).not.toBeNull();
  });
});

describe('saveSession', () => {
  it('snapshots the window, preserves tab identity and records a history entry', async () => {
    const saved = { id: 'keep', url: 'https://tab.test', title: 'old', pinned: false, addedAt: 42 };
    const { store, chrome } = installChromeMock({
      collections: [{ id: 'auto', name: 'Auto', tabs: [saved] }],
      autoSaveCollectionId: 'auto',
      sessionHistory: [],
    });
    chrome.tabs.query = async () => [
      tab({ url: 'https://tab.test' }),
      tab({ url: 'https://two.test', index: 1 }),
      tab({ url: 'chrome://settings' }),
    ];

    await saveSession();

    const collection = store.collections.find((c) => c.id === 'auto');
    expect(collection.tabs.map((t) => t.url)).toEqual(['https://tab.test', 'https://two.test']);
    expect(collection.tabs.find((t) => t.url === 'https://tab.test').id).toBe('keep');
    expect(collection.chromeGroups).toEqual({});
    expect(store.lastSessionBackup).toMatchObject({ collectionId: 'auto', name: 'Auto' });
    expect(store.sessionHistory).toHaveLength(1);
    expect(store.sessionHistory[0].tabs).toHaveLength(2);
  });

  it('does nothing when auto-save is off', async () => {
    const { store, chrome } = installChromeMock({ collections: [], autoSaveCollectionId: null });
    chrome.tabs.query = async () => [tab()];
    await saveSession();
    expect(store.collections).toEqual([]);
  });

  it('disables auto-save when the target collection no longer exists', async () => {
    const { store } = installChromeMock({
      collections: [{ id: 'other', name: 'Other', tabs: [] }],
      autoSaveCollectionId: 'ghost',
    });
    await saveSession();
    expect(store.autoSaveCollectionId).toBeNull();
  });

  it('preserves the saved session when the window has no saveable tabs', async () => {
    const existing = [{ id: 'a', url: 'https://kept.test' }];
    const { store, chrome } = installChromeMock({
      collections: [{ id: 'auto', name: 'Auto', tabs: existing }],
      autoSaveCollectionId: 'auto',
    });
    chrome.tabs.query = async () => [tab({ url: 'chrome://newtab' })];

    await saveSession();

    expect(store.collections[0].tabs).toEqual(existing);
    expect(store.lastSessionBackup).toBeUndefined();
  });

  it('refuses to overwrite a populated collection with a tiny snapshot during startup', async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      url: `https://old-${i}.test`,
      pinned: false,
    }));
    const { store, chrome } = installChromeMock({
      collections: [{ id: 'auto', name: 'Auto', tabs: big }],
      autoSaveCollectionId: 'auto',
    });
    chrome.tabs.query = async () => [tab({ url: 'https://only.test' })];

    runtime.startupTime = Date.now();
    await saveSession();

    expect(store.collections[0].tabs).toHaveLength(10);
    expect(store.sessionHistory).toHaveLength(0);
  });

  it('applies the same write once the startup window has passed', async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      url: `https://old-${i}.test`,
      pinned: false,
    }));
    const { store, chrome } = installChromeMock({
      collections: [{ id: 'auto', name: 'Auto', tabs: big }],
      autoSaveCollectionId: 'auto',
    });
    chrome.tabs.query = async () => [tab({ url: 'https://only.test' })];

    await saveSession();

    expect(store.collections[0].tabs).toHaveLength(1);
    expect(store.lastSessionBackup.tabs).toHaveLength(10);
  });
});

describe('saveSessionIfTabsOpen', () => {
  it('skips the write when there is nothing saveable', async () => {
    const { store, chrome } = installChromeMock({
      collections: [{ id: 'auto', name: 'Auto', tabs: [] }],
      autoSaveCollectionId: 'auto',
    });
    chrome.tabs.query = async () => [tab({ url: 'about:blank' })];
    await saveSessionIfTabsOpen();
    expect(store.lastSessionBackup).toBeUndefined();
  });
});
