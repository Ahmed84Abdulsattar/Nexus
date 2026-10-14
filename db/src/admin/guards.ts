import { isIP } from 'node:net';

/** The database name in a connection string. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/**
 * `db:migrate down` and `redo` drop tables (down 0001 drops every schema). They run without
 * questions only when APP_ENV=local. Anywhere else (dev, prod, or APP_ENV unset) the caller must repeat
 * the database name: `--confirm-database=<name>`, and it must match the database in DATABASE_ADMIN_URL.
 */
export function assertMayRevert(options: {
  appEnv: string | undefined;
  url: string;
  args: readonly string[];
}): void {
  if (options.appEnv === 'local') return;
  const name = databaseName(options.url);
  const given = options.args.find((a) => a.startsWith('--confirm-database='))?.slice('--confirm-database='.length);
  if (given === undefined || given !== name) {
    throw new Error(
      `Refusing to revert migrations when APP_ENV is ${options.appEnv ?? 'unset'}: this drops tables. ` +
        `If you really mean it, add --confirm-database=<the database name> (it must match DATABASE_ADMIN_URL).`,
    );
  }
}

/**
 * Hosts that count as "this machine" for the local-only seeds: localhost, loopback addresses and unix
 * sockets (a host starting with "/" or given as ?host=/...). Anything else is a remote server.
 */
export function isLocalHost(url: string): boolean {
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
    if (queryHost === null) return false; // cannot tell: not local
  }
  const host = decodeURIComponent(queryHost ?? hostname).replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '' || host.startsWith('/')) return true; // unix socket (or the libpq default socket)
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return host.startsWith('127.');
  if (isIP(host) === 6) return host === '::1';
  return false;
}
