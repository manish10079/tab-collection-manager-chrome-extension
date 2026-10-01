import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installChromeMock } from './mocks/chrome.js';

// The extension id is read at module scope by the favicon helper, so a mock must exist before
// the test files import anything.
installChromeMock();

beforeEach(() => {
  installChromeMock();
});

afterEach(() => {
  cleanup();
});
