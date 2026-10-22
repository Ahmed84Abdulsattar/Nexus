import 'reflect-metadata';
import { BUDGET_RESTORE_DAYS } from '@nexus/connectors-datoms';
import { createDatabase, type Database } from '@nexus/db';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import { SYNC_WARNING_METRIC, syncRunDetailsSchema } from '@nexus/shared';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAINTENANCE_ESCALATE_AFTER,
  MAINTENANCE_RETRY_MS,
  MaintenanceJob,
  maintenanceRetryDelay,
} from '../src/jobs/maintenance.job.js';
import {
  PARTITIONED_TABLES,
  RETENTION_LIMITS,
  RETENTION_MAX_DAYS,
  clampRetention,
  listPartitions,
  msUntilNextDubaiHour,
  needsEarlyRetry,
  nextPartitionName,
  partitionUpperBound,
  pruneSyncRuns,
  runMaintenance,
  safeError,
} from '../src/maintenance/run-maintenance.js';
import { Metrics } from '../src/observability/metrics.js';
import type { ScheduledJob } from '../src/scheduler/scheduler.js';
import type { SchedulerService } from '../src/scheduler/scheduler.service.js';

const DAY = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const compact = (d: Date): string => iso(d).replaceAll('-', '');
const daysFrom = (base: Date, n: number): Date => new Date(base.getTime() + n * DAY);
const monthStart = (d: Date, plus = 0): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + plus, 1));
const ym = (d: Date): string => iso(d).slice(0, 7).replace('-', '');

