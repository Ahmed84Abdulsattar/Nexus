import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertMayRevert, isLocalHost } from '../src/admin/guards.js';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '../src/testing.js';

/** Security review of PR #16: one test per finding. */

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

describe('M5: db:migrate down and redo', () => {
  const url = 'postgres://nexus@db.example:5432/nexus_prod?sslmode=require';
  it('run freely only when APP_ENV=local', () => {
    expect(() => assertMayRevert({ appEnv: 'local', url, args: [] })).not.toThrow();
  });
  it.each(['dev', 'prod', undefined])('need --confirm-database=<name> when APP_ENV is %s', (appEnv) => {
    expect(() => assertMayRevert({ appEnv, url, args: [] })).toThrow(/Refusing to revert/);
    expect(() => assertMayRevert({ appEnv, url, args: ['--confirm-database=other'] })).toThrow(/Refusing/);
    expect(() => assertMayRevert({ appEnv, url, args: ['--confirm-database=nexus_prod'] })).not.toThrow();
  });
});

describe('L1: the local-only seed', () => {
  it.each([
    ['postgres://nexus@localhost:5432/n', true],
    ['postgres://nexus@127.0.0.1:5432/n', true],
    ['postgres://nexus@[::1]:5432/n', true],
    ['postgres://nexus@/n?host=/var/run/postgresql', true],
    ['postgres://nexus@db.example.com:5432/n', false],
    ['postgres://nexus@10.0.0.4:5432/n', false],
    ['postgres://nexus@localhost.evil.example/n', false],
  ])('%s is local: %s', (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

});

describe.skipIf(testDatabaseAdminUrl === undefined)('database hardening (PostgreSQL)', () => {
  let db: TestDatabase;
  let admin: pg.Client;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await db?.drop();
  });

  it('M1: the worker cannot touch per-user read state, in the parent or in any partition', async () => {
    const worker = await connectAs(db.adminUrl, 'nexus_worker');
    try {
      const children = await admin.query<{ n: string }>(
        `SELECT i.inhrelid::regclass::text AS n FROM pg_inherits i WHERE i.inhparent = 'events.event_read'::regclass`,
      );
      expect(children.rowCount).toBeGreaterThan(0);
      const row = `(gen_random_uuid(), gen_random_uuid(), now())`;
      for (const child of children.rows.map((r) => r.n)) {
        expect(
          await sqlState(worker.query(`INSERT INTO ${child} (user_id, event_id, occurred_at) VALUES ${row}`)),
        ).toBe('42501');
        expect(await sqlState(worker.query(`SELECT * FROM ${child}`))).toBe('42501');
      }
      expect(await sqlState(worker.query(`INSERT INTO events.event_read (user_id, event_id, occurred_at) VALUES ${row}`))).toBe('42501');
      expect(await sqlState(worker.query(`SELECT * FROM events.read_marker`))).toBe('42501');
      // Partitions created later by the maintenance function get no grants either.
      await worker.query(`SELECT core.create_range_partitions('events.event_read', 'month', DATE '2031-05-01', 1)`);
      expect(await sqlState(worker.query(`SELECT * FROM events.event_read_p203105`))).toBe('42501');
      // The worker still writes events themselves.
      await worker.query(
        `INSERT INTO events.event (occurred_at, source_system, external_id, title) VALUES (now(), 'datoms', 'e1', 't')`,
      );
    } finally {
      await worker.end();
    }
  });

  it('M1: the api still manages read state through the parent', async () => {
    const api = await connectAs(db.adminUrl, 'nexus_api');
    try {
      const u = await admin.query<{ id: string }>(
        `INSERT INTO access.app_user (entra_oid, tenant_id) VALUES (gen_random_uuid(), gen_random_uuid()) RETURNING id`,
      );
      await api.query(
        `INSERT INTO events.event_read (user_id, event_id, occurred_at) VALUES ($1, gen_random_uuid(), now())`,
        [u.rows[0]!.id],
      );
    } finally {
      await api.end();
    }
  });

  describe('M2: dropping partitions cannot destroy history', () => {
    it('keeps 730 days of audit and events, whatever the argument', async () => {
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      try {
        for (const parent of ['audit.log', 'events.event', 'events.event_read']) {
          await expect(
            worker.query(`SELECT * FROM core.drop_partitions_before('${parent}', now() - interval '100 days')`),
          ).rejects.toThrow(/730 days/);
          await expect(
            worker.query(`SELECT * FROM core.drop_partitions_before('${parent}', now() - interval '729 days')`),
          ).rejects.toThrow(/730 days/);
        }
        // Telemetry has no such floor (retention is a setting: raw packets 90 days).
        await worker.query(`SELECT * FROM core.drop_partitions_before('telemetry.packet', now() - interval '100 days')`);
      } finally {
        await worker.end();
      }
    });

    it('writes an audit row for every dropped partition, from inside the function', async () => {
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      try {
        await worker.query(`SELECT core.create_range_partitions('audit.log', 'month', DATE '2020-01-01', 1)`);
        await worker.query(`SELECT core.create_range_partitions('telemetry.packet', 'day', DATE '2020-03-01', 2)`);
        const events = await worker.query(`SELECT * FROM core.drop_partitions_before('audit.log', timestamptz '2021-01-01')`);
        expect(events.rowCount).toBe(1);
        const packets = await worker.query(`SELECT * FROM core.drop_partitions_before('telemetry.packet', timestamptz '2021-01-01')`);
        expect(packets.rowCount).toBe(2);
      } finally {
        await worker.end();
      }
      const rows = await admin.query(
        `SELECT target_id, details FROM audit.log WHERE action = 'maintenance.partition_dropped' ORDER BY target_id`,
      );
      expect(rows.rows.map((r) => r.target_id)).toEqual([
        'audit.log_p202001',
        'telemetry.packet_p20200301',
        'telemetry.packet_p20200302',
      ]);
      expect(rows.rows[0].details).toMatchObject({ parent: 'audit.log', caller: expect.any(String) });
    });
  });

  describe('M3: functions', () => {
    it('every SECURITY DEFINER function pins its search_path', async () => {
      const r = await admin.query<{ f: string; config: string[] | null }>(`
        SELECT p.oid::regprocedure::text AS f, p.proconfig AS config FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('core','access','telemetry','events','integration','audit') AND p.prosecdef`);
      expect(r.rowCount).toBeGreaterThan(0);
      for (const row of r.rows) {
        expect(row.config?.some((c) => c.startsWith('search_path=')), row.f).toBe(true);
      }
    });

    it('no function of the Nexus schemas is executable by PUBLIC, and the api has only the two lookups', async () => {
      const r = await admin.query<{ f: string; public_x: boolean; api_x: boolean; definer: boolean }>(`
        SELECT p.oid::regprocedure::text AS f,
               has_function_privilege('public', p.oid, 'EXECUTE') AS public_x,
               has_function_privilege('nexus_api', p.oid, 'EXECUTE') AS api_x,
               p.prosecdef AS definer
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('core','access','telemetry','events','integration','audit')`);
      expect(r.rowCount).toBeGreaterThan(5);
      expect(r.rows.filter((x) => x.public_x).map((x) => x.f)).toEqual([]);
      expect(r.rows.filter((x) => x.api_x).map((x) => x.f).sort()).toEqual([
        'access.user_project_ids(uuid,uuid[])',
        'access.user_roles(uuid,uuid[])',
      ]);
      expect(r.rows.filter((x) => x.definer && x.api_x)).toEqual([]);
    });

    it('a new SECURITY DEFINER function is executable by nobody until it is granted', async () => {
      const owner = await connectAs(db.adminUrl, 'nexus_migrator');
      try {
        await owner.query(`CREATE FUNCTION core.future_definer() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 1 $$`);
        const api = await connectAs(db.adminUrl, 'nexus_api');
        try {
          expect(await sqlState(api.query('SELECT core.future_definer()'))).toBe('42501');
        } finally {
          await api.end();
        }
        await owner.query('DROP FUNCTION core.future_definer()');
      } finally {
        await owner.end();
      }
    });
  });

  describe('L2: refresh_rollup_combine', () => {
    it('is SECURITY INVOKER, takes only the two allowed table pairs, and is not callable by the api', async () => {
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      const api = await connectAs(db.adminUrl, 'nexus_api');
      try {
        const call = (src: string, dst: string): string =>
          `SELECT telemetry.refresh_rollup_combine('${src}', '${dst}', '1 hour', now() - interval '1 day', now())`;
        await worker.query(call('telemetry.rollup_5m', 'telemetry.rollup_1h'));
        await worker.query(call('telemetry.rollup_1h', 'telemetry.rollup_1d'));
        for (const [s, d] of [
          ['telemetry.rollup_5m', 'telemetry.rollup_5m'],
          ['telemetry.rollup_1d', 'telemetry.rollup_1h'],
          ['core.asset', 'telemetry.rollup_1h'],
          ['telemetry.rollup_5m', 'core.project'],
        ] as const) {
          await expect(worker.query(call(s, d)), `${s} -> ${d}`).rejects.toThrow(/only rollup_5m to rollup_1h/);
        }
        expect(await sqlState(api.query(call('telemetry.rollup_5m', 'telemetry.rollup_1h')))).toBe('42501');
        const definer = await admin.query(`SELECT prosecdef FROM pg_proc WHERE proname IN ('refresh_rollup_5m','refresh_rollup_combine')`);
        expect(definer.rows.every((r) => r.prosecdef === false)).toBe(true);
      } finally {
        await worker.end();
        await api.end();
      }
    });
  });

  it('L5: PUBLIC cannot connect to the database or create temp tables', async () => {
    const r = await admin.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM pg_database d, aclexplode(d.datacl) a
      WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type IN ('CONNECT','TEMPORARY')`);
    expect(r.rows[0]!.n).toBe(0);
    for (const role of ['nexus_api', 'nexus_worker', 'nexus_migrator']) {
      const c = await admin.query(`SELECT has_database_privilege($1, current_database(), 'CONNECT') AS ok`, [role]);
      expect(c.rows[0].ok, role).toBe(true);
    }
  });

  it('L6: the api cannot rewrite source identity or seen-at columns of projects and spatial rows', async () => {
    const p = await admin.query<{ id: string }>(
      `INSERT INTO core.project (name, source_system, external_id) VALUES ('P','datoms','x1') RETURNING id`,
    );
    const b = await admin.query<{ id: string }>(
      `INSERT INTO core.building (project_id, name) VALUES ($1,'B') RETURNING id`, [p.rows[0]!.id]);
    const api = await connectAs(db.adminUrl, 'nexus_api');
    try {
      await api.query(`UPDATE core.project SET name = 'Renamed', client_name = 'C', state = 'active' WHERE id = $1`, [p.rows[0]!.id]);
      for (const col of ["external_id = 'y'", "source_system = 'datoms'", "last_seen_at = now()", "first_seen_at = now()", "retired_at = now()", "source_payload = '{}'", "created_at = now()"]) {
        expect(await sqlState(api.query(`UPDATE core.project SET ${col} WHERE id = $1`, [p.rows[0]!.id])), col).toBe('42501');
      }
      await api.query(`UPDATE core.building SET name = 'B2', bim_ref = '{}' WHERE id = $1`, [b.rows[0]!.id]);
      expect(await sqlState(api.query(`UPDATE core.building SET external_id = 'q' WHERE id = $1`, [b.rows[0]!.id]))).toBe('42501');
      expect(await sqlState(api.query(`UPDATE core.building SET project_id = project_id WHERE id = $1`, [b.rows[0]!.id]))).toBe('42501');
      // Admin-created rows can still be inserted.
      await api.query(`INSERT INTO core.project (name, source_system, external_id) VALUES ('Admin P','datoms','adm-1')`);
    } finally {
      await api.end();
    }
  });

  it('L7: the worker has no DELETE except on sync_run, and no access to users or the audit log', async () => {
    const worker = await connectAs(db.adminUrl, 'nexus_worker');
    try {
      await worker.query(`DELETE FROM integration.sync_run WHERE false`);
      for (const t of ['telemetry.latest_packet', 'telemetry.packet', 'core.asset', 'core.project', 'integration.cursor', 'events.event']) {
        expect(await sqlState(worker.query(`DELETE FROM ${t} WHERE false`)), t).toBe('42501');
      }
      for (const t of ['access.app_user', 'access.user_role', 'audit.log']) {
        expect(await sqlState(worker.query(`SELECT 1 FROM ${t} LIMIT 1`)), t).toBe('42501');
      }
      expect(await sqlState(worker.query(`INSERT INTO telemetry.status_map VALUES ('datoms','x','off')`))).toBe('42501');
      await worker.query(`SELECT 1 FROM core.project LIMIT 1`);
    } finally {
      await worker.end();
    }
  });

  it('L4: unlinked assets are not in the equipment views', async () => {
    await admin.query(`INSERT INTO core.asset (name, source_system, external_id) VALUES ('orphan','datoms','orph')`);
    const v = await admin.query(`SELECT 1 FROM core.v_asset_live WHERE name = 'orphan'`);
    expect(v.rowCount).toBe(0);
    const t = await admin.query(`SELECT 1 FROM core.asset WHERE name = 'orphan'`);
    expect(t.rowCount).toBe(1);
  });

  it('I2: TRUNCATE of an access table is announced to everybody', async () => {
    const listener = new pg.Client({ connectionString: db.adminUrl });
    await listener.connect();
    const got: string[] = [];
    listener.on('notification', (m) => got.push(m.payload ?? ''));
    await listener.query('LISTEN nexus_access');
    await admin.query('TRUNCATE access.user_role');
    await new Promise((r) => setTimeout(r, 200));
    await listener.end();
    expect(got).toEqual(['{"scope":"all"}']);
  });

  it('the sign-in audit gap is a setting with a default of 60 minutes', async () => {
    const r = await admin.query(`SELECT value FROM core.setting WHERE key = 'audit.sign_in_gap_minutes'`);
    expect(r.rows[0].value).toBe(60);
  });
});
