/**
 * Extra refusals for AUTH_MODE=dev (docs/08 section 7), read from the raw environment. Kept apart
 * from env.ts so that file stays small. Returns the problems (empty when dev mode may run).
 */

/** Variables that hosting platforms set inside a deployed container or a hosted workspace. */
export const PLATFORM_MARKERS = [
  'CONTAINER_APP_NAME',
  'CONTAINER_APP_REPLICA_NAME',
  'KUBERNETES_SERVICE_HOST',
  'WEBSITE_INSTANCE_ID',
  'IDENTITY_ENDPOINT',
  'CODESPACES',
] as const;

export function devModeProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  // A trusted proxy makes the client address (and forwarding headers) believable to the API; local
  // sign-in must see the raw socket only.
  const proxy = (env['TRUST_PROXY'] ?? '').trim().toLowerCase();
  if (proxy !== '' && proxy !== 'false') {
    problems.push('AUTH_MODE=dev cannot be used with TRUST_PROXY (leave it unset or false)');
  }
  // Browser origins must be this machine too (a tunnel's public origin would be accepted otherwise).
  for (const origin of (env['CORS_ALLOWED_ORIGINS'] ?? '').split(',')) {
    const item = origin.trim();
    if (item === '') continue;
    let host = '';
    try {
      host = new URL(item).hostname;
    } catch {
      /* reported below */
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      problems.push(
        'AUTH_MODE=dev allows only localhost, 127.0.0.1 or [::1] in CORS_ALLOWED_ORIGINS',
      );
      break;
    }
  }
  const markers = PLATFORM_MARKERS.filter((name) => (env[name] ?? '') !== '');
  if (markers.length > 0) {
    problems.push(
      `AUTH_MODE=dev cannot run in a hosted container or workspace (${markers.join(', ')} is set)`,
    );
  }
  return problems;
}
