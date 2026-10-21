import 'reflect-metadata';
import {
  runCatalogueSync,
  type SourceAsset,
  type SourceCatalogue,
  type SourceConnector,
} from '@nexus/connectors-core';
import { createDatomsConnector } from '@nexus/connectors-datoms';
import { createDatabase, type Database } from '@nexus/db';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import { syncRunDetailsSchema, type CatalogueWarning } from '@nexus/shared';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogueSettings } from '../src/catalogue/catalogue-settings.js';
import { KyselyCatalogueRepository } from '../src/catalogue/kysely-catalogue.repository.js';
import { CatalogueSyncJob } from '../src/jobs/catalogue-sync.job.js';
import { Metrics } from '../src/observability/metrics.js';
import type { SchedulerService } from '../src/scheduler/scheduler.service.js';

/**
 * S3-01 acceptance: the catalogue sync on a real PostgreSQL, writing as the nexus_worker role
 * (so the grants are tested too), reading the recorded DATOMS Asset List through the connector.
 */
describe.skipIf(testDatabaseAdminUrl === undefined)(
  'catalogue sync on PostgreSQL',
  { timeout: 60_000 },
  () => {
    let testDb: TestDatabase;
    let admin: pg.Client;
    let db: Database;
    let repo: KyselyCatalogueRepository;
    let fixtureAssets: SourceAsset[];
    let clock = 0;

    const walk = (assets: SourceAsset[], over: Partial<SourceCatalogue> = {}): SourceCatalogue => ({
      assets,
      total: assets.length,
      complete: true,
      ...over,
    });

    /** One sync of the given walk with a controlled clock (a minute passes between calls). */
    async function sync(catalogue: SourceCatalogue) {
      const warnings: CatalogueWarning[] = [];
      const connector: Pick<SourceConnector, 'sourceSystem' | 'listAssets'> = {
        sourceSystem: 'datoms',
        listAssets: () => Promise.resolve(catalogue),
      };
      clock += 60_000;
      let tick = 0;
      const { details } = await runCatalogueSync({
        connector,
        repo,
        settings: (await loadCatalogueSettings(db)).retire,
        onWarning: (w) => warnings.push(w),
        now: () => new Date(clock + 1_000 * tick++),
      });
      return { details, warnings };
    }

    const count = async (where: string): Promise<number> =>
      Number(
        (await admin.query<{ n: string }>(`SELECT count(*) AS n FROM core.asset WHERE ${where}`))
          .rows[0]!.n,
      );
    const retiredIds = async (): Promise<string[]> =>
      (
        await admin.query<{ external_id: string }>(
          `SELECT external_id FROM core.asset WHERE retired_at IS NOT NULL ORDER BY external_id`,
        )
      ).rows.map((r) => r.external_id);

    beforeAll(async () => {
      testDb = await createTestDatabase({ seed: true });
      admin = new pg.Client({ connectionString: testDb.adminUrl });
      await admin.connect();
      db = createDatabase({
        url: testDb.adminUrl,
        applicationName: 'test',
        sessionRole: 'nexus_worker',
        poolMax: 4,
      });
      repo = new KyselyCatalogueRepository(db);
      const { connector } = createDatomsConnector({ env: { DATOMS_LIVE: 'false' }, maxShare: 0.1 });
      fixtureAssets = (await connector.listAssets()).assets;
    });

    afterAll(async () => {
      await db?.destroy();
      await admin?.end();
      await testDb?.drop();
    });

    beforeEach(async () => {
      clock = Date.parse('2026-10-19T08:00:00Z');
      await admin.query(
        'TRUNCATE core.asset, integration.sync_run, integration.link_todo RESTART IDENTITY CASCADE',
      );
    });

    it('reads 22 assets from the fixtures and stores each typed from its DATOMS category', async () => {
      expect(fixtureAssets).toHaveLength(22);
      const { details, warnings } = await sync(walk(fixtureAssets));
      expect(details).toMatchObject({
        job: 'catalogue_sync',
        seen: 22,
        total: 22,
        complete: true,
        inserted: 22,
        updated: 0,
        retired: 0,
        warnings: [],
      });
      expect(warnings).toEqual([]);

      const byType = await admin.query<{ code: string; n: string }>(
        `SELECT t.code, count(*) AS n FROM core.asset a JOIN core.asset_type t ON t.id = a.asset_type_id
        GROUP BY t.code ORDER BY t.code`,
      );
      expect(Object.fromEntries(byType.rows.map((r) => [r.code, Number(r.n)]))).toEqual({
        diesel_generator: 8,
        fuel_tank: 1,
        mains: 12,
        solar: 1,
      });
      // The category is stored exactly as DATOMS names it, with the lifecycle label as reported.
      const tank = await admin.query(
        `SELECT source_type_name, source_lifecycle_status, project_id, kind, asset_info
         FROM core.asset WHERE external_id = '43644'`,
      );
      expect(tank.rows[0]).toMatchObject({
        source_type_name: 'Fuel Tank',
        source_lifecycle_status: 'active',
        project_id: null,
        kind: 'physical',
        asset_info: { capacity: 20000, make: null },
      });
      // No site data (Q21/Q22): every asset is unlinked and has an open to-do. No project invented.
      expect(await count('project_id IS NOT NULL')).toBe(0);
      const todos = await admin.query<{ reason: string }>(
        `SELECT payload->>'reason' AS reason FROM integration.link_todo WHERE entity_type = 'asset'`,
      );
      expect(todos.rows).toHaveLength(22);
      expect(new Set(todos.rows.map((r) => r.reason))).toEqual(new Set(['no_site']));
    });

    it('writes the typed details to sync_run', async () => {
      await sync(walk(fixtureAssets));
      const run = await admin.query(
        `SELECT status, items_read, items_written, details, error, finished_at >= started_at AS ordered
         FROM integration.sync_run WHERE job = 'catalogue_sync'`,
      );
      expect(run.rows).toHaveLength(1);
      const row = run.rows[0] as {
        status: string;
        items_read: number;
        items_written: number;
        details: unknown;
        error: unknown;
        ordered: boolean;
      };
      expect(row).toMatchObject({ status: 'ok', items_read: 22, items_written: 22, error: null });
      expect(row.ordered).toBe(true);
      const parsed = syncRunDetailsSchema.parse(row.details);
      expect(parsed).toMatchObject({
        job: 'catalogue_sync',
        seen: 22,
        inserted: 22,
        complete: true,
      });
    });

    it('is idempotent and updates only what the source states', async () => {
      await sync(walk(fixtureAssets));
      const again = await sync(walk(fixtureAssets));
      expect(again.details).toMatchObject({ inserted: 0, updated: 0, unchanged: 22 });
      expect(await count('true')).toBe(22);
      expect(
        (await admin.query('SELECT count(*) AS n FROM integration.link_todo')).rows[0],
      ).toEqual({
        n: '22',
      });

      const changed = fixtureAssets.map((a) =>
        a.externalId === '43644'
          ? { ...a, name: 'Fuel Tank (renamed)', lifecycleStatus: 'inactive' }
          : a.externalId === '43514'
            ? { externalId: '43514' } // everything absent: nothing is overwritten
            : a,
      );
      const third = await sync(walk(changed));
      expect(third.details).toMatchObject({ updated: 1, unchanged: 21 });
      const rows = await admin.query(
        `SELECT external_id, name, source_lifecycle_status, source_type_name FROM core.asset
        WHERE external_id IN ('43644', '43514') ORDER BY external_id`,
      );
      expect(rows.rows[0]).toMatchObject({
        external_id: '43514',
        source_type_name: 'Solar Inverter',
      });
      expect(rows.rows[0].name).not.toBe('43514');
      expect(rows.rows[1]).toMatchObject({
        name: 'Fuel Tank (renamed)',
        source_lifecycle_status: 'inactive',
      });
    });

    it('a new DATOMS asset appears on the next sync, typed from its category; unknown categories go to generic plus a to-do', async () => {
      await sync(walk(fixtureAssets));
      const added: SourceAsset[] = [
        ...fixtureAssets,
        {
          externalId: '90001',
          name: 'New DG',
          sourceTypeName: 'DG Set',
          lifecycleStatus: 'active',
        },
        { externalId: '90002', name: 'Mystery', sourceTypeName: 'Crane Hook Camera' },
      ];
      const res = await sync(walk(added));
      expect(res.details).toMatchObject({ inserted: 2, updated: 0, complete: true });
      const rows = await admin.query<{ external_id: string; code: string }>(
        `SELECT a.external_id, t.code FROM core.asset a JOIN core.asset_type t ON t.id = a.asset_type_id
        WHERE a.external_id IN ('90001','90002') ORDER BY a.external_id`,
      );
      expect(rows.rows).toEqual([
        { external_id: '90001', code: 'diesel_generator' },
        { external_id: '90002', code: 'generic' },
      ]);
      const todo = await admin.query(
        `SELECT payload FROM integration.link_todo
        WHERE entity_type = 'asset_type' AND external_id = 'Crane Hook Camera'`,
      );
      expect(todo.rows[0]!.payload).toMatchObject({
        reason: 'unknown_asset_type',
        exampleAssetExternalId: '90002',
      });
    });

    it('an incomplete walk retires nothing, however often it repeats', async () => {
      await sync(walk(fixtureAssets));
      const partial = fixtureAssets.slice(0, 10);
      for (let k = 0; k < 4; k++) {
        const r = await sync(walk(partial, { total: 22, complete: false }));
        expect(r.details).toMatchObject({ complete: false, retired: 0, missed: 0 });
        expect(r.warnings).toEqual([{ code: 'incomplete_walk', seen: 10, total: 22 }]);
      }
      expect(await retiredIds()).toEqual([]);
      const last = await admin.query(
        `SELECT status, details FROM integration.sync_run ORDER BY id DESC LIMIT 1`,
      );
      expect(last.rows[0]).toMatchObject({
        status: 'partial',
        details: { warnings: [{ code: 'incomplete_walk' }] },
      });
    });

    it('a walk shorter than the reported total is not complete even when flagged so', async () => {
      await sync(walk(fixtureAssets));
      const r = await sync(walk(fixtureAssets.slice(0, 21), { total: 22, complete: true }));
      expect(r.details.complete).toBe(false);
      expect(await retiredIds()).toEqual([]);
    });

    it('retires an asset only after 2 consecutive complete misses, and never deletes it', async () => {
      await sync(walk(fixtureAssets));
      const without = fixtureAssets.filter((a) => a.externalId !== '33850'); // 1 of 22 = 4.5%
      const first = await sync(walk(without));
      expect(first.details).toMatchObject({ missed: 1, retired: 0 });
      expect(await retiredIds()).toEqual([]);
      const second = await sync(walk(without));
      expect(second.details).toMatchObject({ missed: 1, retired: 1, complete: true });
      expect(await retiredIds()).toEqual(['33850']);
      expect(await count('true')).toBe(22); // the row is still there
      expect(second.warnings).toEqual([]);

      // It comes back: active again, history untouched.
      const back = await sync(walk(fixtureAssets));
      expect(back.details.reappeared).toBe(1);
      expect(await retiredIds()).toEqual([]);
    });

    it('an incomplete walk between two misses neither resets nor advances the count', async () => {
      await sync(walk(fixtureAssets));
      const without = fixtureAssets.filter((a) => a.externalId !== '33850');
      await sync(walk(without)); // complete miss 1
      await sync(walk(without, { total: 22, complete: false })); // incomplete: not counted
      expect(await retiredIds()).toEqual([]);
      const r = await sync(walk(without)); // complete miss 2
      expect(r.details.retired).toBe(1);
    });

    it('an asset seen in an incomplete walk starts again from zero', async () => {
      await sync(walk(fixtureAssets));
      const without = fixtureAssets.filter((a) => a.externalId !== '33850');
      await sync(walk(without)); // miss 1
      await sync(
        walk(fixtureAssets.slice(0, 21).concat(fixtureAssets[21]!), { total: 23, complete: false }),
      ); // seen again
      await sync(walk(without)); // miss 1 again
      expect(await retiredIds()).toEqual([]);
      expect((await sync(walk(without))).details.retired).toBe(1);
    });

    it('the 5% guard: more than 5% of the active assets would go, so nothing is retired and a warning is recorded', async () => {
      await sync(walk(fixtureAssets));
      const without = fixtureAssets.filter((a) => !['33850', '33851'].includes(a.externalId)); // 2 of 22 = 9%
      await sync(walk(without));
      const blocked = await sync(walk(without));
      expect(blocked.details).toMatchObject({ missed: 2, retired: 0, complete: true });
      expect(blocked.warnings).toHaveLength(1);
      expect(blocked.warnings[0]).toMatchObject({
        code: 'retire_blocked',
        wouldRetire: 2,
        active: 22,
        maxFraction: 0.05,
      });
      expect(await retiredIds()).toEqual([]);
      const run = await admin.query(
        `SELECT status, details FROM integration.sync_run ORDER BY id DESC LIMIT 1`,
      );
      expect(run.rows[0].status).toBe('partial');
      expect(syncRunDetailsSchema.parse(run.rows[0].details)).toMatchObject({
        warnings: [{ code: 'retire_blocked' }],
      });
      // No Nexus warning is ever an event or a to-do (DATOMS alerts only; docs/07 section 6).
      expect((await admin.query('SELECT count(*) AS n FROM events.event')).rows[0]).toEqual({
        n: '0',
      });
      expect(
        (
          await admin.query(
            `SELECT count(*) AS n FROM integration.link_todo WHERE payload::text LIKE '%retire_blocked%'`,
          )
        ).rows[0],
      ).toEqual({ n: '0' });
    });

    it('exactly 5% is allowed; the setting is read from core.setting', async () => {
      await sync(walk(fixtureAssets));
      await admin.query(
        `UPDATE core.setting SET value = '0.1' WHERE key = 'catalogue.retire_max_fraction'`,
      );
      const without = fixtureAssets.filter((a) => !['33850', '33851'].includes(a.externalId)); // 9%
      await sync(walk(without));
      const r = await sync(walk(without));
      expect(r.details.retired).toBe(2);
      await admin.query(
        `UPDATE core.setting SET value = '0.05' WHERE key = 'catalogue.retire_max_fraction'`,
      );
    });

    it('the worker can retire but not delete assets', async () => {
      await sync(walk(fixtureAssets));
      await expect(db.deleteFrom('core.asset').execute()).rejects.toMatchObject({ code: '42501' });
    });

    it('a failed walk records a failed run with the error and no details', async () => {
      const connector: SourceConnector = {
        sourceSystem: 'datoms',
        listAssets: () => Promise.reject(new Error('DATOMS unreachable')),
        readLatest: () => (async function* () {})(),
      };
      await expect(
        runCatalogueSync({
          connector,
          repo,
          settings: (await loadCatalogueSettings(db)).retire,
        }),
      ).rejects.toThrow('DATOMS unreachable');
      const run = await admin.query(
        `SELECT status, details, error FROM integration.sync_run ORDER BY id DESC LIMIT 1`,
      );
      expect(run.rows[0]).toEqual({
        status: 'failed',
        details: null,
        error: { message: 'DATOMS unreachable' },
      });
    });

    it('batches: 5,000 assets are inserted, re-synced and partly retired well inside 30 s', async () => {
      const big: SourceAsset[] = Array.from({ length: 5_000 }, (_, i) => ({
        externalId: `b${i}`,
        name: `Bulk ${i}`,
        sourceTypeName: 'AC Sub-Meter',
        lifecycleStatus: 'active',
        nameplate: { make: null, i },
      }));
      const started = Date.now();
      expect((await sync(walk(big))).details.inserted).toBe(5_000);
      const renamed = big.map((a, i) => (i % 2 === 0 ? { ...a, name: `${a.name}!` } : a));
      expect((await sync(walk(renamed))).details).toMatchObject({
        updated: 2_500,
        unchanged: 2_500,
      });
      const fewer = renamed.slice(0, 4_800); // 4%
      await sync(walk(fewer));
      expect((await sync(walk(fewer))).details.retired).toBe(200);
      expect(Date.now() - started).toBeLessThan(30_000);
    });

    it('the job class wires connector, repository and settings; warnings reach the metric', async () => {
      const { connector } = createDatomsConnector({ env: {}, maxShare: 0.1 });
      const incrementCalls: { name: string; attributes?: Record<string, string | number> }[] = [];
      const metrics = new (class extends Metrics {
        increment(name: string, attributes?: Record<string, string | number>): void {
          incrementCalls.push({ name, attributes: attributes as Record<string, string | number> });
        }
      })();
      const job = new CatalogueSyncJob(db, connector, metrics, {
        register() {},
        requestEarly: () => 'started',
      } as unknown as SchedulerService);
      const first = await job.run();
      expect(first).toMatchObject({ seen: 22, inserted: 22, complete: true });
      expect(incrementCalls).toEqual([]);

      // A second job instance over a shortened, incomplete walk raises the warning metric.
      const short: SourceConnector = {
        sourceSystem: 'datoms',
        listAssets: () =>
          Promise.resolve(walk(fixtureAssets.slice(0, 5), { total: 22, complete: false })),
        readLatest: connector.readLatest.bind(connector),
      };
      const job2 = new CatalogueSyncJob(db, short, metrics, {
        register() {},
        requestEarly: () => 'started',
      } as unknown as SchedulerService);
      const second = await job2.run();
      expect(second.warnings).toEqual([{ code: 'incomplete_walk', seen: 5, total: 22 }]);
      expect(incrementCalls).toEqual([
        {
          name: 'nexus.sync.warning',
          attributes: { code: 'incomplete_walk', job: 'catalogue_sync' },
        },
      ]);
    });
  },
);
