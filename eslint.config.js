// ESLint flat config — JavaScript only (skill.md 2.0.0, §5.1).
// Lint scope starts with src/ and tooling. `background.js` is the last vanilla file and stays
// excluded until Phase 6; everything the old shell owned is gone (react-migration-plan.md §8).
import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'icons/**',
      '.freebuff/**',
      // The vanilla service worker — Phase 6 scope, not linted yet.
      'background.js',
    ],
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
];
