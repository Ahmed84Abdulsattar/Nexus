import { inspect } from 'node:util';

/** DATOMS client configuration. `token` is non-enumerable and redacted in JSON and inspect output. */
export interface DatomsConfig {
  readonly baseUrl: string;
  readonly orgId: string;
  readonly token: string;
  readonly live: boolean;
}

export const DEFAULT_BASE_URL = 'https://api.datoms.io/v4';
export const DATOMS_HOST = 'api.datoms.io';
/**
 * Hosts accepted besides `api.datoms.io`. Empty on purpose: adding a host here is a code change
 * that needs review (the bearer token is sent to the configured host).
 */
export const EXTRA_ALLOWED_HOSTS: readonly string[] = [];

const TOKEN_CHARS = /^[\x21-\x7E]+$/;

export interface ConfigOptions {
  /** Extra hosts for this call only (tests). Never read from the environment. */
  extraAllowedHosts?: readonly string[];
}

/** Returns the normalised base URL or throws. The message never contains the URL or the token. */
export function validateBaseUrl(raw: string, opts: ConfigOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATOMS_BASE_URL is not a valid URL.');
  }
  const allowed = [DATOMS_HOST, ...EXTRA_ALLOWED_HOSTS, ...(opts.extraAllowedHosts ?? [])];
  if (url.protocol !== 'https:') throw new Error('DATOMS_BASE_URL must use https.');
  if (!allowed.includes(url.hostname)) throw new Error('DATOMS_BASE_URL host is not allowed.');
  if (url.port !== '') throw new Error('DATOMS_BASE_URL must not set a port.');
  if (url.username !== '' || url.password !== '') {
    throw new Error('DATOMS_BASE_URL must not contain credentials.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('DATOMS_BASE_URL must not contain a query or fragment.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export function normaliseToken(raw: string): string {
  const token = raw.trim();
  if (token !== '' && !TOKEN_CHARS.test(token)) {
    throw new Error('DATOMS_TOKEN contains characters that are not allowed in a header.');
  }
  return token;
}

/** Builds a validated config whose token never shows up in JSON, logs or `util.inspect`. */
export function createDatomsConfig(
  input: { baseUrl?: string; orgId?: string; token?: string; live?: boolean },
  opts: ConfigOptions = {},
): DatomsConfig {
  const cfg = {
    baseUrl: validateBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL, opts),
    orgId: input.orgId ?? '',
    live: input.live === true,
  } as { baseUrl: string; orgId: string; live: boolean; token: string };
  Object.defineProperty(cfg, 'token', {
    value: normaliseToken(input.token ?? ''),
    enumerable: false,
    writable: false,
  });
  const redacted = () => ({
    baseUrl: cfg.baseUrl,
    orgId: cfg.orgId,
    live: cfg.live,
    token: '[redacted]',
  });
  Object.defineProperty(cfg, 'toJSON', { value: redacted, enumerable: false });
  Object.defineProperty(cfg, inspect.custom, {
    value: () => `DatomsConfig ${JSON.stringify(redacted())}`,
    enumerable: false,
  });
  return cfg;
}

export function loadDatomsConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: ConfigOptions = {},
): DatomsConfig {
  return createDatomsConfig(
    {
      baseUrl: env['DATOMS_BASE_URL'] || DEFAULT_BASE_URL,
      orgId: env['DATOMS_ORG_ID'] ?? '',
      token: env['DATOMS_TOKEN'] ?? '',
      live: env['DATOMS_LIVE'] === 'true',
    },
    opts,
  );
}

/** Throws unless live mode is on and the required values are present. The message never contains the token. */
export function assertLive(config: DatomsConfig): void {
  if (!config.live) throw new Error('Refusing to call DATOMS: DATOMS_LIVE is not "true".');
  if (!config.orgId) throw new Error('DATOMS_ORG_ID is not set.');
  if (!config.token) throw new Error('DATOMS_TOKEN is not set.');
}
