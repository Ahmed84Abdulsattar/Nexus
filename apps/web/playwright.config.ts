import { defineConfig } from '@playwright/test';

// Not run by `pnpm test` (vitest only includes test/ and src/). Run with `pnpm --filter @nexus/web test:e2e`.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm exec vite',
    url: 'http://localhost:5173/dev/components',
    reuseExistingServer: true,
  },
});
