import pg from 'pg';
import { isLocalHost } from './guards.js';
import { MIGRATOR_ROLE } from './migrate.js';
import { readSql, SEEDS_DIR } from './paths.js';

export type AppEnv = 'local' | 'dev' | 'prod';

export function parseAppEnv(value: string | undefined): AppEnv {
  if (value === 'local' || value === 'dev' || value === 'prod') return value;
  throw new Error(`APP_ENV must be local, dev or prod (it is ${value ?? 'unset'}).`);
}

interface SeedFile {
  file: string;
  /** Environments that run it. */
  envs: readonly AppEnv[];
  /** true: runs as the administrator (it creates roles); false: as nexus_migrator, the table owner. */
  asAdmin: boolean;
  why: string;
  /** true: refuse unless the database host is this machine (loopback, localhost or a unix socket). */
  localHostOnly?: boolean;
}

/**
 * The seeds `pnpm db:seed` runs, in order (docs/06 section 8, rule 5). Each file is idempotent.
 * Environment-specific data never goes into migrations.
 */
export const SEEDS: readonly SeedFile[] = [
  {
    file: 'datoms-parameters.sql',
    envs: ['local', 'dev', 'prod'],
    asAdmin: false,
    why: 'DATOMS parameter list and category names (ADR 0011): source data, every environment',
  },
  {
    file: 'dev-roles.sql',
    envs: ['local', 'dev'],
    asAdmin: false,
    why: 'demo Entra group to role mappings',
  },
  {
    file: 'dev-login-roles.sql',
    envs: ['local'],
    asAdmin: true,
    localHostOnly: true,
    why: 'passwordless LOGIN users nexus_api_local / nexus_worker_local (APP_ENV=local only)',
  },
];

export interface SeedResult {
  ran: string[];
  skipped: string[];
}

/**
 * Runs the seeds that belong to `appEnv`. The administrator connection is needed by
 * dev-login-roles.sql (it creates LOGIN roles); the others run as nexus_migrator, the owner of the
 * tables. Every file refuses to run when `nexus.app_env` does not allow it, as a second guard.
 */
export async function seed(options: {
  url: string;
  appEnv: AppEnv;
  log?: (message: string) => void;
}): Promise<SeedResult> {
  const log = options.log ?? ((): void => undefined);
  const client = new pg.Client({ connectionString: options.url, application_name: 'nexus-seed' });
  await client.connect();
  const result: SeedResult = { ran: [], skipped: [] };
  try {
    const roles = await client.query<{ ok: boolean }>(
      `SELECT count(*) = 3 AS ok FROM pg_roles WHERE rolname IN ('nexus_migrator', 'nexus_api', 'nexus_worker')`,
    );
    if (!roles.rows[0]?.ok) throw new Error('The Nexus roles do not exist. Run `pnpm db:migrate` first.');
    await client.query(`SELECT set_config('nexus.app_env', $1, false)`, [options.appEnv]);

    for (const s of SEEDS) {
      if (!s.envs.includes(options.appEnv)) {
        result.skipped.push(s.file);
        log(`skip  ${s.file} (not for APP_ENV=${options.appEnv})`);
        continue;
      }
      if (s.localHostOnly && !isLocalHost(options.url)) {
        throw new Error(`${s.file} creates passwordless login users and runs only against a local database (localhost, 127.0.0.1, ::1 or a unix socket); this host is remote.`);
      }
      log(`seed  ${s.file}: ${s.why}`);
      if (!s.asAdmin) await client.query(`SET ROLE ${MIGRATOR_ROLE}`);
      try {
        await client.query(readSql(`${SEEDS_DIR}/${s.file}`));
      } finally {
        await client.query('RESET ROLE');
      }
      result.ran.push(s.file);
    }
    return result;
  } finally {
    await client.end();
  }
}
