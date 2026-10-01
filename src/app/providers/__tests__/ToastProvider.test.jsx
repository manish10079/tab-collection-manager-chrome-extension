import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToastProvider } from '../ToastProvider.jsx';
import { dismissToast, getToasts, pushToast, resetToasts } from '../toastStore.js';

afterEach(() => {
  resetToasts();
});

describe('ToastProvider', () => {
  it('renders children and portals the queue into the shared body-level root', () => {
    render(
      <ToastProvider>
        <p>panel body</p>
      </ToastProvider>
    );

    expect(screen.getByText('panel body')).toBeTruthy();
    expect(document.querySelector('#tcm-modal-root .toast-container')).toBeTruthy();
  });

  it('shows a queued toast and removes it once dismissed', () => {
    render(
      <ToastProvider>
        <p>panel body</p>
      </ToastProvider>
    );

    act(() => {
      pushToast('Collection copied to clipboard');
    });
    expect(screen.getByText('Collection copied to clipboard')).toBeTruthy();

    act(() => {
      dismissToast(getToasts()[0].id);
    });
    expect(screen.queryByText('Collection copied to clipboard')).toBeNull();
  });
});
