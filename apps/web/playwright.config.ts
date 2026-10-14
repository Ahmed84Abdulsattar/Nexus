import process from 'node:process';
import { defineConfig } from '@playwright/test';

// Not run by `pnpm test` (vitest only includes test/ and src/). Run with `pnpm --filter @nexus/web test:e2e`.
// Another worktree's dev server on the same port must not be reused: set E2E_PORT to a free port
// (default 5173). A running server is never reused.
const port = Number(process.env['E2E_PORT'] ?? 5173);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  // Traces, videos and screenshots-on-failure stay off: with a real key the SDK puts it in tile URLs.
  use: { baseURL: origin, trace: 'off', video: 'off' },
  webServer: {
    command: `pnpm exec vite --port ${port}`,
    url: `${origin}/dev/components`,
    // Never reuse a server: it could be another worktree's dev server. Pick a free E2E_PORT.
    reuseExistingServer: false,
  },
});
