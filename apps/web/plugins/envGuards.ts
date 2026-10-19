/**
 * Build-time guards for the web app's environment (S0-09 security review L2, L3). Everything with
 * a `VITE_` prefix is copied into the browser bundle, so only names on this list may exist.
 */
export const ALLOWED_VITE_VARS = [
  'VITE_API_BASE_URL',
  'VITE_ENTRA_TENANT_ID',
  'VITE_ENTRA_API_SCOPE',
  'VITE_ENTRA_WEB_CLIENT_ID',
] as const;

/** Allowed in serve mode only: read by the dev-only MSW /v1/config mock, never in a build. */
export const DEV_ONLY_VITE_VARS = ['VITE_DEV_ARCGIS_API_KEY'] as const;

export interface EnvGuardInput {
  command: 'build' | 'serve';
  /** `process.env.NODE_ENV` when the config is evaluated. */
  nodeEnv: string | undefined;
  /** `loadEnv(mode, envDir, 'VITE_')`. */
  env: Record<string, string>;
}

/** Throws when the environment could put a secret or a dev-only value into a build. Never prints values. */
export function assertWebEnv({ command, nodeEnv, env }: EnvGuardInput): void {
  // A build with NODE_ENV=development keeps `import.meta.env.DEV` true, which would pull the MSW
  // mock (and the dev key reader) into dist/.
  if (command === 'build' && nodeEnv === 'development') {
    throw new Error(
      'A build must not run with NODE_ENV=development (it would bundle the dev mocks).',
    );
  }
  const allowed = new Set<string>(ALLOWED_VITE_VARS);
  for (const name of Object.keys(env)) {
    if (allowed.has(name)) continue;
    if (command === 'serve' && (DEV_ONLY_VITE_VARS as readonly string[]).includes(name)) continue;
    if (name === 'VITE_DEV_ARCGIS_API_KEY' && !env[name]) continue; // empty placeholder from .env.example
    throw new Error(
      `${name} is not an allowed VITE_ variable. VITE_ values are public in the browser bundle; ` +
        `allowed: ${[...ALLOWED_VITE_VARS].join(', ')}` +
        `${command === 'serve' ? ` (and ${DEV_ONLY_VITE_VARS.join(', ')} in dev)` : ''}.`,
    );
  }
}