describe('maintenance schedule helpers', () => {
  it('backs off 15, 30, 60, then 120 minutes after failed runs in a row', () => {
    const min = 60_000;
    expect([1, 2, 3, 4, 5, 10].map(maintenanceRetryDelay)).toEqual([
      15 * min,
      30 * min,
      60 * min,
      120 * min,
      120 * min,
      120 * min,
    ]);
  });

  it('escalates after repeated failures and backs off between them', async () => {
    let registered: ScheduledJob | undefined;
    const scheduler = {
      register: (j: ScheduledJob) => void (registered = j),
    } as unknown as SchedulerService;
    const counted: string[] = [];
    const metrics: Metrics = { increment: (_n, a) => void counted.push(String(a?.['code'])) };
    // A database that cannot be used: every run throws before it does anything.
    const job = new MaintenanceJob({} as Database, metrics, scheduler);
    job.onModuleInit();
    for (let n = 1; n <= MAINTENANCE_ESCALATE_AFTER; n++) {
      await expect(job.run()).rejects.toThrow();
      const daily = msUntilNextDubaiHour(new Date(), 2);
      expect(await registered!.intervalMs()).toBe(Math.min(daily, maintenanceRetryDelay(n)));
      const exhausted = counted.filter((c) => c === 'maintenance_retry_exhausted').length;
      expect(exhausted).toBe(n >= MAINTENANCE_ESCALATE_AFTER ? 1 : 0);
    }
  });

  describe('clampRetention', () => {
    const run = (configured: unknown) => {
      const details = { clamped: [] } as unknown as Parameters<typeof clampRetention>[2];
      const used = clampRetention('retention.packet_days', configured, details);
      return { used, clamp: details.clamped[0] };
    };
    it('keeps a whole value inside the limits and reports nothing', () => {
      expect(run(90)).toEqual({ used: 90, clamp: undefined });
    });
    it('raises a value below the minimum', () => {
      expect(run(0)).toMatchObject({ used: 7, clamp: { reason: 'below_minimum', used: 7 } });
    });
    it('rounds a fractional value above the minimum up and says so', () => {
      expect(run(90.5)).toMatchObject({ used: 91, clamp: { reason: 'rounded', used: 91 } });
    });
    it('caps a huge value (a mistyped 999999999 must not break partition creation)', () => {
      for (const v of [1e9, 999_999_999, Number.MAX_SAFE_INTEGER]) {
        expect(run(v)).toMatchObject({
          used: RETENTION_MAX_DAYS,
          clamp: { reason: 'above_maximum', used: RETENTION_MAX_DAYS },
        });
      }
    });
    it('uses the fallback for a value that is not a finite number', () => {
      for (const v of ['90', null, undefined, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(run(v).clamp).toMatchObject({ reason: 'invalid' });
      }
    });
  });

  it('waits until the next 02:00 in Asia/Dubai (UTC+4)', () => {
    expect(msUntilNextDubaiHour(new Date('2026-10-20T21:59:00Z'), 2)).toBe(60_000);
    expect(msUntilNextDubaiHour(new Date('2026-10-20T22:00:00Z'), 2)).toBe(DAY);
    expect(msUntilNextDubaiHour(new Date('2026-10-20T22:00:01.500Z'), 2)).toBe(DAY - 1_500);
    expect(msUntilNextDubaiHour(new Date('2026-10-20T10:00:00Z'), 2)).toBe(12 * 3_600_000);
  });

  it('reads the upper bound of a partition from its name', () => {
    expect(partitionUpperBound('packet_p20261231')).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(partitionUpperBound('rollup_5m_p202612')).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(partitionUpperBound('packet_default')).toBeUndefined();
  });

  it('names tomorrow and next month', () => {
    const packet = PARTITIONED_TABLES.find((t) => t.table === 'telemetry.packet')!;
    const audit = PARTITIONED_TABLES.find((t) => t.table === 'audit.log')!;
    const at = new Date('2026-12-31T23:30:00Z');
    expect(nextPartitionName(packet, at)).toBe('packet_p20270101');
    expect(nextPartitionName(audit, at)).toBe('log_p202701');
  });
});

/**
 * S3-08 acceptance on a real PostgreSQL, writing as the nexus_worker role so the grants (EXECUTE on
 * the SECURITY DEFINER partition functions, DELETE on integration.sync_run only) are tested too.
 * Partitions are created by the migrations around the REAL current date. The database refuses to
 * drop "in the future" (core.drop_partitions_before), so the clock-forward case uses retentions
 * long enough that the cutoff is still in the past.
 */
describe.skipIf(testDatabaseAdminUrl === undefined)(
  'partition maintenance on PostgreSQL',
  { timeout: 120_000 },
  () => {
    let testDb: TestDatabase;
    let admin: pg.Client;
    let db: Database;
    let defaults: Map<string, unknown>;

    const setSetting = (key: string, value: unknown) =>
      admin.query('UPDATE core.setting SET value = $2::jsonb WHERE key = $1', [
        key,
        JSON.stringify(value),
      ]);
    const exists = async (schema: string, name: string): Promise<boolean> =>
      (await admin.query('SELECT to_regclass($1) AS r', [`${schema}.${name}`])).rows[0].r !== null;
    const makePartition = (table: string, step: 'day' | 'month', from: Date) =>
      admin.query('SELECT core.create_range_partitions($1, $2, $3::date, 1)', [
        table,
        step,
        iso(from),
      ]);

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
      const rows = await admin.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM core.setting WHERE key LIKE 'retention.%' OR key = 'catalogue.retire_after_misses'`,
      );
      defaults = new Map(rows.rows.map((r) => [r.key, r.value]));
    }, 60_000);

    afterAll(async () => {
      await db?.destroy();
      await admin?.end();
      await testDb?.drop();
    }, 60_000);

    beforeEach(async () => {
      for (const [key, value] of defaults) await setSetting(key, value);
      await admin.query('TRUNCATE integration.sync_run');
    });

    it('has the new retention.sync_run_days setting from the migration', () => {
      expect(defaults.get('retention.sync_run_days')).toBe(90);
    });

    it('40 days later: every partitioned table accepts inserts, expired partitions are gone, nothing warns', async () => {
      const real = new Date();
      const fake = daysFrom(real, 40);
      // Old partitions that the retention must remove (api_call: 45 days; packet 90; rollup_5m 60).
      await setSetting('retention.api_call_days', 45);
      const oldPacket = daysFrom(real, -60);
      const oldApiCall = daysFrom(real, -60);
      const oldRollup = monthStart(real, -5);
      await makePartition('telemetry.packet', 'day', oldPacket);
      await makePartition('integration.api_call', 'day', oldApiCall);
      await makePartition('telemetry.rollup_5m', 'month', oldRollup);
      // Protected tables: an old but not expired partition (600 days, inside the 730-day floor).
      const oldAudit = daysFrom(real, -600);
      await makePartition('audit.log', 'month', oldAudit);
      await makePartition('events.event', 'month', oldAudit);
      await makePartition('events.event_read', 'month', oldAudit);

      const { details } = await runMaintenance({ db, now: () => fake });

      expect(details.warnings).toEqual([]);
      expect(details.clamped).toEqual([]);
      const droppedNames = details.dropped.flatMap((d) => d.partitions);
      expect(droppedNames).toEqual(
        expect.arrayContaining([
          `telemetry.packet_p${compact(oldPacket)}`,
          `integration.api_call_p${compact(oldApiCall)}`,
          `telemetry.rollup_5m_p${ym(oldRollup)}`,
        ]),
      );
      expect(await exists('telemetry', `packet_p${compact(oldPacket)}`)).toBe(false);
      expect(await exists('integration', `api_call_p${compact(oldApiCall)}`)).toBe(false);
      expect(await exists('telemetry', `rollup_5m_p${ym(oldRollup)}`)).toBe(false);
      // The 730-day floor: 600-day-old audit and event partitions are never dropped.
      expect(await exists('audit', `log_p${ym(oldAudit)}`)).toBe(true);
      expect(await exists('events', `event_p${ym(oldAudit)}`)).toBe(true);
      expect(await exists('events', `event_read_p${ym(oldAudit)}`)).toBe(true);
      expect(droppedNames.some((n) => /audit\.|events\./.test(n))).toBe(false);

      // Inserts: 7 days ahead for daily tables, two months ahead for monthly ones.
      const day = `${iso(daysFrom(fake, 7))}T12:00:00Z`;
      const month = `${iso(monthStart(fake, 2))}T12:00:00Z`;
      const asset = '00000000-0000-0000-0000-0000000000a1';
      const user = (
        await admin.query(
          `INSERT INTO access.app_user (entra_oid, tenant_id) VALUES (gen_random_uuid(), gen_random_uuid()) RETURNING id`,
        )
      ).rows[0].id as string;
      const inserts: [string, string, unknown[]][] = [
        [
          'telemetry.packet',
          `INSERT INTO telemetry.packet (asset_id, ts, values) VALUES ($1, $2, '{}')`,
          [asset, day],
        ],
        [
          'integration.api_call',
          `INSERT INTO integration.api_call (at, source_system, endpoint) VALUES ($1, 'datoms', 'x')`,
          [day],
        ],
        [
          'telemetry.rollup_5m',
          `INSERT INTO telemetry.rollup_5m (asset_id, bucket, stats, packets) VALUES ($1, $2, '{}', 1)`,
          [asset, month],
        ],
        [
          'telemetry.rollup_1h',
          `INSERT INTO telemetry.rollup_1h (asset_id, bucket, stats, packets) VALUES ($1, $2, '{}', 1)`,
          [asset, month],
        ],
        [
          'telemetry.asset_status_history',
          `INSERT INTO telemetry.asset_status_history (asset_id, started_at, source_value) VALUES ($1, $2, 's')`,
          [asset, month],
        ],
        [
          'telemetry.asset_location_history',
          `INSERT INTO telemetry.asset_location_history (asset_id, observed_at, latitude, longitude) VALUES ($1, $2, 25, 55)`,
          [asset, month],
        ],
        [
          'events.event',
          `INSERT INTO events.event (occurred_at, source_system, external_id, title) VALUES ($1, 'datoms', 'e1', 't')`,
          [month],
        ],
        [
          'events.event_read',
          `INSERT INTO events.event_read (user_id, event_id, occurred_at) VALUES ($1, gen_random_uuid(), $2)`,
          [user, month],
        ],
        [
          'audit.log',
          `INSERT INTO audit.log (at, action) VALUES ($1, 'test.maintenance')`,
          [month],
        ],
      ];
      expect(inserts.map((i) => i[0]).sort()).toEqual(
        PARTITIONED_TABLES.map((t) => t.table).sort(),
      );
      for (const [table, statement, params] of inserts) {
        await expect(admin.query(statement, params), table).resolves.toBeDefined();
      }
      // The drops are on the audit trail (written inside the SECURITY DEFINER function).
      const audited = await admin.query(
        `SELECT count(*)::int AS n FROM audit.log WHERE action = 'maintenance.partition_dropped'`,
      );
      expect(audited.rows[0].n).toBeGreaterThanOrEqual(3);
    });

    it('is idempotent: a second run creates and drops nothing', async () => {
      await runMaintenance({ db });
      const { details } = await runMaintenance({ db });
      expect(details.created).toEqual([]);
      expect(details.dropped).toEqual([]);
      expect(details.warnings).toEqual([]);
    });

    it('clamps unsafe retention (0, negative, text) and reports it', async () => {
      const real = new Date();
      await setSetting('retention.packet_days', 0);
      await setSetting('retention.api_call_days', -5);
      await setSetting('retention.rollup_5m_days', 'abc');
      await setSetting('retention.audit_days', 1);
      await setSetting('retention.event_days', 0);
      await makePartition('telemetry.packet', 'day', daysFrom(real, -8)); // older than 7 days: expires
      await makePartition('telemetry.packet', 'day', daysFrom(real, -5)); // inside the 7-day minimum: stays
      await makePartition('integration.api_call', 'day', daysFrom(real, -40)); // fallback 30: expires

      const logged: string[] = [];
      const { details } = await runMaintenance({
        db,
        onClamp: (c) => logged.push(c.setting),
      });

      const by = Object.fromEntries(details.clamped.map((c) => [c.setting, c]));
      expect(by['retention.packet_days']).toMatchObject({ used: 7, reason: 'below_minimum' });
      expect(by['retention.api_call_days']).toMatchObject({ used: 30, reason: 'below_minimum' });
      expect(by['retention.rollup_5m_days']).toMatchObject({ used: 60, reason: 'invalid' });
      expect(by['retention.audit_days']).toMatchObject({ used: 730 });
      expect(by['retention.event_days']).toMatchObject({ used: 730 });
      expect(logged.sort()).toEqual(details.clamped.map((c) => c.setting).sort());

      expect(await exists('telemetry', `packet_p${compact(daysFrom(real, -8))}`)).toBe(false);
      expect(await exists('telemetry', `packet_p${compact(daysFrom(real, -5))}`)).toBe(true);
      expect(await exists('integration', `api_call_p${compact(daysFrom(real, -40))}`)).toBe(false);
      // A table with live data is never emptied: today's partitions are all still there.
      expect(await exists('telemetry', `packet_p${compact(real)}`)).toBe(true);
      expect(details.warnings).toEqual([]);
    });

    it('a huge retention value (1e9 days) is capped and partition creation still works', async () => {
      const real = new Date();
      await setSetting('retention.packet_days', 1e9);
      await setSetting('retention.api_call_days', 999_999_999);
      const { details } = await runMaintenance({ db });
      const by = Object.fromEntries(details.clamped.map((c) => [c.setting, c]));
      expect(by['retention.packet_days']).toMatchObject({
        used: RETENTION_MAX_DAYS,
        reason: 'above_maximum',
      });
      expect(by['retention.api_call_days']).toMatchObject({
        used: RETENTION_MAX_DAYS,
        reason: 'above_maximum',
      });
      expect(details.warnings).toEqual([]);
      expect(await exists('telemetry', `packet_p${compact(daysFrom(real, 7))}`)).toBe(true);
      expect(await exists('integration', `api_call_p${compact(daysFrom(real, 7))}`)).toBe(true);
    });

    it("warns when tomorrow's partition is missing after the run, and the job records and counts it", async () => {
      const real = new Date();
      const tomorrow = compact(daysFrom(real, 1));
      // Make creation impossible: a differently named partition already covers tomorrow.
      await admin.query(`ALTER TABLE telemetry.packet_p${tomorrow} RENAME TO packet_renamed`);

      const counted: [string, Record<string, string | number> | undefined][] = [];
      const metrics: Metrics = { increment: (n, a) => void counted.push([n, a]) };
      const scheduler = { register() {} } as unknown as SchedulerService;
      const job = new MaintenanceJob(db, metrics, scheduler);

      const details = await job.run();

      expect(details.warnings).toEqual(
        expect.arrayContaining([
          {
            code: 'partition_missing',
            table: 'telemetry.packet',
            partition: `packet_p${tomorrow}`,
          },
          expect.objectContaining({
            code: 'step_failed',
            step: 'create',
            table: 'telemetry.packet',
          }),
        ]),
      );
      expect(counted).toContainEqual([
        SYNC_WARNING_METRIC,
        { code: 'partition_missing', job: 'maintenance' },
      ]);
      // The other tables were still maintained, and the run is recorded as partial.
      const row = (
        await admin.query(
          `SELECT status, details FROM integration.sync_run WHERE job = 'maintenance'`,
        )
      ).rows[0];
      expect(row.status).toBe('partial');
      const parsed = syncRunDetailsSchema.parse(row.details);
      expect(parsed.job).toBe('maintenance');
      expect(await listPartitions(db, 'integration.api_call')).toContain(`api_call_p${tomorrow}`);

      // Put it back so the missing-partition state does not leak into later tests.
      await admin.query(`ALTER TABLE telemetry.packet_renamed RENAME TO packet_p${tomorrow}`);
    });

    it('keeps at least 30 days of api_call: a setting of 7 is raised to 30 (budget restore reads 30 days)', async () => {
      await setSetting('retention.api_call_days', 7);
      const { details } = await runMaintenance({ db });
      expect(RETENTION_LIMITS['retention.api_call_days'].min).toBe(BUDGET_RESTORE_DAYS);
      expect(details.clamped).toContainEqual({
        setting: 'retention.api_call_days',
        configured: 7,
        used: 30,
        reason: 'below_minimum',
      });
    });

    it('a clamp is counted in the metric but the run stays ok', async () => {
      await setSetting('retention.packet_days', 0);
      const counted: [string, Record<string, string | number> | undefined][] = [];
      const metrics: Metrics = { increment: (n, a) => void counted.push([n, a]) };
      const job = new MaintenanceJob(db, metrics, { register() {} } as unknown as SchedulerService);
      await job.run();
      expect(counted).toContainEqual([
        SYNC_WARNING_METRIC,
        { code: 'retention_clamped', job: 'maintenance' },
      ]);
      const row = (
        await admin.query(`SELECT status FROM integration.sync_run WHERE job = 'maintenance'`)
      ).rows[0];
      expect(row.status).toBe('ok');
    });

    it('takes now from the database when no clock is given', async () => {
      const before = Date.now();
      const { startedAt, finishedAt } = await runMaintenance({ db });
      expect(Math.abs(startedAt.getTime() - before)).toBeLessThan(60_000);
      expect(finishedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    });

    it('fills a long gap: after 80 days without a run every daily partition up to +7 days exists', async () => {
      const real = new Date();
      const fake = daysFrom(real, 80);
      // Earlier tests created partitions up to about +47 days; the retention must reach the cutoff
      // into the past (the database refuses a drop date in the future).
      await setSetting('retention.packet_days', 100);
      await setSetting('retention.api_call_days', 100);
      await setSetting('retention.rollup_5m_days', 100);
      const { details } = await runMaintenance({ db, now: () => fake });
      expect(details.warnings).toEqual([]);
      // The initial partitions end at real+8; everything from there to fake+7 is created.
      for (let d = 8; d <= 87; d++) {
        expect(await exists('telemetry', `packet_p${compact(daysFrom(real, d))}`), `+${d}`).toBe(
          true,
        );
        expect(await exists('integration', `api_call_p${compact(daysFrom(real, d))}`)).toBe(true);
      }
      expect(details.created).toContainEqual(
        expect.objectContaining({ table: 'telemetry.packet' }),
      );
    });

    describe('lock timeout', () => {
      let locker: pg.Client;
      beforeEach(async () => {
        locker = new pg.Client({ connectionString: testDb.adminUrl });
        await locker.connect();
      });
      afterEach(async () => {
        await locker.query('ROLLBACK').catch(() => undefined);
        await locker.end();
      });

      it('gives up fast when a long query holds the table, records step_failed, and asks for a retry in 15 minutes', async () => {
        // 160 days ahead: new monthly and daily partitions are needed; retentions reach the cutoff back.
        await setSetting('retention.packet_days', 200);
        await setSetting('retention.api_call_days', 200);
        await setSetting('retention.rollup_5m_days', 200);
        const fake = daysFrom(new Date(), 160);
        await locker.query('BEGIN');
        await locker.query('LOCK TABLE telemetry.rollup_5m IN ACCESS EXCLUSIVE MODE');

        let registered: ScheduledJob | undefined;
        const scheduler = {
          register: (j: ScheduledJob) => void (registered = j),
        } as unknown as SchedulerService;
        const counted: string[] = [];
        const metrics: Metrics = { increment: (_n, a) => void counted.push(String(a?.['code'])) };
        const job = new MaintenanceJob(db, metrics, scheduler);
        job.onModuleInit();

        const started = Date.now();
        const details = await job.run(() => fake);
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(20_000);
        expect(details.warnings).toContainEqual(
          expect.objectContaining({
            code: 'step_failed',
            step: 'create',
            table: 'telemetry.rollup_5m',
            message: expect.stringContaining('55P03'),
          }),
        );
        // Other tables were still created.
        expect(details.created.length).toBeGreaterThan(0);
        expect(counted).toContain('partition_missing');
        const wait = await registered!.intervalMs();
        expect(wait).toBeLessThanOrEqual(MAINTENANCE_RETRY_MS);
        expect(needsEarlyRetry(details)).toBe(true);

        // Once the lock is gone the next run succeeds and goes back to the daily schedule.
        await locker.query('ROLLBACK');
        const again = await job.run(() => fake);
        // (Drops of the 600-day-old test partitions are refused by the database floor at this
        // far-future clock; that is unrelated to creation.)
        expect(again.warnings.filter((w) => w.code !== 'step_failed' || w.step !== 'drop')).toEqual(
          [],
        );
        expect(needsEarlyRetry(again)).toBe(false);
        expect(await registered!.intervalMs()).toBeGreaterThan(MAINTENANCE_RETRY_MS);
      });
    });

    it('skips the drop and prune steps when the signal is aborted (leadership lost)', async () => {
      const real = new Date();
      const old = daysFrom(real, -60);
      await setSetting('retention.packet_days', 30);
      await makePartition('telemetry.packet', 'day', old);
      await admin.query(
        `INSERT INTO integration.sync_run (source_system, job, status, started_at)
         VALUES ('datoms', 'live_poll', 'ok', now() - interval '400 days')`,
      );
      const controller = new AbortController();
      controller.abort();
      const { details } = await runMaintenance({ db, signal: controller.signal });
      expect(details.dropped).toEqual([]);
      expect(details.syncRunsPruned).toBe(0);
      expect(details.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ step: 'drop', message: 'aborted: leadership lost' }),
          expect.objectContaining({ step: 'prune_sync_run' }),
        ]),
      );
      expect(await exists('telemetry', `packet_p${compact(old)}`)).toBe(true);
      // Next run without the signal does the work.
      const next = await runMaintenance({ db });
      expect(next.details.dropped.flatMap((d) => d.partitions)).toContain(
        `telemetry.packet_p${compact(old)}`,
      );
    });

    it('deletes sync_run in batches', async () => {
      for (let i = 0; i < 7; i++) {
        await admin.query(
          `INSERT INTO integration.sync_run (source_system, job, status, started_at)
           VALUES ('datoms', 'live_poll', 'ok', now() - interval '400 days')`,
        );
      }
      const n = await pruneSyncRuns(db, new Date(), 2, { batchSize: 2 });
      expect(n).toBe(7);
    });

    describe('safeError', () => {
      it('keeps the name and SQLSTATE, never the database message', () => {
        const e = Object.assign(new Error('relation "secret_table" value=42'), {
          name: 'error',
          code: '55P03',
        });
        expect(safeError(e)).toBe('error 55P03: lock timeout (a long query holds the table)');
        expect(safeError(Object.assign(new Error('x'), { code: '99999' }))).toBe('Error 99999');
      });

      it('redacts and caps a message without a code', () => {
        const long = safeError(
          new Error(`connect failed postgres://u:pw@h/db token=abc ${'x'.repeat(500)}`),
        );
        expect(long).not.toContain('pw@h');
        expect(long).not.toContain('abc');
        expect(long.length).toBeLessThanOrEqual(200);
        expect(safeError('nope')).toBe('unknown error');
      });

      it('keeps only the code for Node network errors (no host or IP)', () => {
        const e = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), {
          code: 'ECONNREFUSED',
        });
        expect(safeError(e)).toBe('Error ECONNREFUSED');
        const dns = Object.assign(new Error('getaddrinfo ENOTFOUND db.internal.example'), {
          code: 'ENOTFOUND',
        });
        expect(safeError(dns)).toBe('Error ENOTFOUND');
      });

      it('redacts quoted key/value secrets', () => {
        const out = safeError(new Error('bad config {"password":"hunter2","token": \'abc123\'}'));
        expect(out).not.toContain('hunter2');
        expect(out).not.toContain('abc123');
      });
    });

    describe('sync_run pruning', () => {
      const insertRun = (
        job: string,
        status: string,
        ageDays: number,
        complete: boolean | null,
        source = 'datoms',
      ) =>
        admin.query(
          `INSERT INTO integration.sync_run (source_system, job, status, started_at, details)
           VALUES ($1, $2, $3, now() - ($4 || ' days')::interval, $5::jsonb)`,
          [
            source,
            job,
            status,
            String(ageDays),
            complete === null ? null : JSON.stringify({ job, complete }),
          ],
        );
      const left = async (): Promise<{ job: string; age: number }[]> =>
        (
          await admin.query(
            `SELECT job, round(extract(epoch FROM now() - started_at) / 86400)::int AS age
             FROM integration.sync_run WHERE job <> 'maintenance' ORDER BY started_at`,
          )
        ).rows;

      it('deletes old history but keeps the newest retire_after_misses complete catalogue runs', async () => {
        await setSetting('retention.sync_run_days', 0); // clamped to 7
        await setSetting('catalogue.retire_after_misses', 3);
        // Five complete runs, 200 to 160 days old; an incomplete one and other jobs, old and recent.
        for (const age of [200, 190, 180, 170, 160])
          await insertRun('catalogue_sync', 'ok', age, true);
        await insertRun('catalogue_sync', 'partial', 165, false);
        await insertRun('catalogue_sync', 'failed', 164, null);
        await insertRun('live_poll', 'ok', 100, null);
        await insertRun('catalogue_sync', 'ok', 1, true); // recent: kept by age

        const { details } = await runMaintenance({ db });

        expect(details.clamped).toContainEqual(
          expect.objectContaining({ setting: 'retention.sync_run_days', used: 7 }),
        );
        // Newest 3 complete runs by started_at: ages 1, 160, 170. Everything else old is deleted.
        expect(details.syncRunsPruned).toBe(6);
        expect(await left()).toEqual([
          { job: 'catalogue_sync', age: 170 },
          { job: 'catalogue_sync', age: 160 },
          { job: 'catalogue_sync', age: 1 },
        ]);
      });

      it('keeps exactly N complete runs when several share the same start time (batched)', async () => {
        for (let i = 0; i < 3; i++) {
          await admin.query(
            `INSERT INTO integration.sync_run (source_system, job, status, started_at, details)
             VALUES ('datoms', 'catalogue_sync', 'ok', timestamptz '2025-01-01T00:00:00Z', $1::jsonb)`,
            [JSON.stringify({ job: 'catalogue_sync', complete: true })],
          );
        }
        await pruneSyncRuns(db, new Date(), 2, { batchSize: 1 });
        const n = (
          await admin.query(
            `SELECT count(*)::int AS n FROM integration.sync_run WHERE job = 'catalogue_sync'`,
          )
        ).rows[0].n;
        expect(n).toBe(2);
      });

      it('keeps fewer than N complete runs when that is all there is', async () => {
        await setSetting('catalogue.retire_after_misses', 2);
        await insertRun('catalogue_sync', 'ok', 300, true);
        await insertRun('live_poll', 'ok', 300, null);
        await runMaintenance({ db });
        expect(await left()).toEqual([{ job: 'catalogue_sync', age: 300 }]);
      });

      it('keeps the baseline for the safe-retire rule per source system', async () => {
        await setSetting('catalogue.retire_after_misses', 2);
        for (const age of [300, 290, 280]) {
          await insertRun('catalogue_sync', 'ok', age, true, 'datoms');
          await insertRun('catalogue_sync', 'ok', age, true, 'other');
        }
        await runMaintenance({ db });
        const rows = (
          await admin.query(
            `SELECT source_system, count(*)::int AS n FROM integration.sync_run
             WHERE job = 'catalogue_sync' GROUP BY 1 ORDER BY 1`,
          )
        ).rows;
        expect(rows).toEqual([
          { source_system: 'datoms', n: 2 },
          { source_system: 'other', n: 2 },
        ]);
      });
    });
  },
);
