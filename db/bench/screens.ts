import type pg from 'pg';

/**
 * The main-screen queries of docs/06 section 5, with the N-04 targets they must stay under
 * (live screens p95 < 300 ms, charts < 1 s). Every query on a partitioned table has a time filter.
 * Run by db/seeds/scale-100-sites.ts after loading the data, and reproducible on any database that
 * holds it. A query over its target blocks a merge that touches telemetry or event tables.
 */
export interface ScreenQuery {
  name: string;
  /** Targets in milliseconds (N-04). */
  targetMs: number;
  sql: string;
}

export interface BenchContext {
  userId: string;
  groupId: string;
  projectId: string;
  /** A DG Set asset that has packets, and one of its parameter keys. */
  assetId: string;
  key: string;
  /** A name fragment that exists, for the search. */
  searchText: string;
}

const LIVE = 300;
const CHART = 1000;

export function screenQueries(c: BenchContext): ScreenQuery[] {
  const q = (v: string): string => `'${v.replaceAll("'", "''")}'`;
  return [
    {
      name: 'Portfolio map: all projects + equipment counts (leadership)',
      targetMs: LIVE,
      sql: `SELECT p.id, p.name, p.state, p.latitude, p.longitude, count(a.id) AS assets
            FROM core.project p
            LEFT JOIN core.asset a ON a.project_id = p.id AND a.retired_at IS NULL AND a.kind = 'physical'
            WHERE p.retired_at IS NULL GROUP BY p.id`,
    },
    {
      name: 'Portfolio for a scoped user (20 projects)',
      targetMs: LIVE,
      sql: `SELECT p.id, p.name, p.state FROM core.project p
            WHERE p.id IN (SELECT access.user_project_ids(${q(c.userId)}::uuid, ARRAY[${q(c.groupId)}]::uuid[]))`,
    },
    {
      name: 'Project page: markers + live status (v_asset_live)',
      targetMs: LIVE,
      sql: `SELECT asset_id, name, asset_type, category, icon, status_display, status_source_value,
                   last_packet_at, latitude, longitude
            FROM core.v_asset_live WHERE project_id = ${q(c.projectId)}`,
    },
    {
      name: 'Info box 2: equipment counts by type and status',
      targetMs: LIVE,
      sql: `SELECT asset_type, status_display, assets FROM core.v_project_asset_counts WHERE project_id = ${q(c.projectId)}`,
    },
    {
      name: 'Energy box: site totals (kind = site_metric)',
      targetMs: LIVE,
      sql: `SELECT name, last_packet_at, latest_values FROM core.v_site_metric_live WHERE project_id = ${q(c.projectId)}`,
    },
    {
      name: 'Energy box: sum of one parameter over the DG Sets of a project',
      targetMs: LIVE,
      sql: `SELECT count(*) AS gens, sum((lp.values ->> ${q(c.key)})::numeric)
            FROM core.asset a
            JOIN core.asset_type t ON t.id = a.asset_type_id
            JOIN telemetry.latest_packet lp ON lp.asset_id = a.id
            WHERE a.project_id = ${q(c.projectId)} AND a.kind = 'physical' AND a.retired_at IS NULL AND t.category = 'energy'`,
    },
    {
      name: 'Asset search "contains" over all assets (trigram)',
      targetMs: LIVE,
      sql: `SELECT id, name FROM core.asset WHERE name ILIKE '%${c.searchText.replaceAll("'", "''")}%' AND kind = 'physical' LIMIT 50`,
    },
    {
      name: 'Device card: latest values with names and units (ADR 0011)',
      targetMs: LIVE,
      sql: `SELECT e.key, e.value, p.display_name, p.unit, p.data_type, lp.ts
            FROM core.asset a
            JOIN telemetry.latest_packet lp ON lp.asset_id = a.id
            CROSS JOIN LATERAL jsonb_each(lp.values) e
            LEFT JOIN telemetry.parameter p ON p.source_system = a.source_system
                  AND p.source_type_name IS NOT DISTINCT FROM a.source_type_name AND p.key = e.key
            WHERE a.id = ${q(c.assetId)} AND (p.is_hidden IS NOT TRUE)`,
    },
    {
      name: 'Trend 6 h, raw packets (1 parameter)',
      targetMs: CHART,
      sql: `SELECT ts, values -> ${q(c.key)} FROM telemetry.packet
            WHERE asset_id = ${q(c.assetId)} AND ts >= now() - interval '6 hours' AND ts < now() ORDER BY ts`,
    },
    {
      name: 'Trend 7 days, 5-minute rollups',
      targetMs: CHART,
      sql: `SELECT bucket, packets, (stats -> ${q(c.key)} ->> 'avg')::numeric FROM telemetry.rollup_5m
            WHERE asset_id = ${q(c.assetId)} AND bucket >= now() - interval '7 days' AND bucket < now() ORDER BY bucket`,
    },
    {
      name: 'Trend 90 days, hourly rollups',
      targetMs: CHART,
      sql: `SELECT bucket, packets, (stats -> ${q(c.key)} ->> 'avg')::numeric FROM telemetry.rollup_1h
            WHERE asset_id = ${q(c.assetId)} AND bucket >= now() - interval '90 days' AND bucket < now() ORDER BY bucket`,
    },
    {
      name: 'Trend 3 years, daily rollups',
      targetMs: CHART,
      sql: `SELECT bucket, packets, (stats -> ${q(c.key)} ->> 'avg')::numeric FROM telemetry.rollup_1d
            WHERE asset_id = ${q(c.assetId)} AND bucket >= now() - interval '3 years' ORDER BY bucket`,
    },
    {
      name: 'Explorer: 10 assets x 30 days hourly, min/avg/max',
      targetMs: CHART,
      sql: `SELECT asset_id, min((stats -> ${q(c.key)} ->> 'min')::numeric), avg((stats -> ${q(c.key)} ->> 'avg')::numeric),
                   max((stats -> ${q(c.key)} ->> 'max')::numeric)
            FROM telemetry.rollup_1h
            WHERE asset_id IN (SELECT asset_id FROM telemetry.latest_packet ORDER BY asset_id LIMIT 10)
              AND bucket >= now() - interval '30 days' AND bucket < now() GROUP BY asset_id`,
    },
    {
      name: 'Notifications: latest 50 for a project (90 days)',
      targetMs: LIVE,
      sql: `SELECT id, occurred_at, title, severity FROM events.event
            WHERE project_id = ${q(c.projectId)} AND occurred_at >= now() - interval '90 days'
            ORDER BY occurred_at DESC LIMIT 50`,
    },
    {
      name: 'Notifications: unread count, 20 projects, 30 days',
      targetMs: LIVE,
      sql: `SELECT count(*) FROM events.event e
            WHERE e.project_id IN (SELECT access.user_project_ids(${q(c.userId)}::uuid, ARRAY[${q(c.groupId)}]::uuid[]))
              AND e.occurred_at >= now() - interval '30 days'
              AND NOT EXISTS (SELECT 1 FROM events.event_read r WHERE r.user_id = ${q(c.userId)}::uuid
                              AND r.event_id = e.id AND r.occurred_at = e.occurred_at)`,
    },
  ];
}

