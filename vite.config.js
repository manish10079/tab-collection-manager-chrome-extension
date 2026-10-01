// Bundles the React shell. The side-panel HTML itself is composed after bundling by
// scripts/build.mjs, which keeps popup.html (the legacy shell) as the single source of
// markup — no forked HTML to drift (react-migration-plan.md §4, fallback path).
//
// CRXJS is intentionally NOT used yet: it rewrites the manifest and owns the HTML entry,
// which fights the "legacy assets copied verbatim" requirement. Revisit if HMR is wanted.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}', 'tests/**/*.{test,spec}.{js,jsx}'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/main.jsx', import.meta.url)),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
