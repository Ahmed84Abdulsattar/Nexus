import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment for the OpenAPI generator (Q32, S1-03 security review L6). The document comes from the
 * route table only, so nothing the generator runs may reach real infrastructure, whatever is in the
 * developer's shell or CI environment (DATABASE_URL, tokens, Key Vault ...).
 *
 * Variables outside this allow-list are removed, and the required ones get placeholders. The database
 * host ends in `.invalid` (RFC 2606): it can never resolve, so even a code path that tried to connect
 * could not reach a server. The pool is lazy and the generator never initialises the app, so nothing
 * tries.
 */
const KEEP = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'TZ',
];

export const OFFLINE_ENV: Readonly<Record<string, string>> = {
  APP_ENV: 'local',
  AUTH_MODE: 'entra',
  ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000000',
  ENTRA_API_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
  ENTRA_WEB_CLIENT_ID: '00000000-0000-4000-8000-000000000002',
  ENTRA_API_AUDIENCE: 'api://nexus-api',
  DATABASE_URL: 'postgres://openapi-generator@database.invalid:5432/openapi',
};

/** Replaces the contents of `env` (normally process.env) with the allow-list plus placeholders. */
export function applyOfflineEnvironment(env: NodeJS.ProcessEnv): void {
  const kept = Object.fromEntries(
    KEEP.flatMap((k) => (env[k] !== undefined ? [[k, env[k]] as const] : [])),
  );
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, kept, OFFLINE_ENV);
}

/**
 * apps/api of the checkout that is being built: the nearest folder above `fromUrl` whose
 * package.json is @nexus/api. Never derived from cwd or from a hard-coded root, so a build in a git
 * worktree writes into that worktree. When the build runs with cwd inside an @nexus/api folder
 * (pnpm build does), both must be the same folder, otherwise it stops instead of writing elsewhere.
 */
export function apiPackageRoot(fromUrl: string, cwd: string = process.cwd()): string {
  const start = dirname(fileURLToPath(fromUrl));
  const root = findApiRoot(start);
  if (root === undefined) throw new Error(`No @nexus/api package.json above ${start}`);
  const cwdRoot = findApiRoot(cwd);
  if (cwdRoot !== undefined && realpathSync(cwdRoot) !== realpathSync(root)) {
    throw new Error(
      `Refusing to write the OpenAPI document: the generator runs from ${root} but the current directory belongs to ${cwdRoot}.`,
    );
  }
  return realpathSync(root);
}

function findApiRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        const name = (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name;
        if (name === '@nexus/api') return dir;
      } catch {
        // not readable as JSON: keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