export interface ScreenResult {
  name: string;
  targetMs: number;
  /** Planning + execution of the first run (page cache as the load left it). */
  firstMs: number;
  /** Median of the following warm runs. */
  warmMs: number;
  rows: number;
}

function totalMs(plan: unknown): number {
  const p = (plan as [{ 'Planning Time': number; 'Execution Time': number }])[0];
  return p['Planning Time'] + p['Execution Time'];
}

/** Runs each query once (first), then `warmRuns` times, with EXPLAIN ANALYZE so the server's own timing is used. */
export async function runScreens(
  client: pg.Client,
  context: BenchContext,
  warmRuns = 5,
): Promise<ScreenResult[]> {
  const results: ScreenResult[] = [];
  for (const query of screenQueries(context)) {
    const explain = async (): Promise<number> => {
      const r = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`,
      );
      return totalMs(r.rows[0]?.['QUERY PLAN']);
    };
    const firstMs = await explain();
    const warm: number[] = [];
    for (let i = 0; i < warmRuns; i++) warm.push(await explain());
    warm.sort((a, b) => a - b);
    const rows = (await client.query(query.sql)).rowCount ?? 0;
    results.push({
      name: query.name,
      targetMs: query.targetMs,
      firstMs,
      warmMs: warm[Math.floor(warm.length / 2)] ?? firstMs,
      rows,
    });
  }
  return results;
}

/** One poll write: a packet + latest_packet upsert for every asset that has one, rolled back; median of 3 (docs/06 section 4). */
export async function pollWriteMs(client: pg.Client): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) runs.push(await pollWriteOnce(client));
  runs.sort((a, b) => a - b);
  return runs[1] ?? 0;
}

async function pollWriteOnce(client: pg.Client): Promise<number> {
  await client.query('BEGIN');
  try {
    const t0 = performance.now();
    await client.query(`
      INSERT INTO telemetry.packet (asset_id, ts, values)
      SELECT asset_id, ts + interval '1 minute', values FROM telemetry.latest_packet ON CONFLICT DO NOTHING`);
    await client.query(`
      INSERT INTO telemetry.latest_packet (asset_id, ts, values)
      SELECT asset_id, ts + interval '1 minute', values FROM telemetry.latest_packet
      ON CONFLICT (asset_id) DO UPDATE SET ts = excluded.ts, values = excluded.values, received_at = now()
      WHERE excluded.ts > telemetry.latest_packet.ts`);
    return performance.now() - t0;
  } finally {
    await client.query('ROLLBACK');
  }
}
