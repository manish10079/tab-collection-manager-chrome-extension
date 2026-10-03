import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmProvider } from '../ConfirmProvider.jsx';
import { requestConfirm, resetConfirm } from '../confirmStore.js';

afterEach(() => {
  resetConfirm();
});

/** @param {{message: string, title?: string, confirm?: string, danger?: boolean}} options */
function ask(options) {
  let answer;
  act(() => {
    answer = requestConfirm(options);
  });
  return answer;
}

describe('ConfirmProvider', () => {
  it('renders children and nothing while no question is pending', () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );

    expect(screen.getByText('panel body')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the pending question as a labelled dialog in the shared portal root', () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );

    ask({ title: 'Delete Folder', message: 'Delete "Work" and its 2 collections?' });

    expect(screen.getByRole('dialog', { name: 'Delete Folder' })).toBeTruthy();
    expect(screen.getByText('Delete "Work" and its 2 collections?')).toBeTruthy();
    expect(document.querySelector('#tcm-modal-root')).toBeTruthy();
  });

  it('answers true from the affirmative button and closes', async () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );
    const answer = ask({
      title: 'Delete Folder',
      message: 'Delete "Work"?',
      confirmLabel: 'Delete',
      danger: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers false from Cancel', async () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );
    const answer = ask({ message: 'Continue?' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(answer).resolves.toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers false when Escape dismisses the dialog', async () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );
    const answer = ask({ message: 'Continue?' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(answer).resolves.toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the caller’s labels and defaults the rest', () => {
    render(
      <ConfirmProvider>
        <p>panel body</p>
      </ConfirmProvider>
    );

    ask({
      title: 'Disconnect Google Drive',
      message: 'Remove the backup?',
      confirmLabel: 'Disconnect',
    });

    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    // Cancel is the default dismissive label.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
