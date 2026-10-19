/**
 * Which database connection string a process uses (docs/04 "Environment variables", docs/06 section 9).
 *
 * Three roles, three variables. Each process connects as its own least-privilege database user:
 *
 *   admin   DATABASE_ADMIN_URL    migrations and seeds (can create roles, schemas and tables)
 *   worker  WORKER_DATABASE_URL   the worker process
 *   api     DATABASE_URL          the API process
 *
 * Fallback: only when APP_ENV is exactly `local`, an unset DATABASE_ADMIN_URL or WORKER_DATABASE_URL
 * falls back to DATABASE_URL, so one local `.env` line is enough to start. In dev and prod there is
 * NO fallback, and APP_ENV unset counts as not local. A fallback there would run migrations as the API
 * user (which fails) or, worse, run the worker as a user whose grants are not the worker's, and the
 * missing variable would stay hidden until something broke. Every dev and prod deployment must set
 * all three. The error names the missing variable and never prints a URL (it may hold a password).
 */

import { parse } from 'pg-connection-string';

export type DatabaseRole = 'admin' | 'worker' | 'api';

export const DATABASE_URL_VARIABLE: Readonly<Record<DatabaseRole, string>> = {
  admin: 'DATABASE_ADMIN_URL',
  worker: 'WORKER_DATABASE_URL',
  api: 'DATABASE_URL',
};

export class DatabaseConfigError extends Error {
  override readonly name = 'DatabaseConfigError';
}

export interface ResolvedDatabaseUrl {
  url: string;
  /** The variable the value came from. */
  variable: string;
  /** True when DATABASE_URL was used because the role's own variable was unset (APP_ENV=local only). */
  fellBack: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const nonEmpty = (v: string | undefined): string | undefined =>
  v === undefined || v.trim() === '' ? undefined : v.trim();

export function resolveDatabaseUrl(env: Env, role: DatabaseRole): ResolvedDatabaseUrl {
  const own = DATABASE_URL_VARIABLE[role];
  const direct = nonEmpty(env[own]);
  if (direct !== undefined) {
    return { url: requireTlsUnlessLocal(assertPostgresUrl(direct, own), own, env['APP_ENV']), variable: own, fellBack: false };
  }

  if (role !== 'api' && env['APP_ENV'] === 'local') {
    const shared = nonEmpty(env['DATABASE_URL']);
    if (shared !== undefined) {
      return {
        url: requireTlsUnlessLocal(assertPostgresUrl(shared, 'DATABASE_URL'), 'DATABASE_URL', env['APP_ENV']),
        variable: 'DATABASE_URL',
        fellBack: true,
      };
    }
  }
  const hint =
    role !== 'api' && env['APP_ENV'] !== 'local'
      ? ` There is no fallback to DATABASE_URL unless APP_ENV=local (APP_ENV is ${env['APP_ENV'] ?? 'unset'}).`
      : '';
  throw new DatabaseConfigError(`${own} is not set.${hint}`);
}

/**
 * Outside APP_ENV=local (dev, prod, unset) the connection must use TLS: the URL needs sslmode=require,
 * verify-ca or verify-full (or ssl=true). Azure Database for PostgreSQL Flexible Server requires TLS and
 * accepts sslmode=verify-full with the system CA store (preferred: it also checks the server's
 * certificate); sslmode=require encrypts without checking who answers. The value is never printed.
 */
export function requireTlsUnlessLocal(url: string, variable: string, appEnv: string | undefined): string {
  if (appEnv === 'local') return url;
  const params = new URL(url).searchParams;
  // When sslmode is present EVERY value must be a TLS mode, whatever "ssl" says (?ssl=true&sslmode=disable
  // is refused). "ssl=true" counts only when there is no sslmode at all.
  const modes = params.getAll('sslmode');
  const tlsModes = ['require', 'verify-ca', 'verify-full'];
  const ok =
    modes.length > 0
      ? modes.every((m) => tlsModes.includes(m))
      : params.has('ssl') && params.getAll('ssl').every((v) => v === 'true');
  if (!ok) {
    throw new DatabaseConfigError(
      `${variable} must use TLS outside APP_ENV=local: add ?sslmode=verify-full (or sslmode=require) to the URL.`,
    );
  }
  return url;
}

/**
 * The API's LISTEN connection must be direct. Refuses the PgBouncer port 6432 as the node-postgres driver
 * will actually use it: a "?port=" query parameter overrides the port in the URL, so that parameter is
 * refused outright, and the effective port is read with the driver's own parser (pg-connection-string).
 */
export function assertDirectConnection(url: string, variable = 'DATABASE_URL'): void {
  let hasPortParam: boolean;
  let port: string | number | null | undefined;
  try {
    hasPortParam = new URL(url).searchParams.has('port');
    port = parse(url).port;
  } catch {
    throw new DatabaseConfigError(`${variable} is not a valid URL (value not shown).`);
  }
  if (hasPortParam) {
    throw new DatabaseConfigError(`${variable} must not set the port as a query parameter (use host:port in the URL).`);
  }
  if (String(port ?? '') === '6432') {
    throw new DatabaseConfigError(
      `${variable} uses port 6432 (the PgBouncer pooler): LISTEN does not work there. Use the direct port 5432.`,
    );
  }
}

function assertPostgresUrl(value: string, variable: string): string {
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new DatabaseConfigError(`${variable} is not a valid URL (value not shown).`);
  }
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new DatabaseConfigError(`${variable} must start with postgres:// or postgresql://`);
  }
  return value;
}

/** host:port/database of a connection string, for logs. Never includes user or password. */
export function describeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(invalid url)';
  }
}

/** The same URL pointing at another database name (used by checks and tests). */
export function withDatabaseName(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}
