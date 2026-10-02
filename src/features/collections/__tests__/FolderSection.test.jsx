import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FolderSection } from '../components/FolderSection.jsx';

/** @returns {Record<string, ReturnType<typeof vi.fn>>} */
function makeActions() {
  return {
    setFolderExpanded: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveCollectionToFolder: vi.fn(),
  };
}

const folder = (overrides = {}) => ({ id: 'f1', name: 'Work', isExpanded: true, ...overrides });
const collection = (id, name) => ({ id, name, tabs: [], folderId: 'f1', updatedAt: 0 });

/** @param {object} overrides */
function renderSection(overrides = {}) {
  const actions = makeActions();
  const props = {
    folder: folder(),
    collections: [collection('a', 'Alpha')],
    folders: [],
    isGrid: false,
    autoSaveCollectionId: null,
    actions,
    ...overrides,
  };
  const view = render(<FolderSection {...props} />);
  return { actions, view };
}

describe('FolderSection', () => {
  it('renders the name, the counts and the collections inside it', () => {
    renderSection();

    expect(screen.getByDisplayValue('Work')).toBeTruthy();
    expect(screen.getByText('1 collection')).toBeTruthy();
    expect(screen.getByDisplayValue('Alpha')).toBeTruthy();
  });

  it('shows a hint instead of a body for an empty folder', () => {
    renderSection({ collections: [] });

    expect(screen.getByText(/Empty folder/)).toBeTruthy();
  });

  it('toggles the folder through the expand control', async () => {
    const user = userEvent.setup();
    const { actions } = renderSection({ folder: folder({ isExpanded: false }) });

    await user.click(screen.getByRole('button', { name: 'Expand folder' }));

    expect(actions.setFolderExpanded).toHaveBeenCalledWith('f1', true);
  });

  it('renames through the header input once editing is armed', async () => {
    const user = userEvent.setup();
    const { actions } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Folder options' }));
    await user.click(screen.getByRole('button', { name: 'Edit folder name' }));

    const input = screen.getByDisplayValue('Work');
    await user.clear(input);
    await user.type(input, 'Projects{Enter}');

    expect(actions.renameFolder).toHaveBeenCalledWith('f1', 'Projects');
  });

  it('removes the folder from its menu', async () => {
    const user = userEvent.setup();
    const { actions } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Folder options' }));
    await user.click(screen.getByRole('button', { name: /Remove folder/ }));

    expect(actions.deleteFolder).toHaveBeenCalledWith('f1');
  });
});
