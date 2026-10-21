import type { Database } from '@nexus/db';
import type { MaintenanceDetails, MaintenanceWarning } from '@nexus/shared';
import { sql } from 'kysely';

/**
 * Partition maintenance (S3-08, docs/07 section 5, docs/06 section 4). Plain functions over the
 * Kysely handle with an injectable clock, so the whole run can be tested against Postgres.
 *
 * Partitions are created and dropped only through the SECURITY DEFINER functions
 * `core.create_range_partitions` / `core.drop_partitions_before` (docs/06 decision 14). The database
 * enforces the 730-day floor of audit.log, events.event and events.event_read; the clamps below keep
 * the settings inside safe limits so the job never even asks for less.
 */

export interface PartitionedTable {
  /** schema.table */
  table: string;
  step: 'day' | 'month';
  /** The `core.setting` key holding the retention in days. */
  retention: RetentionKey;
}

export type RetentionKey =
  | 'retention.packet_days'
  | 'retention.rollup_5m_days'
  | 'retention.rollup_1h_days'
  | 'retention.api_call_days'
  | 'retention.audit_days'
  | 'retention.event_days'
  | 'retention.status_history_days'
  | 'retention.location_history_days'
  | 'retention.sync_run_days';

/** Every partitioned table in db/schema.sql, with its interval (docs/06 decision 6). */
export const PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { table: 'telemetry.packet', step: 'day', retention: 'retention.packet_days' },
  { table: 'integration.api_call', step: 'day', retention: 'retention.api_call_days' },
  { table: 'telemetry.rollup_5m', step: 'month', retention: 'retention.rollup_5m_days' },
  { table: 'telemetry.rollup_1h', step: 'month', retention: 'retention.rollup_1h_days' },
  {
    table: 'telemetry.asset_status_history',
    step: 'month',
    retention: 'retention.status_history_days',
  },
  {
    table: 'telemetry.asset_location_history',
    step: 'month',
    retention: 'retention.location_history_days',
  },
  { table: 'events.event', step: 'month', retention: 'retention.event_days' },
  // Per-user read state; the worker cannot read it, the SECURITY DEFINER functions can.
  { table: 'events.event_read', step: 'month', retention: 'retention.event_days' },
  { table: 'audit.log', step: 'month', retention: 'retention.audit_days' },
];

/**
 * Safe minimum (days) and the value used when the setting is missing or not a number. A setting
 * below its minimum is raised to it and reported in `details.clamped`; an admin typing 0 must never
 * empty a table (security review N7). Audit and events: the database floor is 730 days.
 */
export const RETENTION_LIMITS: Record<RetentionKey, { min: number; fallback: number }> = {
  'retention.packet_days': { min: 7, fallback: 90 },
  'retention.rollup_5m_days': { min: 7, fallback: 60 },
  'retention.rollup_1h_days': { min: 90, fallback: 1830 },
  'retention.api_call_days': { min: 7, fallback: 30 },
  'retention.audit_days': { min: 730, fallback: 730 },
  'retention.event_days': { min: 730, fallback: 730 },
  'retention.status_history_days': { min: 30, fallback: 730 },
  'retention.location_history_days': { min: 30, fallback: 400 },
  'retention.sync_run_days': { min: 7, fallback: 90 },
};

/** Daily tables are created from yesterday to 7 days ahead; monthly ones for this and the next 2 months. */
export const DAILY_DAYS_BEHIND = 1;
export const DAILY_DAYS_AHEAD = 7;
export const MONTHLY_MONTHS_COUNT = 3;
const DAY_MS = 86_400_000;
/** Used only when `catalogue.retire_after_misses` cannot be read. Equals the seeded default. */
const FALLBACK_RETIRE_AFTER_MISSES = 2;

export interface MaintenanceOptions {
  db: Database;
  now?: () => Date;
  onWarning?: (warning: MaintenanceWarning) => void;
  onClamp?: (clamp: MaintenanceDetails['clamped'][number]) => void;
}

export interface MaintenanceResult {
  details: MaintenanceDetails;
  startedAt: Date;
  finishedAt: Date;
}

