import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { assertMayRevert } from './guards.js';
import { MIGRATIONS_DIR, readSql, ROLES_FILE } from './paths.js';

/** Serialises role bootstrap between processes that share a cluster (parallel test files, two deploys). */
const BOOTSTRAP_LOCK = 7_241_865_325_823_965n;

/** Table that records applied migrations. It lives in `public`, because `core` does not exist before 0001. */
export const MIGRATIONS_TABLE = 'pgmigrations';

/** The role that owns every table and function (db/roles.sql). Migrations and seeds run as it. */
export const MIGRATOR_ROLE = 'nexus_migrator';

export type MigrateDirection = 'up' | 'down';

export interface MigrateOptions {
  /** Connection of an administrator (DATABASE_ADMIN_URL) to the target database. */
  url: string;
  direction: MigrateDirection;
  /** How many migrations to run. Default: all pending (up), one (down). Infinity = all. */
  count?: number;
  /** Needed for a revert outside APP_ENV=local or on a remote host: the exact database name (guards.ts). */
  confirmDatabase?: string;
  /** Defaults to process.env.APP_ENV. */
  appEnv?: string | undefined;
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: string[];
}

/**
 * Applies or reverts migrations as nexus_migrator, then (after `up`) re-applies db/roles.sql so every
 * table and function has its grants. Safe to run again.
 *
 * The administrator connection needs to be able to create roles (locally the superuser `nexus`; in
 * Azure a member of azure_pg_admin). Everything after that runs as nexus_migrator, so the objects are
 * owned by it and the SECURITY DEFINER partition functions can do their job.
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const log = options.log ?? ((): void => undefined);
  if (options.direction === 'down') {
    assertMayRevert({
      appEnv: 'appEnv' in options ? options.appEnv : process.env['APP_ENV'],
      url: options.url,
      confirmDatabase: options.confirmDatabase,
    });
  }
  const client = new pg.Client({ connectionString: options.url, application_name: 'nexus-migrate' });
  await client.connect();
  try {
    await bootstrapRoles(client);
    await client.query(`SET ROLE ${MIGRATOR_ROLE}`);

    const before = await appliedMigrations(client);
    await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: options.direction,
      // node-pg-migrate defaults: up = all pending, down = one.
      ...(options.count !== undefined ? { count: options.count } : {}),
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: 'public',
      schema: 'public',
      checkOrder: true,
      singleTransaction: true,
      log: (msg) => log(msg),
    });
    const after = await appliedMigrations(client);

    if (options.direction === 'up') await applyRoles(client);

    const applied =
      options.direction === 'up'
        ? after.filter((n) => !before.includes(n))
        : before.filter((n) => !after.includes(n));
    return { applied };
  } finally {
    await client.end();
  }
}

async function appliedMigrations(client: pg.Client): Promise<string[]> {
  const exists = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.${MIGRATIONS_TABLE}') AS t`,
  );
  if (exists.rows[0]?.t == null) return [];
  const res = await client.query<{ name: string }>(
    `SELECT name FROM public.${MIGRATIONS_TABLE} ORDER BY id`,
  );
  return res.rows.map((r) => r.name);
}

/**
 * Creates the three NOLOGIN roles if missing and lets nexus_migrator create things in this database.
 * Needs a role that can create roles. Idempotent.
 */
export async function bootstrapRoles(client: pg.Client): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_LOCK.toString()]);
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') THEN CREATE ROLE nexus_migrator NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_api')      THEN CREATE ROLE nexus_api NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_worker')   THEN CREATE ROLE nexus_worker NOLOGIN; END IF;
        -- Needed for SET ROLE by an administrator that is not a superuser (Azure).
        IF NOT pg_has_role(current_user, 'nexus_migrator', 'MEMBER') THEN
          EXECUTE format('GRANT nexus_migrator TO %I', current_user);
        END IF;
        EXECUTE format('GRANT CREATE ON DATABASE %I TO nexus_migrator', current_database());
        -- Only the Nexus roles (and the owner / superusers) may connect or create temp tables: every
        -- other role of the server loses the default PUBLIC rights. One server per environment (docs/06 section 9).
        EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO nexus_migrator, nexus_api, nexus_worker', current_database());
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO nexus_migrator;`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [BOOTSTRAP_LOCK.toString()]);
  }
}

/** db/roles.sql: roles and grants. Run as nexus_migrator after the schema exists. Idempotent. */
export async function applyRoles(client: pg.Client): Promise<void> {
  await client.query(readSql(ROLES_FILE));
}
