import { readdirSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSchema } from '../src/admin/check.js';
import { migrate } from '../src/admin/migrate.js';
import { MIGRATIONS_DIR } from '../src/admin/paths.js';
import { seed } from '../src/admin/seed.js';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '../src/testing.js';

/** A connection that behaves exactly like one app role: same grants, nothing more. */
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

describe.skipIf(testDatabaseAdminUrl === undefined)('database (PostgreSQL)', () => {
  let db: TestDatabase;
  let admin: pg.Client;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    db = await createTestDatabase({ seed: true });
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const p = await admin.query<{ id: string }>(
      `INSERT INTO core.project (name, source_system, external_id) VALUES ('P1','datoms','s1'), ('P2','datoms','s2') RETURNING id`,
    );
    projectId = p.rows[0]!.id;
    otherProjectId = p.rows[1]!.id;
  });
  afterAll(async () => {
    await admin?.end();
    await db?.drop();
  });

  describe('migrations', () => {
    it('run up, down, up on an empty database and are then up to date', async () => {
      // Every migration file, in order: the test needs no edit when a migration is added.
      const all = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => f.replace(/\.sql$/, ''))
        .sort();
      const fresh = await createTestDatabase();
      try {
        expect((await migrate({ url: fresh.adminUrl, direction: 'up' })).applied).toEqual([]);
        expect(
          (await migrate({ url: fresh.adminUrl, direction: 'down', count: Infinity, confirmDatabase: fresh.name }))
            .applied,
        ).toEqual(all);
        const c = new pg.Client({ connectionString: fresh.adminUrl });
        await c.connect();
        const schemas = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname IN ('core','telemetry','access')`);
        await c.end();
        expect(schemas.rowCount).toBe(0);
        expect((await migrate({ url: fresh.adminUrl, direction: 'up' })).applied).toEqual(all);
      } finally {
        await fresh.drop();
      }
    });

    it('leave db/schema.sql, the migrations and db/src/types.ts in agreement (pnpm db:check)', async () => {
      const result = await checkSchema({ adminUrl: db.adminUrl });
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('create every table owned by nexus_migrator', async () => {
      const r = await admin.query(`
        SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('core','access','telemetry','events','integration','audit')
          AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner) <> 'nexus_migrator'`);
      expect(r.rows[0].n).toBe(0);
    });
  });

  describe('assets link to a project and an optional zone (S1-01 acceptance)', () => {
    const asset = (extra: string, ext: string): string =>
      `INSERT INTO core.asset (name, source_system, external_id${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ('a','datoms','${ext}'${extra ? ', ' + extra.split('=')[1] : ''})`;

    let buildingId: string;
    let levelId: string;
    let zoneId: string;
    let otherZoneId: string;

    beforeAll(async () => {
      buildingId = (await admin.query(`INSERT INTO core.building (project_id, name) VALUES ($1,'B1') RETURNING id`, [projectId])).rows[0].id;
      levelId = (await admin.query(`INSERT INTO core.level (building_id, name) VALUES ($1,'L1') RETURNING id`, [buildingId])).rows[0].id;
      zoneId = (await admin.query(`INSERT INTO core.zone (project_id, level_id, name) VALUES ($1,$2,'Z1') RETURNING id`, [projectId, levelId])).rows[0].id;
      otherZoneId = (await admin.query(`INSERT INTO core.zone (project_id, name) VALUES ($1,'Z2') RETURNING id`, [otherProjectId])).rows[0].id;
    });

    it('accepts a project only, and a project with building, level and zone', async () => {
      await admin.query(`INSERT INTO core.asset (name, source_system, external_id, project_id) VALUES ('a','datoms','a-1',$1)`, [projectId]);
      await admin.query(
        `INSERT INTO core.asset (name, source_system, external_id, project_id, building_id, level_id, zone_id) VALUES ('a','datoms','a-2',$1,$2,$3,$4)`,
        [projectId, buildingId, levelId, zoneId],
      );
      const linked = await admin.query(`SELECT count(*)::int AS n FROM core.asset WHERE project_id IS NOT NULL`);
      expect(linked.rows[0].n).toBe(2);
    });

    it('accepts a zone without a level or building (zone is optional and independent)', async () => {
      await admin.query(`INSERT INTO core.asset (name, source_system, external_id, project_id, zone_id) VALUES ('a','datoms','a-3',$1,$2)`, [projectId, zoneId]);
    });

    it('rejects a zone, building or level of another project', async () => {
      expect(
        await sqlState(admin.query(`INSERT INTO core.asset (name, source_system, external_id, project_id, zone_id) VALUES ('a','datoms','a-4',$1,$2)`, [projectId, otherZoneId])),
      ).toBe('23503');
      expect(
        await sqlState(admin.query(`INSERT INTO core.asset (name, source_system, external_id, project_id, building_id) VALUES ('a','datoms','a-5',$1,$2)`, [otherProjectId, buildingId])),
      ).toBe('23503');
    });

    it('rejects spatial links without a project, and a level without its building', async () => {
      expect(
        await sqlState(admin.query(`INSERT INTO core.asset (name, source_system, external_id, zone_id) VALUES ('a','datoms','a-6',$1)`, [zoneId])),
      ).toBe('23514');
      expect(
        await sqlState(admin.query(`INSERT INTO core.asset (name, source_system, external_id, project_id, level_id) VALUES ('a','datoms','a-7',$1,$2)`, [projectId, levelId])),
      ).toBe('23514');
    });

    it('keeps an asset not yet linked to a project (null project, no spatial links)', async () => {
      await admin.query(asset('', 'a-8'));
    });

    it('is unique on source_system + external_id for assets and spatial rows', async () => {
      expect(await sqlState(admin.query(asset('', 'a-8')))).toBe('23505');
      await admin.query(`UPDATE core.zone SET source_system='datoms', external_id='z' WHERE id=$1`, [zoneId]);
      expect(
        await sqlState(admin.query(`INSERT INTO core.zone (project_id, name, source_system, external_id) VALUES ($1,'Z9','datoms','z')`, [projectId])),
      ).toBe('23505');
    });
  });

  describe('least-privilege roles', () => {
    it('lets the api manage access mappings but not roles or permissions', async () => {
      const api = await connectAs(db.adminUrl, 'nexus_api');
      try {
        await api.query(`INSERT INTO access.group_role (entra_group_id, role_code) VALUES (gen_random_uuid(), 'viewer')`);
        expect(await sqlState(api.query(`INSERT INTO access.role_permission VALUES ('viewer','audit.read')`))).toBe('42501');
        expect(await sqlState(api.query(`UPDATE access.role SET all_projects = true`))).toBe('42501');
        expect(await sqlState(api.query(`DELETE FROM access.app_user`))).toBe('42501');
      } finally {
        await api.end();
      }
    });

    it('lets the api insert audit rows but never change or read them back destructively', async () => {
      const api = await connectAs(db.adminUrl, 'nexus_api');
      try {
        await api.query(`INSERT INTO audit.log (action) VALUES ('test')`);
        expect(await sqlState(api.query(`UPDATE audit.log SET action = 'x'`))).toBe('42501');
        expect(await sqlState(api.query(`DELETE FROM audit.log`))).toBe('42501');
      } finally {
        await api.end();
      }
    });

    it('keeps telemetry writes to the worker and read state writes to the api', async () => {
      const api = await connectAs(db.adminUrl, 'nexus_api');
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      try {
        const insertPacket = `INSERT INTO telemetry.packet (asset_id, ts, values) VALUES (gen_random_uuid(), now(), '{}')`;
        expect(await sqlState(api.query(insertPacket))).toBe('42501');
        await worker.query(insertPacket);
        expect(await sqlState(worker.query(`INSERT INTO access.user_role VALUES (gen_random_uuid(), 'admin')`))).toBe('42501');
        expect(await sqlState(worker.query(`INSERT INTO events.read_marker (user_id, read_before) VALUES (gen_random_uuid(), now())`))).toBe('42501');
        expect(await sqlState(api.query(`UPDATE core.asset SET kind = 'site_metric'`))).toBe('42501');
      } finally {
        await api.end();
        await worker.end();
      }
    });

    it('reads everything through the views', async () => {
      const api = await connectAs(db.adminUrl, 'nexus_api');
      try {
        await api.query('SELECT * FROM core.v_asset_live LIMIT 1');
        await api.query('SELECT * FROM core.v_site_metric_live LIMIT 1');
      } finally {
        await api.end();
      }
    });
  });

  describe('partition maintenance functions (SECURITY DEFINER)', () => {
    it('let the worker create and drop partitions of Nexus tables, in UTC', async () => {
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      try {
        await worker.query(`SET TIME ZONE 'Asia/Dubai'`);
        const made = await worker.query(`SELECT core.create_range_partitions('telemetry.packet', 'day', DATE '2031-03-01', 2) AS n`);
        expect(made.rows[0].n).toBe(2);
        const bound = await admin.query(`SELECT pg_get_expr(c.relpartbound, c.oid) AS b FROM pg_class c WHERE c.relname = 'packet_p20310301'`);
        expect(bound.rows[0].b).toMatch(/FROM \('2031-03-01 00:00:00\+00'\) TO \('2031-03-02 00:00:00\+00'\)/);
        // Past partitions can be dropped; the call is idempotent.
        const dropped = await worker.query(`SELECT * FROM core.drop_partitions_before('telemetry.rollup_5m', now() - interval '3 years')`);
        expect(dropped.rows).toEqual([]);
        // The worker cannot create an old partition of a protected table (N1); the owner can, for this test.
        await admin.query(`CREATE TABLE events.event_p202001 PARTITION OF events.event FOR VALUES FROM ('2020-01-01') TO ('2020-02-01')`);
        const gone = await worker.query(`SELECT * FROM core.drop_partitions_before('events.event', timestamptz '2021-01-01')`);
        expect(gone.rowCount).toBe(1);
      } finally {
        await worker.end();
      }
    });

    it('refuse other tables, bad counts and a drop date in the future', async () => {
      const worker = await connectAs(db.adminUrl, 'nexus_worker');
      try {
        await expect(worker.query(`SELECT core.create_range_partitions('access.user_role', 'day', CURRENT_DATE, 1)`)).rejects.toThrow(/not a partitioned table/);
        await expect(worker.query(`SELECT core.create_range_partitions('core.asset', 'day', CURRENT_DATE, 1)`)).rejects.toThrow(/not a partitioned table/);
        await expect(worker.query(`SELECT core.create_range_partitions('telemetry.packet', 'day', CURRENT_DATE, 100000)`)).rejects.toThrow(/p_count/);
        await expect(worker.query(`SELECT * FROM core.drop_partitions_before('telemetry.packet', now() + interval '1 day')`)).rejects.toThrow(/future/);
      } finally {
        await worker.end();
      }
    });

    it('are not executable by the api', async () => {
      const api = await connectAs(db.adminUrl, 'nexus_api');
      try {
        expect(await sqlState(api.query(`SELECT core.create_range_partitions('telemetry.packet', 'day', CURRENT_DATE, 1)`))).toBe('42501');
        expect(await sqlState(api.query(`SELECT * FROM core.drop_partitions_before('telemetry.packet', now())`))).toBe('42501');
      } finally {
        await api.end();
      }
    });

    it('create partitions that inherit lz4 compression on the jsonb values', async () => {
      const r = await admin.query(`SELECT a.attcompression AS c FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'packet_p20310301' AND a.attname = 'values'`);
      expect(r.rows[0].c).toBe('l');
    });
  });

  describe('access change notifications', () => {
    const collect = async (change: (c: pg.Client) => Promise<unknown>): Promise<string[]> => {
      const listener = new pg.Client({ connectionString: db.adminUrl });
      await listener.connect();
      const got: string[] = [];
      listener.on('notification', (m) => got.push(m.payload ?? ''));
      await listener.query('LISTEN nexus_access');
      await change(admin);
      await admin.query('SELECT 1');
      await new Promise((r) => setTimeout(r, 150));
      await listener.end();
      return got;
    };

    it('announce one user when their role, project access or active flag changes', async () => {
      const u = await admin.query(`INSERT INTO access.app_user (entra_oid, tenant_id) VALUES (gen_random_uuid(), gen_random_uuid()) RETURNING id`);
      const userId = u.rows[0].id as string;
      const got = await collect(async (c) => {
        await c.query(`INSERT INTO access.user_role VALUES ($1,'viewer')`, [userId]);
        await c.query(`INSERT INTO access.project_access (project_id, user_id) VALUES ($1,$2)`, [projectId, userId]);
        await c.query(`UPDATE access.app_user SET is_active = false WHERE id = $1`, [userId]);
      });
      expect(new Set(got.map(normalise))).toEqual(
        new Set([normalise(JSON.stringify({ scope: 'user', userId }))]),
      );
    });

    it('announce everyone when a group or role mapping changes', async () => {
      const got = await collect((c) => c.query(`INSERT INTO access.group_role (entra_group_id, role_code) VALUES (gen_random_uuid(), 'viewer')`));
      expect(got.map(normalise)).toEqual([normalise('{"scope":"all"}')]);
    });

    it('stay quiet when a sign-in only updates last_seen_at', async () => {
      const got = await collect((c) => c.query(`UPDATE access.app_user SET last_seen_at = now(), email = 'x@y'`));
      expect(got).toEqual([]);
    });
  });

  describe('seeds', () => {
    it('are idempotent and fill the DATOMS parameter dictionary', async () => {
      const first = await admin.query(`SELECT count(*)::int AS n FROM telemetry.parameter`);
      await seed({ url: db.adminUrl, appEnv: 'local' });
      await seed({ url: db.adminUrl, appEnv: 'local' });
      const second = await admin.query(`SELECT count(*)::int AS n FROM telemetry.parameter`);
      expect(second.rows[0].n).toBe(first.rows[0].n);
      expect(second.rows[0].n).toBe(164);
    });

    it('create the passwordless local login users only for APP_ENV=local', async () => {
      const dev = await seed({ url: db.adminUrl, appEnv: 'dev' });
      expect(dev.skipped).toContain('dev-login-roles.sql');
      const prod = await seed({ url: db.adminUrl, appEnv: 'prod' });
      expect(prod.ran).toEqual(['datoms-parameters.sql']);
      const local = await seed({ url: db.adminUrl, appEnv: 'local' });
      expect(local.ran).toContain('dev-login-roles.sql');
      const r = await admin.query(`SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname IN ('nexus_api_local','nexus_worker_local') ORDER BY 1`);
      expect(r.rows.map((x) => [x.rolname, x.rolcanlogin, x.rolsuper])).toEqual([
        ['nexus_api_local', true, false],
        ['nexus_worker_local', true, false],
      ]);
    });

    it('refuse to run the local-only files outside local, even when called directly', async () => {
      const file = (await import('node:fs')).readFileSync(new URL('../seeds/dev-login-roles.sql', import.meta.url), 'utf8');
      const c = new pg.Client({ connectionString: db.adminUrl });
      await c.connect();
      try {
        await c.query(`SELECT set_config('nexus.app_env','dev',false)`);
        await expect(c.query(file)).rejects.toThrow(/APP_ENV=local only/);
      } finally {
        await c.end();
      }
    });
  });
});

/** Payload JSON key order is not guaranteed to match a hand-written string. */
function normalise(json: string): string {
  const o = JSON.parse(json) as Record<string, string>;
  return JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
}
