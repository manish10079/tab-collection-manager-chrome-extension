import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConfirm,
  requestConfirm,
  resetConfirm,
  settleConfirm,
  subscribeConfirm,
} from '../confirmStore.js';

afterEach(() => {
  resetConfirm();
});

describe('confirmStore', () => {
  it('holds the pending question and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConfirm(listener);

    requestConfirm({ title: 'Delete Folder', message: 'Delete "Work"?', danger: true });

    expect(getConfirm().options.title).toBe('Delete Folder');
    expect(getConfirm().options.danger).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    settleConfirm(true);
    // The listener was removed before the answer, so it must not have heard it.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('settles the awaited promise with the answer and clears the slot', async () => {
    const answer = requestConfirm({ message: 'Continue?' });
    expect(getConfirm()).not.toBeNull();

    settleConfirm(true);

    await expect(answer).resolves.toBe(true);
    expect(getConfirm()).toBeNull();
  });

  it('treats a dismissal as a refusal', async () => {
    const answer = requestConfirm({ message: 'Continue?' });

    settleConfirm(false);

    await expect(answer).resolves.toBe(false);
  });

  it('is idempotent when nothing is pending', () => {
    settleConfirm(false);
    expect(getConfirm()).toBeNull();
  });

  it('never strands an unanswered question when a second one arrives', async () => {
    const first = requestConfirm({ message: 'First?' });
    const second = requestConfirm({ message: 'Second?' });

    // The one on screen is answered "cancel" before it is replaced, so no caller waits forever.
    await expect(first).resolves.toBe(false);
    expect(getConfirm().options.message).toBe('Second?');

    settleConfirm(true);
    await expect(second).resolves.toBe(true);
  });

  it('drops a pending question on reset', () => {
    requestConfirm({ message: 'Continue?' });

    resetConfirm();

    expect(getConfirm()).toBeNull();
  });
});
