import 'reflect-metadata';
import { createDatabase, type Database } from '@nexus/db';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresMeRepository } from '../src/modules/access/me.repository.js';
import { PROJECT_STATE_KEYS } from '../src/modules/config/client-config.js';
import { PostgresClientConfigRepository } from '../src/modules/config/config.repository.js';

describe.skipIf(testDatabaseAdminUrl === undefined)(
  '/me and /config repositories on PostgreSQL',
  () => {
    let testDb: TestDatabase;
    let admin: pg.Client;
    let db: Database; // the nexus_api role, as in production

    beforeAll(async () => {
      testDb = await createTestDatabase();
      admin = new pg.Client({ connectionString: testDb.adminUrl });
      await admin.connect();
      db = createDatabase({
        url: testDb.adminUrl,
        applicationName: 'test',
        sessionRole: 'nexus_api',
        poolMax: 2,
      });
    });
    afterAll(async () => {
      await db?.destroy();
      await admin?.end();
      await testDb?.drop();
    });

    it('reads the stored name and email of the user, and nulls for a missing user', async () => {
      const r = await admin.query<{ id: string }>(
        `INSERT INTO access.app_user (entra_oid, tenant_id, email, display_name)
       VALUES (gen_random_uuid(), gen_random_uuid(), 'a@innovo.example', 'A User') RETURNING id`,
      );
      const repo = new PostgresMeRepository(db);
      expect(await repo.profile(r.rows[0]!.id)).toEqual({
        name: 'A User',
        email: 'a@innovo.example',
      });
      expect(await repo.profile('00000000-0000-4000-8000-000000000000')).toEqual({
        name: null,
        email: null,
      });
    });

    it('reads the feature flags exactly as stored', async () => {
      const stored = await admin.query<{ key: string; enabled: boolean }>(
        `SELECT key, enabled FROM core.feature_flag`,
      );
      const flags = await new PostgresClientConfigRepository(db).featureFlags();
      expect(Object.keys(flags).length).toBeGreaterThan(0);
      expect(flags).toEqual(Object.fromEntries(stored.rows.map((x) => [x.key, x.enabled])));
    });

    it('lists the distinct display statuses of status_map', async () => {
      await admin.query(
        `INSERT INTO telemetry.status_map VALUES ('datoms','Running','running'),('datoms','Run','running'),('datoms','Off','off')`,
      );
      expect(await new PostgresClientConfigRepository(db).displayStatusKeys()).toEqual([
        'off',
        'running',
      ]);
    });

    it('PROJECT_STATE_KEYS equals the CHECK constraint on core.project.state', async () => {
      const r = await admin.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       WHERE c.conrelid = 'core.project'::regclass AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%state%' AND pg_get_constraintdef(c.oid) LIKE '%central_store%'`,
      );
      const states = [...(r.rows[0]?.def ?? '').matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
      expect([...states].sort()).toEqual([...PROJECT_STATE_KEYS].sort());
    });
  },
);
