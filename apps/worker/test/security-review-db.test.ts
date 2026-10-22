import 'reflect-metadata';
import { createDatomsConnector } from '@nexus/connectors-datoms';
import { createDatabase, type Database } from '@nexus/db';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalogueSettings } from '../src/catalogue/catalogue-settings.js';
import { KyselyCatalogueRepository } from '../src/catalogue/kysely-catalogue.repository.js';
import { CatalogueSyncJob } from '../src/jobs/catalogue-sync.job.js';
import { WorkerConnector } from '../src/jobs/worker-connector.js';
import { LoggingMetrics } from '../src/observability/metrics.js';
import type { SchedulerService } from '../src/scheduler/scheduler.service.js';

describe.skipIf(testDatabaseAdminUrl === undefined)(
  'security review fixes on PostgreSQL',
  { timeout: 60_000 },
  () => {
    let testDb: TestDatabase;
    let admin: pg.Client;
    let db: Database;

    beforeAll(async () => {
      testDb = await createTestDatabase({ seed: true }); // APP_ENV=dev seeds
      admin = new pg.Client({ connectionString: testDb.adminUrl });
      await admin.connect();
      db = createDatabase({
        url: testDb.adminUrl,
        applicationName: 'test',
        sessionRole: 'nexus_worker',
        poolMax: 4,
      });
    });
    afterAll(async () => {
      await db?.destroy();
      await admin?.end();
      await testDb?.drop();
    });

    const setInterval_ = (v: string): Promise<unknown> =>
      admin.query(
        `UPDATE core.setting SET value = $1::jsonb WHERE key = 'catalogue.interval_minutes'`,
        [v],
      );

    it('M2: catalogue.interval_minutes outside 5..1440 or not an integer falls back to 60 and is reported', async () => {
      for (const bad of ['1', '4', '1441', '90.5', '"x"', 'null', '1e12']) {
        await setInterval_(bad);
        const seen: unknown[] = [];
        const s = await loadCatalogueSettings(db, (v) => seen.push(v));
        expect(s.intervalMs).toBe(60 * 60_000);
        expect(seen).toHaveLength(1);
      }
      for (const [good, minutes] of [
        ['5', 5],
        ['1440', 1440],
        ['30', 30],
      ] as const) {
        await setInterval_(good);
        const seen: unknown[] = [];
        expect((await loadCatalogueSettings(db, (v) => seen.push(v))).intervalMs).toBe(
          minutes * 60_000,
        );
        expect(seen).toEqual([]);
      }
      await setInterval_('60');
    });

    it('M4: the dev seed sets a small share and the four-asset poll subset (one per category)', async () => {
      const r = await admin.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM core.setting WHERE key IN ('budget.max_share', 'poll.subset_external_ids')`,
      );
      const by = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
      expect(by['budget.max_share']).toBe(0.1);
      expect(by['poll.subset_external_ids']).toEqual(['43644', '43514', '43512', '42426']);
    });

    it('L6 and M4: a job run records the mode and reads the share from core.setting', async () => {
      const connector = new WorkerConnector(
        async () =>
          (
            await db
              .selectFrom('core.setting')
              .select('value')
              .where('key', '=', 'budget.max_share')
              .executeTakeFirst()
          )?.value,
        (maxShare) => createDatomsConnector({ env: {}, maxShare }),
        { warn() {} },
      );
      const job = new CatalogueSyncJob(
        db,
        connector,
        new LoggingMetrics(),
        { register() {}, requestEarly: () => 'started' } as unknown as SchedulerService,
        'fixtures',
      );
      const details = await job.run();
      expect(details).toMatchObject({ seen: 22, complete: true, mode: 'fixtures' });
      expect(connector.currentShare).toBe(0.1);
      const row = await admin.query(
        `SELECT details->>'mode' AS mode FROM integration.sync_run ORDER BY id DESC LIMIT 1`,
      );
      expect(row.rows[0]).toEqual({ mode: 'fixtures' });
    });

    it('L1: a repository bound to an aborted signal writes nothing', async () => {
      const ctl = new AbortController();
      ctl.abort(new Error('lock lost'));
      const repo = new KyselyCatalogueRepository(db).withSignal(ctl.signal);
      await expect(repo.markSeen('datoms', ['43644'], new Date())).rejects.toThrow('lock lost');
    });

    it('L5: a batch gives up on a lock held by someone else (lock_timeout 5 s) instead of waiting for ever', async () => {
      const repo = new KyselyCatalogueRepository(db);
      const holder = new pg.Client({ connectionString: testDb.adminUrl });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`LOCK TABLE core.asset IN ACCESS EXCLUSIVE MODE`);
        const started = Date.now();
        await expect(repo.markSeen('datoms', ['43644'], new Date())).rejects.toMatchObject({
          code: '55P03', // lock_not_available
        });
        const took = Date.now() - started;
        expect(took).toBeGreaterThan(4_000);
        expect(took).toBeLessThan(15_000);
      } finally {
        await holder.query('ROLLBACK');
        await holder.end();
      }
    });
  },
);
