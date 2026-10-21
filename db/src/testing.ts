import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { migrate } from './admin/migrate.js';
import { MIGRATIONS_DIR, ROLES_FILE, SEEDS_DIR } from './admin/paths.js';
import { seed } from './admin/seed.js';
import { withDatabaseName } from './urls.js';

/**
 * Integration tests that need PostgreSQL read the administrator connection from
 * TEST_DATABASE_ADMIN_URL (any database on a server where the user can create databases and roles).
 * Locally: postgres://nexus@localhost:5432/postgres. CI: the postgres:16 service in ci.yml.
 * When it is unset the tests are skipped (vitest `describe.skipIf(!testDatabaseAdminUrl)`).
 */
export const testDatabaseAdminUrl: string | undefined = process.env['TEST_DATABASE_ADMIN_URL']?.trim() || undefined;

export const SKIP_MESSAGE =
  'TEST_DATABASE_ADMIN_URL is not set: PostgreSQL integration tests are skipped (see docs/14-testing-quality.md).';

if (testDatabaseAdminUrl === undefined) {
  // In CI the database tests must never skip silently: a missing variable is a broken pipeline.
  if (process.env['CI']) {
    throw new Error('TEST_DATABASE_ADMIN_URL is not set but CI is: the PostgreSQL tests would be skipped. Set it in the workflow (postgres:16 service).');
  }
  console.warn(SKIP_MESSAGE);
}

export interface TestDatabase {
  name: string;
  /** Administrator connection to the new database. */
  adminUrl: string;
  /** Drops the database (connections are terminated). */
  drop: () => Promise<void>;
}

/** Serialises template builds and clones between processes that share the server (parallel packages). */
const TEMPLATE_LOCK = 7_241_865_325_823_966n;

/**
 * Changes whenever a migration, roles.sql or a seed changes, and every UTC day. The day matters:
 * migration 0001 creates the partitions of telemetry.packet (9 days) and audit.log (3 months) around
 * the date it runs, so a template built last week would lack today's partitions and writes into
 * audit.log would fail with "no partition of relation found".
 */
function schemaHash(): string {
  const hash = createHash('sha1');
  hash.update(new Date().toISOString().slice(0, 10));
  for (const dir of [MIGRATIONS_DIR, SEEDS_DIR]) {
    for (const file of readdirSync(dir).sort()) hash.update(file).update(readFileSync(`${dir}/${file}`));
  }
  hash.update(readFileSync(ROLES_FILE));
  return hash.digest('hex').slice(0, 12);
}

/**
 * Migrating (and seeding) a database takes 9 to 16 s even on an idle machine, and every test file used
 * to do it again; with ten packages running at once that passed the 10 s hook limit. So it is done once
 * per server and per schema version into a template database, and each test database is a file-level
 * copy of it (`CREATE DATABASE ... TEMPLATE`). Built under an advisory lock, under a temporary name
 * that is renamed when complete, so a crashed build never leaves a half-made template. Templates of
 * older schema versions are left alone (another checkout may be using them).
 */
async function createFromTemplate(admin: pg.Client, name: string, template: string): Promise<void> {
  // A connection that was just closed can linger for a moment; the template must be unused.
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006' || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Builds the template if it does not exist yet. Call with TEMPLATE_LOCK held. The seeded one starts from the bare one. */
async function ensureTemplate(admin: pg.Client, url: string, withSeed: boolean, hash: string): Promise<string> {
  const template = `nexus_tpl_${withSeed ? 'seeded' : 'bare'}_${hash}`;
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [template]);
  if (exists.rowCount !== 0) return template;
  const building = `${template}_building`;
  await admin.query(`DROP DATABASE IF EXISTS "${building}" WITH (FORCE)`);
  if (withSeed) {
    await createFromTemplate(admin, building, await ensureTemplate(admin, url, false, hash));
    await seed({ url: withDatabaseName(url, building), appEnv: 'dev' });
  } else {
    await admin.query(`CREATE DATABASE "${building}"`);
    await migrate({ url: withDatabaseName(url, building), direction: 'up' });
  }
  await admin.query(`ALTER DATABASE "${building}" RENAME TO "${template}"`);
  return template;
}

async function cloneTemplate(name: string, withSeed: boolean): Promise<void> {
  if (testDatabaseAdminUrl === undefined) throw new Error(SKIP_MESSAGE);
  const admin = new pg.Client({ connectionString: testDatabaseAdminUrl });
  await admin.connect();
  try {
    // Only the build is serialised; once the template exists, copies run in parallel.
    await admin.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK.toString()]);
    let template: string;
    try {
      template = await ensureTemplate(admin, testDatabaseAdminUrl, withSeed, schemaHash());
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK.toString()]);
    }
    await createFromTemplate(admin, name, template);
  } finally {
    await admin.end();
  }
}

/**
 * A fresh, migrated database with its own random name, so test files can run in parallel and never
 * touch the developer's data. Roles are cluster-wide and shared; the grants inside are per database.
 */
export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  if (testDatabaseAdminUrl === undefined) throw new Error(SKIP_MESSAGE);
  const name = `nexus_test_${randomBytes(5).toString('hex')}`;
  try {
    await cloneTemplate(name, options.seed === true);
  } catch (error) {
    await dropDatabase(name);
    throw error;
  }
  return { name, adminUrl: withDatabaseName(testDatabaseAdminUrl, name), drop: () => dropDatabase(name) };
}

async function dropDatabase(name: string): Promise<void> {
  if (testDatabaseAdminUrl === undefined) return;
  const admin = new pg.Client({ connectionString: testDatabaseAdminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
