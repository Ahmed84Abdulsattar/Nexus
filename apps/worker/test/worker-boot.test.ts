import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/worker.module.js';

/**
 * The whole worker, started like main.ts does: leader lock, scheduler, fixture connector (no
 * DATOMS_LIVE), catalogue sync on start. Locks are per database, so a worker running on the same
 * server cannot interfere with this fresh test database.
 */
describe.skipIf(testDatabaseAdminUrl === undefined)(
  'worker boot (fixtures, PostgreSQL)',
  { timeout: 60_000 },
  () => {
    let testDb: TestDatabase;
    const saved = { ...process.env };

    beforeAll(async () => {
      testDb = await createTestDatabase({ seed: true });
    });
    afterAll(async () => {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
      await testDb?.drop();
    });

    it('takes the leader lock, runs the catalogue sync on start from fixtures, and releases the lock on shutdown', async () => {
      Object.assign(process.env, {
        APP_ENV: 'local',
        WORKER_DATABASE_URL: testDb.adminUrl,
        DATOMS_LIVE: 'false',
      });
      delete process.env['DATOMS_TOKEN'];

      const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
      await moduleRef.init();

      const admin = new pg.Client({ connectionString: testDb.adminUrl });
      await admin.connect();
      try {
        let assets = 0;
        for (let i = 0; i < 100 && assets < 22; i++) {
          assets = Number((await admin.query('SELECT count(*) AS n FROM core.asset')).rows[0].n);
          if (assets < 22) await new Promise((r) => setTimeout(r, 100));
        }
        expect(assets).toBe(22);
        const run = await admin.query(
          `SELECT status, details->>'inserted' AS inserted FROM integration.sync_run WHERE job = 'catalogue_sync'`,
        );
        expect(run.rows).toEqual([{ status: 'ok', inserted: '22' }]);

        // The lock is held by a session of this worker.
        const held = await admin.query(
          `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
        );
        expect(Number(held.rows[0].n)).toBe(1);

        await moduleRef.close(); // shutdown hooks: stop schedule, wait for jobs, release the lock
        const after = await admin.query(
          `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
        );
        expect(Number(after.rows[0].n)).toBe(0);
      } finally {
        await admin.end();
      }
    });
  },
);
