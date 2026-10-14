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
import type { AppConfig } from '../src/config/env.js';

/** QA S1-01 step 6: two API instances on one database; a change made anywhere is seen by the other. */
const TENANT = '11111111-2222-4333-8444-555555555555';
const GROUP = 'cccccccc-0000-4000-8000-00000000000a';
let n = 0;
const who = (groupIds: string[] = []): SignedInIdentity => ({
  oid: `dddddddd-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  tenantId: TENANT,
  groupIds,
});
const waitFor = async (cond: () => boolean | Promise<boolean>, what: string): Promise<void> => {
  for (let i = 0; i < 120; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe.skipIf(testDatabaseAdminUrl === undefined)('two directory instances (QA S1-01)', () => {
  let testDb: TestDatabase;
  let admin: pg.Client;
  let db: Database;
  let directory: PostgresAccessDirectory;
  const projects: string[] = [];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    admin = new pg.Client({ connectionString: testDb.adminUrl });
    await admin.connect();
    db = createDatabase({
      url: testDb.adminUrl,
      applicationName: 'qa',
      sessionRole: 'nexus_api',
      poolMax: 4,
    });
    directory = new PostgresAccessDirectory(db);
    for (const i of [1, 2]) {
      projects.push(
        (
          await admin.query<{ id: string }>(
            `INSERT INTO core.project (name, source_system, external_id) VALUES ($1,'datoms',$1) RETURNING id`,
            [`QA${i}`],
          )
        ).rows[0]!.id,
      );
    }
    await admin.query(`INSERT INTO access.group_role VALUES ($1,'project_manager')`, [GROUP]);
    await admin.query(
      `INSERT INTO access.project_access (project_id, entra_group_id) VALUES ($1,$2)`,
      [projects[0], GROUP],
    );
  });
  afterAll(async () => {
    await db?.destroy();
    await admin?.end();
    await testDb?.drop();
  });

  async function instance(delayLoad?: Promise<void>) {
    let loads = 0;
    const dir: AccessDirectory = {
      upsertUser: directory.upsertUser.bind(directory),
      isUserActive: directory.isUserActive.bind(directory),
      loadAccess: async (...a) => {
        loads += 1;
        const snapshot = await directory.loadAccess(...a);
        if (delayLoad) await delayLoad;
        return snapshot;
      },
    };
    const service = new AccessContextService(dir, () => Date.now());
    const listener = new AccessChangeListener(
      { database: { url: testDb.adminUrl, poolMax: 1 } } as AppConfig,
      service,
    );
    listener.onApplicationBootstrap();
    await waitFor(() => listener.isListening, 'listener');
    return { service, loads: () => loads, stop: () => listener.onApplicationShutdown() };
  }

  it('a direct project grant made via the DB shows on both instances (scope change)', async () => {
    const [a, b] = [await instance(), await instance()];
    try {
      const id = who([GROUP]);
      await a.service.resolve(id);
      await b.service.resolve(id);
      expect((await b.service.resolve(id)).projectIds.size).toBe(1);
      expect(b.loads()).toBe(1); // cached
      const { userId } = await directory.upsertUser(id);
      await admin.query(`INSERT INTO access.project_access (project_id, user_id) VALUES ($1,$2)`, [
        projects[1],
        userId,
      ]);
      await waitFor(
        async () => (await a.service.resolve(id)).projectIds.size === 2,
        'A sees project 2',
      );
      await waitFor(
        async () => (await b.service.resolve(id)).projectIds.size === 2,
        'B sees project 2',
      );
      // and removal is seen too: the user must lose project 2 on both at once
      await admin.query(`DELETE FROM access.project_access WHERE user_id = $1`, [userId]);
      await waitFor(
        async () => (await a.service.resolve(id)).projectIds.size === 1,
        'A loses project 2',
      );
      await waitFor(
        async () => (await b.service.resolve(id)).projectIds.size === 1,
        'B loses project 2',
      );
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('a group to role mapping removal clears every instance', async () => {
    const [a, b] = [await instance(), await instance()];
    try {
      const g = 'cccccccc-0000-4000-8000-00000000000b';
      await admin.query(`INSERT INTO access.group_role VALUES ($1,'viewer')`, [g]);
      const id = who([g]);
      await a.service.resolve(id);
      await b.service.resolve(id);
      await admin.query(`DELETE FROM access.group_role WHERE entra_group_id = $1`, [g]);
      await waitFor(
        async () => (await a.service.resolve(id)).roles.length === 0,
        'A drops the role',
      );
      await waitFor(
        async () => (await b.service.resolve(id)).roles.length === 0,
        'B drops the role',
      );
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('deactivation by the API login is refused at once on the other instance, on a cache hit', async () => {
    const [a, b] = [await instance(), await instance()];
    try {
      const id = who([GROUP]);
      await a.service.resolve(id);
      await b.service.resolve(id);
      expect(b.loads()).toBe(1);
      const apiConn = new pg.Client({ connectionString: testDb.adminUrl });
      await apiConn.connect();
      try {
        await apiConn.query(`SET ROLE nexus_api`);
        await apiConn.query(`UPDATE access.app_user SET is_active=false WHERE entra_oid=$1`, [
          id.oid,
        ]);
      } finally {
        await apiConn.end();
      }
      // No waiting: the hit-time check must refuse regardless of notification timing.
      await expect(b.service.resolve(id)).rejects.toBeInstanceOf(InactiveUserError);
      await expect(a.service.resolve(id)).rejects.toBeInstanceOf(InactiveUserError);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('does not cache a load that began before a database change (real NOTIFY)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = await instance(gate);
    try {
      const id = who([GROUP]);
      const pending = slow.service.resolve(id); // reads project set {1}, then waits
      await new Promise((r) => setTimeout(r, 300));
      const g2 = 'cccccccc-0000-4000-8000-00000000000a';
      await admin.query(
        `INSERT INTO access.project_access (project_id, entra_group_id) VALUES ($1,$2)`,
        [projects[1], g2],
      );
      await new Promise((r) => setTimeout(r, 300)); // NOTIFY delivered while the load is in flight
      release();
      await pending;
      const loadsBefore = slow.loads();
      const next = await slow.service.resolve(id);
      expect(slow.loads()).toBe(loadsBefore + 1); // stale result was not cached
      expect(next.projectIds.size).toBe(2);
    } finally {
      await admin.query(
        `DELETE FROM access.project_access WHERE project_id=$1 AND entra_group_id=$2`,
        [projects[1], GROUP],
      );
      await slow.stop();
    }
  });
});
