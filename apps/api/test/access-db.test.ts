import 'reflect-metadata';
import { createDatabase, type Database } from '@nexus/db';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessChangeListener } from '../src/common/auth/access-change-listener.js';
import {
  AccessContextService,
  InactiveUserError,
  type AccessDirectory,
  type SignedInIdentity,
} from '../src/common/auth/access-context.js';
import { PostgresAccessDirectory } from '../src/common/auth/postgres-access-directory.js';
import { withProjectScope } from '../src/common/auth/project-scope.js';
import type { AppConfig } from '../src/config/env.js';

const TENANT = '11111111-2222-4333-8444-555555555555';
const GROUP_PM = 'bbbbbbbb-0000-4000-8000-00000000000a';
const GROUP_LEAD = 'bbbbbbbb-0000-4000-8000-00000000000b';

let oidCounter = 0;
const newOid = (): string => `aaaaaaaa-0000-4000-8000-${String(++oidCounter).padStart(12, '0')}`;
const who = (
  oid: string,
  groupIds: string[] = [],
  extra: Partial<SignedInIdentity> = {},
): SignedInIdentity => ({
  oid,
  tenantId: TENANT,
  groupIds,
  ...extra,
});

describe.skipIf(testDatabaseAdminUrl === undefined)('access directory on PostgreSQL', () => {
  let testDb: TestDatabase;
  let admin: pg.Client;
  let db: Database; // connects as the nexus_api role, exactly like the API
  let directory: PostgresAccessDirectory;
  const projects: string[] = [];

  const waitFor = async (
    condition: () => boolean | Promise<boolean>,
    what: string,
  ): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    admin = new pg.Client({ connectionString: testDb.adminUrl });
    await admin.connect();
    db = createDatabase({
      url: testDb.adminUrl,
      applicationName: 'test',
      sessionRole: 'nexus_api',
      poolMax: 4,
    });
    directory = new PostgresAccessDirectory(db);

    for (const n of [1, 2, 3]) {
      const r = await admin.query<{ id: string }>(
        `INSERT INTO core.project (name, source_system, external_id) VALUES ($1,'datoms',$2) RETURNING id`,
        [`P${n}`, `s${n}`],
      );
      projects.push(r.rows[0]!.id);
    }
    await admin.query(
      `INSERT INTO access.group_role VALUES ($1,'project_manager'), ($2,'leadership')`,
      [GROUP_PM, GROUP_LEAD],
    );
    await admin.query(
      `INSERT INTO access.project_access (project_id, entra_group_id) VALUES ($1,$2), ($3,$2)`,
      [projects[0], GROUP_PM, projects[1]],
    );
  });
  afterAll(async () => {
    await db?.destroy();
    await admin?.end();
    await testDb?.drop();
  });

  describe('loadAccess', () => {
    it('returns roles, permissions and project ids from groups and direct grants', async () => {
      const { userId } = await directory.upsertUser(who(newOid(), [GROUP_PM]));
      await admin.query(`INSERT INTO access.project_access (project_id, user_id) VALUES ($1,$2)`, [
        projects[2],
        userId,
      ]);
      const ctx = await directory.loadAccess(userId, [GROUP_PM]);
      expect(ctx.roles).toEqual(['project_manager']);
      expect(ctx.permissions.has('explorer.export')).toBe(true);
      expect(ctx.permissions.has('admin.settings')).toBe(false);
      expect(ctx.allProjects).toBe(false);
      expect([...ctx.projectIds].sort()).toEqual([...projects].sort());
    });

    it('gives all-projects roles an empty id set, and a user with no group nothing', async () => {
      const { userId } = await directory.upsertUser(who(newOid(), [GROUP_LEAD]));
      const lead = await directory.loadAccess(userId, [GROUP_LEAD]);
      expect(lead.allProjects).toBe(true);
      expect(lead.projectIds.size).toBe(0);
      const none = await directory.loadAccess(userId, []);
      expect(none.roles).toEqual([]);
      expect(none.permissions.size).toBe(0);
      expect(none.allProjects).toBe(false);
    });

    it('ignores group ids that are not UUIDs instead of failing', async () => {
      const { userId } = await directory.upsertUser(who(newOid()));
      const ctx = await directory.loadAccess(userId, [
        'not-a-uuid',
        "x'); DROP TABLE core.project;--",
        GROUP_PM.toUpperCase(),
      ]);
      expect(ctx.roles).toEqual(['project_manager']);
    });
  });

  describe('upsertUser and the sign-in audit row (Q29 c)', () => {
    const auditRows = async (userId: string): Promise<Record<string, unknown>[]> =>
      (
        await admin.query(
          `SELECT * FROM audit.log WHERE user_id = $1 AND action = 'auth.sign_in'`,
          [userId],
        )
      ).rows;

    it('creates the user and writes one sign-in row with the request details', async () => {
      const oid = newOid();
      const { userId, isActive } = await directory.upsertUser(
        who(oid, [GROUP_PM], {
          email: 'a@innovo.example',
          displayName: 'A',
          request: { ip: '10.1.2.3', userAgent: 'vitest', correlationId: 'req-9' },
        }),
      );
      expect(isActive).toBe(true);
      const rows = await auditRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        target_type: 'app_user',
        target_id: userId,
        ip: '10.1.2.3',
        user_agent: 'vitest',
        correlation_id: 'req-9',
        details: { groupCount: 1 },
      });
      const user = await admin.query(
        `SELECT email, display_name, tenant_id FROM access.app_user WHERE id=$1`,
        [userId],
      );
      expect(user.rows[0]).toEqual({
        email: 'a@innovo.example',
        display_name: 'A',
        tenant_id: TENANT,
      });
    });

    it('does not audit again for a user who is still active, but does after the idle window', async () => {
      const oid = newOid();
      const { userId } = await directory.upsertUser(who(oid));
      await directory.upsertUser(who(oid));
      expect(await auditRows(userId)).toHaveLength(1);
      await admin.query(
        `UPDATE access.app_user SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
        [userId, 61],
      );
      await directory.upsertUser(who(oid));
      expect(await auditRows(userId)).toHaveLength(2);
    });

    it('keeps a stored name and email when the token has none, and never audits an inactive user', async () => {
      const oid = newOid();
      const { userId } = await directory.upsertUser(
        who(oid, [], { email: 'keep@innovo.example', displayName: 'Keep' }),
      );
      await directory.upsertUser(who(oid));
      const user = await admin.query(
        `SELECT email, display_name FROM access.app_user WHERE id=$1`,
        [userId],
      );
      expect(user.rows[0]).toEqual({ email: 'keep@innovo.example', display_name: 'Keep' });

      await admin.query(
        `UPDATE access.app_user SET is_active=false, last_seen_at = NULL WHERE id=$1`,
        [userId],
      );
      const again = await directory.upsertUser(who(oid));
      expect(again.isActive).toBe(false);
      expect(await auditRows(userId)).toHaveLength(1);
      expect(await directory.isUserActive(userId)).toBe(false);
    });

    it('matches users by oid only, never by email', async () => {
      const a = await directory.upsertUser(who(newOid(), [], { email: 'same@innovo.example' }));
      const b = await directory.upsertUser(who(newOid(), [], { email: 'same@innovo.example' }));
      expect(a.userId).not.toBe(b.userId);
    });

    it('reads the audit gap from core.setting (default 60) and re-reads it after the cache time', async () => {
      const readGap = async (): Promise<number> => {
        const d = new PostgresAccessDirectory(db);
        const oid = newOid();
        const { userId } = await d.upsertUser(who(oid));
        // 30 minutes idle: audited only if the gap is shorter than that.
        await admin.query(
          `UPDATE access.app_user SET last_seen_at = now() - interval '30 minutes' WHERE id = $1`,
          [userId],
        );
        await d.upsertUser(who(oid));
        const rows = await admin.query(
          `SELECT count(*)::int AS n FROM audit.log WHERE user_id = $1 AND action = 'auth.sign_in'`,
          [userId],
        );
        return rows.rows[0].n as number;
      };
      expect(await readGap()).toBe(1); // 60 minute default: 30 minutes idle is the same session
      await admin.query(
        `UPDATE core.setting SET value = '15' WHERE key = 'audit.sign_in_gap_minutes'`,
      );
      try {
        expect(await readGap()).toBe(2); // 15 minute gap: a new sign-in
        await admin.query(
          `UPDATE core.setting SET value = '"abc"' WHERE key = 'audit.sign_in_gap_minutes'`,
        );
        expect(await readGap()).toBe(1); // unreadable value falls back to 60
      } finally {
        await admin.query(
          `UPDATE core.setting SET value = '60' WHERE key = 'audit.sign_in_gap_minutes'`,
        );
      }
    });

    it('still signs the user in when the audit write fails (no partition), and logs it', async () => {
      // Remove every audit partition, so no row can be stored for now().
      const parts = await admin.query<{ n: string }>(
        `SELECT c.oid::regclass::text AS n FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid WHERE i.inhparent='audit.log'::regclass`,
      );
      for (const p of parts.rows)
        await admin.query(`ALTER TABLE audit.log DETACH PARTITION ${p.n}`);
      try {
        const before = directory.auditWriteFailures;
        const r = await directory.upsertUser(who(newOid()));
        expect(r.isActive).toBe(true);
        expect(directory.auditWriteFailures).toBe(before + 1); // L8: counted, and logged as event=audit.write_failed
      } finally {
        for (const p of parts.rows) await admin.query(`DROP TABLE ${p.n}`);
        await admin.query(
          `SELECT core.create_range_partitions('audit.log','month', current_date, 3)`,
        );
      }
    });
  });

  describe('cache invalidation across instances (S1-02 review L3)', () => {
    /** Two API instances sharing one database: each has its own cache and listener. */
    async function instance(): Promise<{
      service: AccessContextService;
      listener: AccessChangeListener;
      loads: () => number;
      stop: () => Promise<void>;
    }> {
      let loads = 0;
      const counting: AccessDirectory = {
        upsertUser: directory.upsertUser.bind(directory),
        isUserActive: directory.isUserActive.bind(directory),
        loadAccess: (...a) => {
          loads += 1;
          return directory.loadAccess(...a);
        },
      };
      const service = new AccessContextService(counting, () => Date.now());
      const listener = new AccessChangeListener(
        { database: { url: testDb.adminUrl, poolMax: 1 } } as AppConfig,
        service,
      );
      listener.onApplicationBootstrap();
      await waitFor(() => listener.isListening, 'the listener');
      return {
        service,
        listener,
        loads: () => loads,
        stop: () => listener.onApplicationShutdown(),
      };
    }

    it('a role change made through the database reaches both instances at once', async () => {
      const [a, b] = [await instance(), await instance()];
      try {
        const oid = newOid();
        const user = who(oid);
        expect((await a.service.resolve(user)).roles).toEqual([]);
        expect((await b.service.resolve(user)).roles).toEqual([]);
        await a.service.resolve(user);
        expect([a.loads(), b.loads()]).toEqual([1, 1]); // cached on both

        const { userId } = await directory.upsertUser(user);
        await admin.query(`INSERT INTO access.user_role VALUES ($1,'viewer')`, [userId]);

        await waitFor(
          async () => (await a.service.resolve(user)).roles.includes('viewer'),
          'instance A to see the role',
        );
        await waitFor(
          async () => (await b.service.resolve(user)).roles.includes('viewer'),
          'instance B to see the role',
        );
      } finally {
        await a.stop();
        await b.stop();
      }
    });

    it('a group mapping change clears everybody, and deactivation is refused at once', async () => {
      const a = await instance();
      try {
        const oid = newOid();
        const user = who(oid, [GROUP_PM]);
        const first = await a.service.resolve(user);
        expect(first.projectIds.size).toBe(2);
        await admin.query(
          `INSERT INTO access.project_access (project_id, entra_group_id) VALUES ($1,$2)`,
          [projects[2], GROUP_PM],
        );
        await waitFor(
          async () => (await a.service.resolve(user)).projectIds.size === 3,
          'the new project',
        );

        await admin.query(`UPDATE access.app_user SET is_active = false WHERE entra_oid = $1`, [
          oid,
        ]);
        await expect(a.service.resolve(user)).rejects.toBeInstanceOf(InactiveUserError);
        await admin.query(`UPDATE access.app_user SET is_active = true WHERE entra_oid = $1`, [
          oid,
        ]);
        await expect(a.service.resolve(user)).resolves.toBeDefined();
        await admin.query(
          `DELETE FROM access.project_access WHERE project_id = $1 AND entra_group_id = $2`,
          [projects[2], GROUP_PM],
        );
      } finally {
        await a.stop();
      }
    });

    it('refuses a deactivated user on a cache hit even before any notification arrives', async () => {
      const a = await instance();
      try {
        const oid = newOid();
        const user = who(oid);
        await a.service.resolve(user);
        await a.service.resolve(user);
        expect(a.loads()).toBe(1);
        // Whether or not the notification has arrived yet, the hit-time is_active check refuses the user.
        await admin.query(`UPDATE access.app_user SET is_active = false WHERE entra_oid = $1`, [
          oid,
        ]);
        await expect(a.service.resolve(user)).rejects.toBeInstanceOf(InactiveUserError);
      } finally {
        await a.stop();
      }
    });

    it('keeps the cache off while the listener connection is down and recovers by itself', async () => {
      const a = await instance();
      try {
        const user = who(newOid());
        await a.service.resolve(user);
        await a.service.resolve(user);
        expect(a.loads()).toBe(1);

        // Kill the listener's backend from the server side.
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'nexus-api-listener' AND datname = current_database()`,
        );
        await waitFor(() => !a.listener.isListening, 'the listener to notice');
        await a.service.resolve(user);
        await a.service.resolve(user);
        expect(a.loads()).toBe(3); // not cached while it is down

        await waitFor(() => a.listener.isListening, 'the listener to reconnect');
        await a.service.resolve(user);
        const afterReconnect = a.loads();
        await a.service.resolve(user);
        expect(a.loads()).toBe(afterReconnect); // cached again
      } finally {
        await a.stop();
      }
    });
  });

  describe('withProjectScope on real tables', () => {
    let assetIds: Record<string, string>;
    beforeAll(async () => {
      assetIds = {};
      for (const [name, project] of [
        ['a1', projects[0]],
        ['a2', projects[1]],
        ['a3', projects[2]],
        ['unlinked', null],
      ] as const) {
        const r = await admin.query<{ id: string }>(
          `INSERT INTO core.asset (name, source_system, external_id, project_id) VALUES ($1,'datoms',$1,$2) RETURNING id`,
          [name, project],
        );
        assetIds[name] = r.rows[0]!.id;
      }
    });

    const names = async (
      ctx: Awaited<ReturnType<typeof directory.loadAccess>>,
    ): Promise<string[]> => {
      const rows = await withProjectScope(
        db
          .selectFrom('core.asset as a')
          .select('a.name')
          .where('a.name', 'in', ['a1', 'a2', 'a3', 'unlinked'])
          .orderBy('a.name'),
        ctx,
        'a.project_id',
      ).execute();
      return rows.map((r) => r.name);
    };

    it('shows a scoped user only their projects, and never unlinked assets', async () => {
      const { userId } = await directory.upsertUser(who(newOid(), [GROUP_PM]));
      expect(await names(await directory.loadAccess(userId, [GROUP_PM]))).toEqual(['a1', 'a2']);
    });

    it('shows nothing to a user with no projects', async () => {
      const { userId } = await directory.upsertUser(who(newOid()));
      expect(await names(await directory.loadAccess(userId, []))).toEqual([]);
    });

    it('does not filter a user whose role has all_projects by project, but still hides unlinked assets (L4)', async () => {
      const { userId } = await directory.upsertUser(who(newOid(), [GROUP_LEAD]));
      expect(await names(await directory.loadAccess(userId, [GROUP_LEAD]))).toEqual([
        'a1',
        'a2',
        'a3',
      ]);
    });

    it('shows unlinked assets only when the admin linking screen asks for them', async () => {
      const { userId } = await directory.upsertUser(who(newOid(), [GROUP_LEAD]));
      const ctx = await directory.loadAccess(userId, [GROUP_LEAD]);
      const rows = await withProjectScope(
        db
          .selectFrom('core.asset as a')
          .select('a.name')
          .where('a.name', 'in', ['a1', 'unlinked'])
          .orderBy('a.name'),
        ctx,
        'a.project_id',
        { includeUnlinked: true },
      ).execute();
      expect(rows.map((r) => r.name)).toEqual(['a1', 'unlinked']);
      // a scoped user never gets them, even with the flag
      const scoped = await directory.loadAccess(
        (await directory.upsertUser(who(newOid(), [GROUP_PM]))).userId,
        [GROUP_PM],
      );
      const none = await withProjectScope(
        db.selectFrom('core.asset as a').select('a.name').where('a.name', '=', 'unlinked'),
        scoped,
        'a.project_id',
        { includeUnlinked: true },
      ).execute();
      expect(none).toEqual([]);
    });

    it('puts the ids in a bound parameter, never into the SQL text', () => {
      const ctx = {
        userId: 'u',
        roles: [],
        permissions: new Set<never>(),
        allProjects: false,
        projectIds: new Set(["x'; DROP TABLE core.project;--"]),
      };
      const compiled = withProjectScope(
        db.selectFrom('core.asset as a').select('a.id'),
        ctx,
        'a.project_id',
      ).compile();
      expect(compiled.sql).toContain('"a"."project_id" = any($1::uuid[])');
      expect(compiled.sql).not.toContain('DROP');
      expect(compiled.parameters).toEqual([["x'; DROP TABLE core.project;--"]]);
    });
  });
});
