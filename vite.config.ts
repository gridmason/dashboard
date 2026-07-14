import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static bundle is emitted to dist/ and served from the app image (Dockerfile)
// or any static host (FR-17). Absolute base: this is a client-routed SPA, so
// deep links (/p/:pageType/:entityId) must load assets from an absolute path,
// not one relative to the current route.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
