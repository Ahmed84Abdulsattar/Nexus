import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

export interface CreateDatabaseOptions {
  url: string;
  /** Pool size. Default 10 (DATABASE_POOL_MAX). */
  poolMax?: number;
  /** Shows in pg_stat_activity, e.g. `nexus-api`. */
  applicationName: string;
  /**
   * Server-side limit per statement in milliseconds. The API sets one so a slow query cannot hold a
   * connection; the worker leaves it unset because rollups can run for a while.
   */
  statementTimeoutMs?: number;
  /**
   * Run every connection as this role (SET ROLE through the startup options). For tests that
   * connect as an administrator but must see exactly one app role's grants. Never set in an app.
   */
  sessionRole?: string;
  /** Receives errors from idle pooled connections (otherwise they would crash the process). */
  onPoolError?: (error: Error) => void;
}

/**
 * The one way the api and the worker create their typed query builder. The pool is lazy: nothing
 * connects until the first query, so building the application (tests, the OpenAPI generator)
 * touches no database.
 */
export function createDatabase(options: CreateDatabaseOptions): Database {
  const startupOptions = [
    options.statementTimeoutMs !== undefined
      ? `-c statement_timeout=${Math.trunc(options.statementTimeoutMs)}`
      : undefined,
    options.sessionRole !== undefined ? `-c role=${options.sessionRole}` : undefined,
  ].filter((o): o is string => o !== undefined);

  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    application_name: options.applicationName,
    ...(startupOptions.length > 0 ? { options: startupOptions.join(' ') } : {}),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (error) => options.onPoolError?.(error));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
