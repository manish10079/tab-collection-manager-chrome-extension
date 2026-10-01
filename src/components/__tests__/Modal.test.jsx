import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../Modal.jsx';

/** The portal root is module state, so each test clears the body first (RTL does not own it). */
function renderModal(props = {}) {
  const onClose = vi.fn();
  const view = render(
    <Modal title="Settings" icon="fa-sliders-h" onClose={onClose} {...props}>
      <button type="button">Inner action</button>
    </Modal>
  );
  return { onClose, ...view };
}

describe('Modal', () => {
  it('renders into the single shared portal root on document.body', () => {
    const first = render(
      <Modal title="One" onClose={() => {}}>
        <p>first</p>
      </Modal>
    );
    const second = render(
      <Modal title="Two" onClose={() => {}}>
        <p>second</p>
      </Modal>
    );

    const roots = document.querySelectorAll('#tcm-modal-root');
    expect(roots).toHaveLength(1);
    expect(roots[0].parentElement).toBe(document.body);
    expect(roots[0].textContent).toContain('first');
    expect(roots[0].textContent).toContain('second');

    first.unmount();
    second.unmount();
  });

  it('is announced as a dialog labelled by its title', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId).textContent).toContain('Settings');
  });

  it('closes on Escape and on the close button', () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes when the overlay is clicked but not when the dialog is', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets a caller replace the overlay behaviour', () => {
    const onClose = vi.fn();
    const onOverlayClick = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose} onOverlayClick={onOverlayClick}>
        <p>body</p>
      </Modal>
    );

    fireEvent.click(document.querySelector('.modal-overlay'));

    expect(onOverlayClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog and returns it to the trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Settings';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderModal();
    expect(screen.getByRole('dialog')).toBe(document.activeElement);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('only lets the topmost dialog close on Escape', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();

    const bottom = render(
      <Modal title="Bottom" onClose={closeBottom}>
        <p>bottom</p>
      </Modal>
    );
    const top = render(
      <Modal title="Top" onClose={closeTop}>
        <p>top</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();

    // With the top dialog gone, Escape reaches the one underneath.
    top.unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeBottom).toHaveBeenCalledTimes(1);

    bottom.unmount();
  });
});
