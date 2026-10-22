// pnpm dev:local
// One command to run Nexus on this machine with no Azure and no Entra (docs/04, docs/08 "Local
// development sign-in"). It
//   1. checks that the local PostgreSQL answers on localhost:5432,
//   2. builds the workspace packages the apps import (so a stale packages/*/dist cannot break dev),
//   3. migrates and seeds the local database (demo group roles, passwordless local logins),
//   4. starts the API (AUTH_MODE=dev, APP_ENV=local), the worker on fixtures (DATOMS_LIVE=false) and
//      the web app with the MSW mocks off, so the web talks to the real local API.
// It sets only the documented passwordless local database URLs and the switches above. It does not
// read or print .env: the apps still load it themselves (--env-file-if-exists); values set here win.
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';

// Load the repo-root .env (git-ignored) into this process so its values reach the children, the same
// file the apps load themselves. Nothing from it is printed. Values already in the environment win.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env: fine */
}

const env = {
  ...process.env,
  APP_ENV: 'local',
  AUTH_MODE: 'dev',
  DATABASE_ADMIN_URL: 'postgres://nexus@localhost:5432/nexus',
  DATABASE_URL: 'postgres://nexus_api_local@localhost:5432/nexus',
  WORKER_DATABASE_URL: 'postgres://nexus_worker_local@localhost:5432/nexus',
  DATOMS_LIVE: 'false',
  LIVE_MODE: 'poll',
  VITE_AUTH_MODE: 'dev',
  VITE_USE_MOCKS: 'false',
  VITE_API_BASE_URL: 'http://localhost:3000/v1',
};

// The map: with the mocks off, /v1/config comes from the API and serves ARCGIS_API_KEY. If only the
// developer key (VITE_DEV_ARCGIS_API_KEY, used by the mock) is set, hand it to the local API.
if (!env.ARCGIS_API_KEY && env.VITE_DEV_ARCGIS_API_KEY) env.ARCGIS_API_KEY = env.VITE_DEV_ARCGIS_API_KEY;
if (!env.ARCGIS_API_KEY) {
  console.warn('[dev:local] No ARCGIS_API_KEY or VITE_DEV_ARCGIS_API_KEY in .env: the map will say "Map key not configured".');
}

function postgresIsUp() {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 5432 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.setTimeout(2000, () => (socket.destroy(), resolve(false)));
  });
}

function run(label, command) {
  console.log(`\n[dev:local] ${label}`);
  const result = spawnSync(command, { env, shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[dev:local] "${label}" failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

if (!(await postgresIsUp())) {
  console.error(
    '[dev:local] PostgreSQL does not answer on localhost:5432.\n' +
      '  Start it with:  docker compose up -d\n' +
      '  or on Windows:  powershell -ExecutionPolicy Bypass -File scripts/pg-local.ps1 start',
  );
  process.exit(1);
}

run(
  'build workspace packages',
  'pnpm exec turbo run build "--filter=@nexus/api^..." "--filter=@nexus/worker^..." "--filter=@nexus/web^..."',
);
run('migrate', 'pnpm db:migrate');
run('seed (demo roles, local logins)', 'pnpm db:seed');

const apps = [
  ['api', 'pnpm --filter @nexus/api dev'],
  ['worker', 'pnpm --filter @nexus/worker dev'],
  ['web', 'pnpm --filter @nexus/web exec vite'],
];
const children = apps.map(([name, command]) => {
  const child = spawn(command, { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line) out.write(`[${name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[dev:local] ${name} stopped (${code}).`);
    shutdown(code ?? 0);
  });
  return child;
});

console.log(
  '\n[dev:local] Open http://localhost:5173 and use the user menu: "Sign in as ...". API: http://localhost:3000. Ctrl+C stops everything.',
);

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid === undefined) continue;
    if (process.platform === 'win32') spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
