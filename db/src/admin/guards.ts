import { isIP } from 'node:net';

/** The database name in a connection string. */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    // no host part ("postgres://user@/db"): the WHATWG URL parser rejects it
    return decodeURIComponent(/^[a-z]+:\/\/[^/]*\/([^?]*)/i.exec(url)?.[1] ?? '');
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `db:migrate down` and `redo` drop tables (down 0001 drops every schema). They run without questions
 * only when APP_ENV=local AND the database host is this machine (see isLocalHost). Anywhere else the
 * caller must repeat the database name (`--confirm-database=<name>`), and it must match the database in
 * DATABASE_ADMIN_URL. Checked inside migrate() itself, so no caller can skip it.
 */
export function assertMayRevert(options: {
  appEnv: string | undefined;
  url: string;
  confirmDatabase?: string | undefined;
  env?: Env;
}): void {
  if (options.appEnv === 'local' && isLocalHost(options.url, options.env)) return;
  const name = databaseName(options.url);
  if (options.confirmDatabase === undefined || options.confirmDatabase !== name) {
    throw new Error(
      `Refusing to revert migrations (APP_ENV is ${options.appEnv ?? 'unset'}, or the database is not on this machine): this drops tables. ` +
        `If you really mean it, add --confirm-database=<the database name> (it must match DATABASE_ADMIN_URL).`,
    );
  }
}

const isLoopbackName = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.startsWith('/')) return true; // unix socket directory
  if (h === 'localhost') return true;
  if (isIP(h) === 4) return h.startsWith('127.');
  if (isIP(h) === 6) return h === '::1';
  return false;
};

/**
 * Hosts that count as "this machine" for the local-only seeds and for unconfirmed reverts: localhost,
 * loopback addresses and unix sockets (a host starting with "/" or given as ?host=/...). A URL with no
 * host at all makes libpq use PGHOST, so it counts as local only when PGHOST is unset or itself local.
 */
export function isLocalHost(url: string, env: Env = process.env): boolean {
  let queryHost: string | null;
  let hostname: string;
  try {
    const u = new URL(url);
    queryHost = u.searchParams.get('host');
    hostname = u.hostname;
  } catch {
    // "postgres://user@/db?host=/var/run/postgresql": no host part, WHATWG URL rejects it.
    queryHost = /[?&]host=([^&]*)/.exec(url)?.[1] ?? null;
    hostname = '';
  }
  const explicit = queryHost !== null ? decodeURIComponent(queryHost) : hostname;
  if (explicit !== '') return isLoopbackName(explicit);
  // No host in the URL: the default socket, or whatever PGHOST says.
  const pgHost = env['PGHOST']?.trim();
  return pgHost === undefined || pgHost === '' ? true : isLoopbackName(pgHost);
}
