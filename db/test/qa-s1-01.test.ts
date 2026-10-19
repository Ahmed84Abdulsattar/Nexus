import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '../src/testing.js';

/** QA additions for S1-01: hard rules 8 and 9, ADR 0003 and ADR 0009, and the CI no-skip guard. */

async function connectAs(url: string, role: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`SET ROLE ${role}`);
  return client;
}

const sqlState = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: { code?: string }) => e.code,
  );

describe('CI guard', () => {
  it('does not let the database tests be skipped in CI', () => {
    if (process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true') {
      expect(
        testDatabaseAdminUrl,
        'TEST_DATABASE_ADMIN_URL must be set in CI, otherwise every database test is silently skipped',
      ).toBeDefined();
    }
  });
});

describe.skipIf(testDatabaseAdminUrl === undefined)('QA S1-01 database', () => {
  let db: TestDatabase;
  let admin: pg.Client;
  let projectId: string;

  beforeAll(async () => {
    db = await createTestDatabase({ seed: true });
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    projectId = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.project (name, source_system, external_id) VALUES ('P','datoms','qa-p') RETURNING id`,
      )
    ).rows[0]!.id;
  });
  afterAll(async () => {
    await admin?.end();
    await db?.drop();
  });

  it('uses native daily partitions for packets and no TimescaleDB (ADR 0003)', async () => {
    const ext = await admin.query(`SELECT extname FROM pg_extension WHERE extname ILIKE 'timescale%'`);
    expect(ext.rowCount).toBe(0);
    const parts = await admin.query<{ b: string }>(
      `SELECT pg_get_expr(c.relpartbound, c.oid) AS b FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid WHERE i.inhparent='telemetry.packet'::regclass`,
    );
    expect(parts.rowCount).toBeGreaterThanOrEqual(8);
    for (const p of parts.rows) {
      const m = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(p.b)!;
      const span = new Date(m[2]!.replace(' ', 'T').replace('+00', 'Z')).getTime() -
        new Date(m[1]!.replace(' ', 'T').replace('+00', 'Z')).getTime();
      expect(span).toBe(24 * 3600 * 1000);
    }
    const key = await admin.query(
      `SELECT partstrat FROM pg_partitioned_table WHERE partrelid='telemetry.packet'::regclass`,
    );
    expect(key.rows[0].partstrat).toBe('r');
  });

  it('builds daily rollups on Dubai days, not UTC days (hard rule 9)', async () => {
    const asset = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.asset (name, source_system, external_id, project_id) VALUES ('d','datoms','qa-dubai',$1) RETURNING id`,
        [projectId],
      )
    ).rows[0]!.id;
    await admin.query(`SELECT core.create_range_partitions('telemetry.packet','day',DATE '2031-03-09',4)`);
    await admin.query(`SELECT core.create_range_partitions('telemetry.rollup_5m','month',DATE '2031-03-01',1)`);
    await admin.query(`SELECT core.create_range_partitions('telemetry.rollup_1h','month',DATE '2031-03-01',1)`);
    // 19:59Z = 23:59 Dubai on 10 March; 20:01Z = 00:01 Dubai on 11 March. Same UTC day, different Dubai days.
    await admin.query(
      `INSERT INTO telemetry.packet (asset_id, ts, values) VALUES ($1,'2031-03-10T19:59:00Z','{"x":1}'),($1,'2031-03-10T20:01:00Z','{"x":3}')`,
      [asset],
    );
    const worker = await connectAs(db.adminUrl, 'nexus_worker');
    try {
      await worker.query(`SET TIME ZONE 'UTC'`);
      await worker.query(`SELECT telemetry.refresh_rollup_5m('2031-03-10T19:00Z','2031-03-10T21:00Z')`);
      await worker.query(
        `SELECT telemetry.refresh_rollup_combine('telemetry.rollup_5m','telemetry.rollup_1h','1 hour','2031-03-10T19:00Z','2031-03-10T21:00Z')`,
      );
      await worker.query(
        `SELECT telemetry.refresh_rollup_combine('telemetry.rollup_1h','telemetry.rollup_1d','1 day','2031-03-09T00:00Z','2031-03-12T00:00Z','Asia/Dubai')`,
      );
    } finally {
      await worker.end();
    }
    const days = await admin.query<{ b: string; packets: number; mx: string }>(
      `SELECT to_char(bucket AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS b, packets, stats->'x'->>'max' AS mx
       FROM telemetry.rollup_1d WHERE asset_id=$1 ORDER BY bucket`,
      [asset],
    );
    expect(days.rows.map((r) => r.b)).toEqual(['2031-03-09T20:00', '2031-03-10T20:00']);
    expect(days.rows.map((r) => Number(r.mx))).toEqual([1, 3]);
    expect(days.rows.map((r) => r.packets)).toEqual([1, 1]);
  });

  it('never lets api or worker delete synced core rows (hard rule 8)', async () => {
    const asset = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.asset (name, source_system, external_id, project_id) VALUES ('keep','datoms','qa-keep',$1) RETURNING id`,
        [projectId],
      )
    ).rows[0]!.id;
    for (const role of ['nexus_api', 'nexus_worker']) {
      const c = await connectAs(db.adminUrl, role);
      try {
        for (const t of ['core.asset', 'core.project', 'core.asset_type', 'core.building', 'core.level', 'core.zone']) {
          expect(await sqlState(c.query(`DELETE FROM ${t}`)), `${role} DELETE ${t}`).toBe('42501');
        }
        expect(await sqlState(c.query(`TRUNCATE core.asset CASCADE`)), `${role} TRUNCATE`).toBe('42501');
      } finally {
        await c.end();
      }
    }
    const still = await admin.query(`SELECT 1 FROM core.asset WHERE id=$1`, [asset]);
    expect(still.rowCount).toBe(1);
  });

  it('keeps site_metric and retired assets out of equipment views, lists and counts (ADR 0009)', async () => {
    const p = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.project (name, source_system, external_id) VALUES ('P-views','datoms','qa-views') RETURNING id`,
      )
    ).rows[0]!.id;
    await admin.query(
      `INSERT INTO core.asset (name, source_system, external_id, project_id, kind, retired_at) VALUES
        ('physical','datoms','v1',$1,'physical',NULL),
        ('metric','datoms','v2',$1,'site_metric',NULL),
        ('retired','datoms','v3',$1,'physical',now())`,
      [p],
    );
    const live = await admin.query<{ name: string }>(`SELECT name FROM core.v_asset_live WHERE project_id=$1`, [p]);
    expect(live.rows.map((r) => r.name)).toEqual(['physical']);
    const counts = await admin.query<{ n: string }>(
      `SELECT coalesce(sum(assets),0)::int AS n FROM core.v_project_asset_counts WHERE project_id=$1`,
      [p],
    );
    expect(Number(counts.rows[0]!.n)).toBe(1);
    const metrics = await admin.query<{ name: string }>(`SELECT name FROM core.v_site_metric_live WHERE project_id=$1`, [p]);
    expect(metrics.rows.map((r) => r.name)).toEqual(['metric']);
  });

  it('rejects a kind outside physical / site_metric', async () => {
    expect(
      await sqlState(
        admin.query(`INSERT INTO core.asset (name, source_system, external_id, kind) VALUES ('k','datoms','qa-kind','sensor')`),
      ),
    ).toBe('23514');
  });

  it('stops the api changing an asset kind (set by the connector only)', async () => {
    const c = await connectAs(db.adminUrl, 'nexus_api');
    try {
      expect(await sqlState(c.query(`UPDATE core.asset SET kind='site_metric'`))).toBe('42501');
    } finally {
      await c.end();
    }
  });
});
