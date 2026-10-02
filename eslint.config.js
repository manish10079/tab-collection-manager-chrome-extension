// ESLint flat config — JavaScript only (skill.md §5.1).
// Lint scope is the React UI, the service worker (`background/`) and the tooling. Everything the
// old vanilla shell owned is gone (react-migration-plan.md §8).
import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'icons/**', '.freebuff/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...(globals.webextensions ?? {}),
        chrome: 'readonly',
        browser: 'readonly',
        structuredClone: 'readonly',
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...(react.configs?.flat?.recommended?.rules ?? {}),
      ...(reactHooks.configs?.recommended?.rules ?? {}),
      ...(jsxA11y.configs?.recommended?.rules ?? {}),
      // Vite uses the automatic JSX runtime, and props are documented with JSDoc
      // typedefs instead of propTypes (skill.md §5.1), so these rules do not apply.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
    },
  },
  {
    // Node-side tooling: scripts and configs run outside the browser.
    files: ['scripts/**/*.mjs', '*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // Playwright specs and fixtures are not React. Its fixture callback is literally named `use`,
    // which `react-hooks/rules-of-hooks` reads as a hook call, and `async ({}, use)` — the form
    // Playwright's own docs use for a fixture with no dependencies — trips `no-empty-pattern`.
    files: ['e2e/**/*.js'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
];
