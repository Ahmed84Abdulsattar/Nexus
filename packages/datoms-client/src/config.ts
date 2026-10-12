/** DATOMS client configuration, read from the environment. Never log `token`. */
export interface DatomsConfig {
  baseUrl: string;
  orgId: string;
  token: string;
  live: boolean;
}

export function loadDatomsConfig(env: NodeJS.ProcessEnv = process.env): DatomsConfig {
  const baseUrl = (env['DATOMS_BASE_URL'] ?? 'https://api.datoms.io/v4').replace(/\/+$/, '');
  return {
    baseUrl,
    orgId: env['DATOMS_ORG_ID'] ?? '',
    token: env['DATOMS_TOKEN'] ?? '',
    live: env['DATOMS_LIVE'] === 'true',
  };
}

/** Throws unless live mode is on and the required values are present. The message never contains the token. */
export function assertLive(config: DatomsConfig): void {
  if (!config.live) throw new Error('Refusing to call DATOMS: DATOMS_LIVE is not "true".');
  if (!config.orgId) throw new Error('DATOMS_ORG_ID is not set.');
  if (!config.token) throw new Error('DATOMS_TOKEN is not set.');
}
