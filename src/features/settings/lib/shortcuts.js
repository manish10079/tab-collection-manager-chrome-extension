/** The keyboard shortcuts the panel implements, as shown in Settings (popup.js registers them). */
export const SHORTCUTS = Object.freeze([
  { keys: ['Ctrl', 'F'], description: 'Search collections or tabs' },
  { keys: ['Ctrl', 'N'], description: 'Create new collection' },
  { keys: ['Ctrl', 'E'], description: 'Expand / collapse all' },
  { keys: ['Ctrl', 'Shift', 'E'], description: 'Expand Current Session only' },
  { keys: ['Ctrl', 'D'], description: 'Toggle list / grid view' },
  { keys: ['1', '–', '9'], description: 'Jump to collection' },
  { keys: ['?'], description: 'Show shortcuts help' },
  { keys: ['Esc'], description: 'Close modal or menu' },
  { keys: ['X'], description: 'Close panel' },
]);
