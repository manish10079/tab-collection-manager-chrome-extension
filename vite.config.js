// Bundles the whole side panel. Since Phase 5.3 `src/sidepanel.html` is the Vite HTML entry, so
// Vite owns the page and its hashed assets — `scripts/build.mjs` no longer composes an HTML file
// from a legacy shell (react-migration-plan.md §8).
//
// Why the HTML entry lives in `src/` and Vite's root stays at the repository root: the test
// setup, the config and the tooling all resolve paths from the root, so moving the root into
// `src/` would break `tests/**` discovery. The consequence is that asset URLs are absolute
// (`/assets/...`), which is exactly what an extension page wants: they resolve against the
// extension origin, not the page's own directory.
//
// CRXJS is still intentionally not used: it would take over the manifest, which `build.mjs`
// writes from `manifest.json` (the side panel path is the only field it changes).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}', 'tests/**/*.{test,spec}.{js,jsx}'],
    // Vitest's 5s default is too tight for the interaction tests that type a long URL through
    // userEvent while the whole suite (25 jsdom files) runs in parallel. Raised rather than
    // trimming assertions; a real hang still fails.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/sidepanel.html', import.meta.url)),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
