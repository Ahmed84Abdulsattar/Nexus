import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { defineConfig } from '@playwright/test';

// End-to-end against the REAL local API (AUTH_MODE=dev) and a local PostgreSQL, with the MSW mocks
// off. Run: `pnpm --filter @nexus/web test:e2e:api` (set E2E_PORT to a free port for the web; the
// API listens on 3000, which must be free). The spec skips itself when PostgreSQL does not answer.
const port = Number(process.env['E2E_PORT'] ?? 5173);
const origin = `http://localhost:${port}`;

const localEnv = {
  APP_ENV: 'local',
  AUTH_MODE: 'dev',
  DATABASE_ADMIN_URL: 'postgres://nexus@localhost:5432/nexus',
  DATABASE_URL: 'postgres://nexus_api_local@localhost:5432/nexus',
  WORKER_DATABASE_URL: 'postgres://nexus_worker_local@localhost:5432/nexus',
  CORS_ALLOWED_ORIGINS: origin,
};

/** Migrate and seed the local database once, before the servers start (idempotent). */
const dbReady = (() => {
  const env = { ...process.env, ...localEnv };
  for (const command of ['pnpm --workspace-root db:migrate', 'pnpm --workspace-root db:seed']) {
    if (spawnSync(command, { env, shell: true, stdio: 'ignore' }).status !== 0) return false;
  }
  return true;
})();
process.env['E2E_DB_READY'] = dbReady ? '1' : '0';

export default defineConfig({
  testDir: './e2e-api',
  outputDir: './e2e-api/results',
  use: { baseURL: origin, trace: 'off', video: 'off' },
  webServer: dbReady
    ? [
        {
          command: 'pnpm --filter @nexus/api dev',
          env: localEnv,
          url: 'http://localhost:3000/health/live',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `pnpm exec vite --port ${port}`,
          env: {
            VITE_AUTH_MODE: 'dev',
            VITE_USE_MOCKS: 'false',
            VITE_API_BASE_URL: 'http://localhost:3000/v1',
          },
          url: origin,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : [],
});
