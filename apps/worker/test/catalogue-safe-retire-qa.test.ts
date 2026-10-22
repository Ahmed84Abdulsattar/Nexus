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
import type { CatalogueWarning } from '@nexus/shared';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogueSettings } from '../src/catalogue/catalogue-settings.js';
import { KyselyCatalogueRepository } from '../src/catalogue/kysely-catalogue.repository.js';

/**
 * QA for S3-01 (post-merge): adversarial cases for the derived safe-retire miss counter
 * (docs/07 section 6), on a real PostgreSQL and as the nexus_worker role. The counter is not stored;
 * it comes from the last complete runs and `last_seen_at`, so these tests try to confuse that derivation.
 */
describe.skipIf(testDatabaseAdminUrl === undefined)(
  'QA S3-01: safe-retire edge cases on PostgreSQL',
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

    async function sync(catalogue: SourceCatalogue | Error) {
      const warnings: CatalogueWarning[] = [];
      const connector: Pick<SourceConnector, 'sourceSystem' | 'listAssets'> = {
        sourceSystem: 'datoms',
        listAssets: () =>
          catalogue instanceof Error ? Promise.reject(catalogue) : Promise.resolve(catalogue),
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

    const retiredIds = async (): Promise<string[]> =>
      (
        await admin.query<{ external_id: string }>(
          `SELECT external_id FROM core.asset WHERE retired_at IS NOT NULL ORDER BY external_id`,
        )
      ).rows.map((r) => r.external_id);

    const setting = (key: string, value: string) =>
      admin.query(`UPDATE core.setting SET value = $2 WHERE key = $1`, [key, value]);

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
    }, 120_000);

    afterAll(async () => {
      await db?.destroy();
      await admin?.end();
      await testDb?.drop();
      // Dropping the test database waits for the pool's backends to exit; slow when turbo runs everything at once.
    }, 180_000);

    beforeEach(async () => {
      clock = Date.parse('2026-10-19T08:00:00Z');
      await admin.query(
        'TRUNCATE core.asset, integration.sync_run, integration.link_todo RESTART IDENTITY CASCADE',
      );
      await setting('catalogue.retire_after_misses', '2');
      await setting('catalogue.retire_max_fraction', '0.05');
    });

    const gone = '33850';
    const without = (list: SourceAsset[]) => list.filter((a) => a.externalId !== gone);

    it('two incomplete walks, then a complete one, count as exactly one miss', async () => {
      await sync(walk(fixtureAssets));
      await sync(walk(without(fixtureAssets), { total: 22, complete: false }));
      await sync(walk(without(fixtureAssets), { total: 22, complete: false }));
      const miss1 = await sync(walk(without(fixtureAssets)));
      expect(miss1.details).toMatchObject({ missed: 1, retired: 0 });
      expect(await retiredIds()).toEqual([]);
      const miss2 = await sync(walk(without(fixtureAssets)));
      expect(miss2.details.retired).toBe(1);
      expect(await retiredIds()).toEqual([gone]);
    });

    it('complete, then incomplete, then complete: a single miss, nothing retired', async () => {
      await sync(walk(fixtureAssets));
      await sync(walk(without(fixtureAssets), { total: 22, complete: false }));
      const r = await sync(walk(without(fixtureAssets)));
      expect(r.details).toMatchObject({ missed: 1, retired: 0 });
      expect(await retiredIds()).toEqual([]);
    });

    it('a failed run on record counts neither as a miss nor as a complete run', async () => {
      await sync(walk(fixtureAssets));
      await sync(walk(without(fixtureAssets))); // complete miss 1
      await expect(sync(new Error('DATOMS 503'))).rejects.toThrow('DATOMS 503');
      expect(await retiredIds()).toEqual([]);
      const r = await sync(walk(without(fixtureAssets))); // complete miss 2
      expect(r.details.retired).toBe(1);
    });

    it('a failed run does not hide a miss either: it cannot be the baseline', async () => {
      await sync(walk(fixtureAssets));
      await expect(sync(new Error('boom'))).rejects.toThrow('boom');
      // Only one earlier complete run exists, so the first complete miss is miss 1, not 2.
      const r = await sync(walk(without(fixtureAssets)));
      expect(r.details).toMatchObject({ missed: 1, retired: 0 });
    });

    it('with retire_after_misses = 3 it takes three complete misses, and two runs on record are not enough', async () => {
      await setting('catalogue.retire_after_misses', '3');
      await sync(walk(fixtureAssets));
      expect((await sync(walk(without(fixtureAssets)))).details.retired).toBe(0); // miss 1
      expect((await sync(walk(without(fixtureAssets)))).details.retired).toBe(0); // miss 2
      expect(await retiredIds()).toEqual([]);
      expect((await sync(walk(without(fixtureAssets)))).details.retired).toBe(1); // miss 3
      expect(await retiredIds()).toEqual([gone]);
    });

    it('a first-ever sync (nothing on record) retires nothing, however large the gap', async () => {
      await sync(walk([])); // empty complete walk on an empty database
      expect(await retiredIds()).toEqual([]);
    });

    it('an asset that reappears in a complete walk between two misses starts from zero', async () => {
      await sync(walk(fixtureAssets));
      await sync(walk(without(fixtureAssets))); // miss 1
      await sync(walk(fixtureAssets)); // back
      await sync(walk(without(fixtureAssets))); // miss 1 again
      expect(await retiredIds()).toEqual([]);
      expect((await sync(walk(without(fixtureAssets)))).details.retired).toBe(1);
    });

    it('exactly 5% of the active assets (1 of 20) may be retired', async () => {
      const twenty = fixtureAssets.slice(0, 20);
      await sync(walk(twenty));
      const gone20 = twenty[0]!.externalId;
      const rest = twenty.filter((a) => a.externalId !== gone20);
      await sync(walk(rest));
      const r = await sync(walk(rest));
      expect(r.warnings).toEqual([]);
      expect(r.details.retired).toBe(1);
      expect(await retiredIds()).toEqual([gone20]);
    });

    it('just over 5% (1 of 19) is blocked, nothing is retired, and the block is a warning only', async () => {
      const nineteen = fixtureAssets.slice(0, 19);
      await sync(walk(nineteen));
      const rest = nineteen.slice(1);
      await sync(walk(rest));
      const r = await sync(walk(rest));
      expect(r.details.retired).toBe(0);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatchObject({ code: 'retire_blocked', wouldRetire: 1, active: 19 });
      expect(await retiredIds()).toEqual([]);
      // The counter keeps advancing while blocked: once the guard is relaxed the asset goes at once.
      await setting('catalogue.retire_max_fraction', '0.1');
      expect((await sync(walk(rest))).details.retired).toBe(1);
    });

    it('a retire fraction of 0 retires nothing, ever', async () => {
      await setting('catalogue.retire_max_fraction', '0');
      await sync(walk(fixtureAssets));
      await sync(walk(without(fixtureAssets)));
      const r = await sync(walk(without(fixtureAssets)));
      expect(r.details.retired).toBe(0);
      expect(r.warnings[0]).toMatchObject({ code: 'retire_blocked' });
    });

    it('a pagination total that disagrees with the rows seen is never a complete walk', async () => {
      await sync(walk(fixtureAssets));
      const short = without(fixtureAssets);
      for (const total of [23, 22, 30]) {
        const r = await sync(walk(short, { total, complete: true }));
        // 21 rows against a total of 22 or more: incomplete. (A total of 21 is the only complete case.)
        expect(r.details.complete).toBe(false);
      }
      const noTotal = await sync({ assets: short, complete: true } as SourceCatalogue);
      expect(noTotal.details.complete).toBe(false);
      // A total below the rows seen (the source shrank mid-walk) is also not complete.
      const over = await sync(walk(fixtureAssets, { total: 10, complete: true }));
      expect(over.details.complete).toBe(false);
      expect(await retiredIds()).toEqual([]);
    });

    it('the same id twice in one walk makes it incomplete and does not insert twice', async () => {
      const dup = [...fixtureAssets, fixtureAssets[0]!];
      const r = await sync(walk(dup, { total: 22 }));
      expect(r.details.complete).toBe(false);
      const n = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM core.asset`);
      expect(n.rows[0]!.n).toBe('22');
    });

    it('retiring never deletes or unlinks: external_id, source_system and first_seen_at survive', async () => {
      await sync(walk(fixtureAssets));
      const before = await admin.query(
        `SELECT source_system, external_id, first_seen_at FROM core.asset WHERE external_id = $1`,
        [gone],
      );
      await sync(walk(without(fixtureAssets)));
      await sync(walk(without(fixtureAssets)));
      const after = await admin.query(
        `SELECT source_system, external_id, first_seen_at, retired_at FROM core.asset WHERE external_id = $1`,
        [gone],
      );
      expect(after.rows[0]).toMatchObject(before.rows[0]);
      expect(after.rows[0].retired_at).not.toBeNull();
    });
  },
);