export async function runMaintenance(options: MaintenanceOptions): Promise<MaintenanceResult> {
  const { db } = options;
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();
  const now = startedAt;
  const details: MaintenanceDetails = {
    job: 'maintenance',
    created: [],
    dropped: [],
    clamped: [],
    syncRunsPruned: 0,
    warnings: [],
  };
  const warn = (w: MaintenanceWarning): void => {
    details.warnings.push(w);
    options.onWarning?.(w);
  };

  // 1. Create ahead. Always first: a missing partition stops inserts, an old one only wastes disk.
  for (const t of PARTITIONED_TABLES) {
    try {
      const made = await createAhead(db, t, now);
      if (made > 0) details.created.push({ table: t.table, count: made });
    } catch (error) {
      warn({ code: 'step_failed', step: 'create', table: t.table, message: describe(error) });
    }
  }

  // 2. Drop expired, with clamped retention. If the settings cannot be read, nothing is dropped.
  let settings: Map<string, unknown> | undefined;
  try {
    settings = await readSettings(db);
  } catch (error) {
    warn({ code: 'step_failed', step: 'settings', message: describe(error) });
  }
  if (settings) {
    const days = new Map<RetentionKey, number>();
    for (const key of Object.keys(RETENTION_LIMITS) as RetentionKey[]) {
      days.set(key, clampRetention(key, settings.get(key), details, options.onClamp));
    }
    for (const t of PARTITIONED_TABLES) {
      try {
        const cutoff = new Date(now.getTime() - days.get(t.retention)! * DAY_MS);
        const dropped = await dropExpired(db, t, cutoff);
        if (dropped.length > 0) details.dropped.push({ table: t.table, partitions: dropped });
      } catch (error) {
        warn({ code: 'step_failed', step: 'drop', table: t.table, message: describe(error) });
      }
    }
    try {
      const keep =
        positiveInt(settings.get('catalogue.retire_after_misses')) ?? FALLBACK_RETIRE_AFTER_MISSES;
      const cutoff = new Date(now.getTime() - days.get('retention.sync_run_days')! * DAY_MS);
      details.syncRunsPruned = await pruneSyncRuns(db, cutoff, keep);
    } catch (error) {
      warn({ code: 'step_failed', step: 'prune_sync_run', message: describe(error) });
    }
  }

  // 3. Health: tomorrow's daily and next month's monthly partition must exist now (security review L8).
  try {
    for (const t of PARTITIONED_TABLES) {
      const expected = nextPartitionName(t, now);
      const existing = await listPartitions(db, t.table);
      if (!existing.includes(expected)) {
        warn({ code: 'partition_missing', table: t.table, partition: expected });
      }
    }
  } catch (error) {
    warn({ code: 'step_failed', step: 'create', message: `health check: ${describe(error)}` });
  }

  return { details, startedAt, finishedAt: clock() };
}

/** Records the run in integration.sync_run (the maintenance job is not tied to one source). */
export async function writeMaintenanceRun(
  db: Database,
  result: MaintenanceResult,
  sourceSystem = 'nexus',
): Promise<void> {
  const { details } = result;
  await db
    .insertInto('integration.sync_run')
    .values({
      source_system: sourceSystem,
      job: 'maintenance',
      started_at: result.startedAt,
      finished_at: result.finishedAt,
      status: details.warnings.length > 0 ? 'partial' : 'ok',
      items_read: 0,
      items_written: details.created.reduce((n, c) => n + c.count, 0),
      details: JSON.stringify(details),
    })
    .execute();
}

// ---------------------------------------------------------------------------------------------

export function clampRetention(
  key: RetentionKey,
  configured: unknown,
  details: MaintenanceDetails,
  onClamp?: MaintenanceOptions['onClamp'],
): number {
  const { min, fallback } = RETENTION_LIMITS[key];
  const valid = typeof configured === 'number' && Number.isFinite(configured);
  const used = valid ? Math.max(min, Math.ceil(configured)) : Math.max(min, fallback);
  if (!valid || used !== configured) {
    const clamp = {
      setting: key,
      configured: configured ?? null,
      used,
      reason: valid ? ('below_minimum' as const) : ('invalid' as const),
    };
    details.clamped.push(clamp);
    onClamp?.(clamp);
  }
  return used;
}

