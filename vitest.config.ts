import { defineConfig } from 'vitest/config';

// Unit tests (Vitest) cover the app source and the demo API service. The
// Playwright boot suite under e2e/ is driven by `npm run e2e`, not Vitest, so
// it is excluded here to keep the two runners from picking up each other's
// specs (both use *.spec / *.test globs).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
