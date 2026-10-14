import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './admin/migrate.js';
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

if (testDatabaseAdminUrl === undefined) console.warn(SKIP_MESSAGE);

export interface TestDatabase {
  name: string;
  /** Administrator connection to the new database. */
  adminUrl: string;
  /** Drops the database (connections are terminated). */
  drop: () => Promise<void>;
}

/**
 * A fresh, migrated database with its own random name, so test files can run in parallel and never
 * touch the developer's data. Roles are cluster-wide and shared; the grants inside are per database.
 */
export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  if (testDatabaseAdminUrl === undefined) throw new Error(SKIP_MESSAGE);
  const name = `nexus_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: testDatabaseAdminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const adminUrl = withDatabaseName(testDatabaseAdminUrl, name);
  try {
    await migrate({ url: adminUrl, direction: 'up' });
    if (options.seed) await seed({ url: adminUrl, appEnv: 'dev' });
  } catch (error) {
    await dropDatabase(name);
    throw error;
  }
  return { name, adminUrl, drop: () => dropDatabase(name) };
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