async function readSettings(db: Database): Promise<Map<string, unknown>> {
  const keys = [...Object.keys(RETENTION_LIMITS), 'catalogue.retire_after_misses'];
  const rows = await db
    .selectFrom('core.setting')
    .select(['key', 'value'])
    .where('key', 'in', keys)
    .execute();
  return new Map(rows.map((r) => [r.key, r.value as unknown]));
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;
}

async function createAhead(db: Database, t: PartitionedTable, now: Date): Promise<number> {
  const today = utcDate(now);
  const [from, count] =
    t.step === 'day'
      ? [addDays(today, -DAILY_DAYS_BEHIND), DAILY_DAYS_BEHIND + 1 + DAILY_DAYS_AHEAD]
      : [`${today.slice(0, 7)}-01`, MONTHLY_MONTHS_COUNT];
  const res = await sql<{ made: number }>`
    SELECT core.create_range_partitions(${t.table}, ${t.step}, ${from}::date, ${count}::int) AS made
  `.execute(db);
  return Number(res.rows[0]?.made ?? 0);
}

async function dropExpired(db: Database, t: PartitionedTable, cutoff: Date): Promise<string[]> {
  const expired = (await listPartitions(db, t.table)).filter((name) => {
    const upper = partitionUpperBound(name);
    return upper !== undefined && upper.getTime() <= cutoff.getTime();
  });
  if (expired.length === 0) return [];
  const res = await sql<{ dropped: string }>`
    SELECT core.drop_partitions_before(${t.table}, ${cutoff.toISOString()}::timestamptz) AS dropped
  `.execute(db);
  return res.rows.map((r) => r.dropped);
}

/**
 * Deletes old run history. Always keeps, per source system, the newest `keep` complete catalogue
 * runs (the same rows `loadRetireBaseline` reads), however old: without them a safe retirement
 * could never fire (docs/07 section 6).
 */
export async function pruneSyncRuns(db: Database, cutoff: Date, keep: number): Promise<number> {
  const res = await sql`
    DELETE FROM integration.sync_run
    WHERE started_at < ${cutoff.toISOString()}::timestamptz
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY source_system ORDER BY started_at DESC) AS rn
          FROM integration.sync_run
          WHERE job = 'catalogue_sync' AND status IN ('ok', 'partial') AND details->>'complete' = 'true'
        ) newest
        WHERE rn <= ${keep}
      )
  `.execute(db);
  return Number(res.numAffectedRows ?? 0);
}

/**
 * Partition names (without schema) of a partitioned table. Reads the catalog by name, not through a
 * regclass cast: the worker has no USAGE on schema `audit`, and a cast would fail there.
 */
export async function listPartitions(db: Database, table: string): Promise<string[]> {
  const [schema, name] = table.split('.') as [string, string];
  const res = await sql<{ name: string }>`
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = ${schema} AND p.relname = ${name}
    ORDER BY c.relname
  `.execute(db);
  return res.rows.map((r) => r.name);
}

/** Name of tomorrow's (daily) or next month's (monthly) partition, UTC like the bounds. */
export function nextPartitionName(t: PartitionedTable, now: Date): string {
  const base = t.table.split('.')[1]!;
  const today = utcDate(now);
  if (t.step === 'day') return `${base}_p${addDays(today, 1).replaceAll('-', '')}`;
  const [y, m] = today.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)); // month index m is next month (m is 1-based)
  return `${base}_p${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Upper bound of a partition from its name (`..._pYYYYMMDD` or `..._pYYYYMM`), UTC. */
export function partitionUpperBound(name: string): Date | undefined {
  const day = /_p(\d{4})(\d{2})(\d{2})$/.exec(name);
  if (day) return new Date(Date.UTC(+day[1]!, +day[2]! - 1, +day[3]! + 1));
  const month = /_p(\d{4})(\d{2})$/.exec(name);
  if (month) return new Date(Date.UTC(+month[1]!, +month[2]!, 1));
  return undefined;
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return utcDate(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS));
}

/** Milliseconds from `now` to the next `hour`:00 in Asia/Dubai (always more than 0). */
export function msUntilNextDubaiHour(now: Date, hour: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnight =
    ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now.getTime() % 1000);
  let wait = hour * 3_600_000 - sinceMidnight;
  if (wait <= 0) wait += DAY_MS;
  return wait;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}
