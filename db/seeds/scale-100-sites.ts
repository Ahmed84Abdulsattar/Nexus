// pnpm db:seed:scale [options]
// Loads a 100-site / 5,000-asset dataset into a database and benchmarks the main screens of
// docs/06 section 5. For LOCAL BENCHMARK DATABASES ONLY: it refuses unless APP_ENV=local and the
// database name contains "scale", "bench" or "tmp" (or you pass --force). Use a fresh, migrated
// database:
//     createdb nexus_scale && DATABASE_ADMIN_URL=postgres://nexus@localhost:5432/nexus_scale pnpm db:migrate
//     DATABASE_ADMIN_URL=postgres://nexus@localhost:5432/nexus_scale pnpm db:seed:scale
//
// What it creates (all marked source_system 'datoms', external ids 'scale-...'):
//   - 7 districts, 100 projects, 2 buildings x 4 levels and 4 zones per project
//   - 5,000 assets: 48 physical + 2 site_metric per project. Physical assets use the four DATOMS
//     categories (DG Set, Fuel Tank, AC Sub-Meter, Solar Inverter) in a 2:1:4:3 mix; about 60% are
//     placed in a zone (with its level and building)
//   - status, location, parameter dictionary (db:seed's DATOMS list)
//   - packets for --packet-assets assets (default 300) for --days days (default 7), 1 per minute, each
//     with the REAL parameter keys of its category (DG Set 103, Fuel Tank 4, AC Sub-Meter 34, Solar
//     Inverter 23) and random numeric values. Not real DATOMS data: re-run with fixtures in S2/S3.
//   - 5-minute, hourly and daily rollups through the real SQL functions, plus synthetic older hourly
//     (--history-days, default 90) and daily (3 years) rollups copied from a real one per asset
//   - --events events (default 1,000,000) over 180 days
// Then it prints sizes and the query timings (first run and warm median) against the N-04 targets.
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { type BenchContext, pollWriteMs, runScreens } from '../bench/screens.js';
import { adminTarget, runScript } from '../src/admin/cli.js';
import { MIGRATOR_ROLE } from '../src/admin/migrate.js';
import { seed } from '../src/admin/seed.js';

interface Options {
  packetAssets: number;
  days: number;
  historyDays: number;
  events: number;
  force: boolean;
}

function parseOptions(argv: string[]): Options {
  const o: Options = { packetAssets: 300, days: 7, historyDays: 90, events: 1_000_000, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): number => {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${arg} needs a number`);
      return n;
    };
    if (arg === '--packet-assets') o.packetAssets = value();
    else if (arg === '--days') o.days = value();
    else if (arg === '--history-days') o.historyDays = value();
    else if (arg === '--events') o.events = value();
    else if (arg === '--force') o.force = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return o;
}

const timings: { step: string; seconds: number; detail?: string }[] = [];
async function step(client: pg.Client, name: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const t0 = performance.now();
  const result = await client.query(sql, params);
  const seconds = (performance.now() - t0) / 1000;
  timings.push({ step: name, seconds, detail: result.rowCount === null ? undefined : `${result.rowCount} rows` });
  console.log(`${name}: ${seconds.toFixed(1)} s${result.rowCount ? ` (${result.rowCount} rows)` : ''}`);
  return result;
}

const fmtBytes = (n: number): string =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GB` : `${(n / 2 ** 20).toFixed(0)} MB`;

await runScript(async () => {
  const options = parseOptions(process.argv.slice(2));
  if (process.env['APP_ENV'] !== 'local') throw new Error('The scale seed runs only with APP_ENV=local.');
  const target = adminTarget();
  const dbName = decodeURIComponent(new URL(target.url).pathname.slice(1));
  if (!options.force && !/scale|bench|tmp/i.test(dbName)) {
    throw new Error(
      `Refusing to load 5,000 assets into database "${dbName}". Use a benchmark database (name contains scale, bench or tmp), or pass --force.`,
    );
  }

  // The DATOMS parameter dictionary and the local roles are prerequisites.
  await seed({ url: target.url, appEnv: 'local' });

  const client = new pg.Client({ connectionString: target.url, application_name: 'nexus-scale-seed' });
  await client.connect();
  try {
    await client.query(`SET ROLE ${MIGRATOR_ROLE}`);
    const existing = await client.query(`SELECT count(*)::int AS n FROM core.project WHERE external_id LIKE 'scale-site-%'`);
    if (existing.rows[0].n > 0) throw new Error('This database already holds the scale dataset. Use a fresh one.');

    const days = options.days;
    // ---- partitions -------------------------------------------------------------------------
    await step(client, 'partitions', `
      SELECT core.create_range_partitions('telemetry.packet', 'day', current_date - ${days + 1}, ${days + 4}),
             core.create_range_partitions('telemetry.rollup_5m', 'month', (current_date - ${days + 1}), 3),
             core.create_range_partitions('telemetry.rollup_1h', 'month', (current_date - ${options.historyDays + 31}), ${Math.ceil(options.historyDays / 30) + 3}),
             core.create_range_partitions('events.event', 'month', (current_date - 190), 8),
             core.create_range_partitions('events.event_read', 'month', (current_date - 190), 8)`);

    // ---- projects, spatial model, assets ---------------------------------------------------
    await step(client, 'districts', `
      INSERT INTO core.district (name, emirate)
      SELECT 'District ' || g, (ARRAY['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'])[g]
      FROM generate_series(1, 7) g ON CONFLICT DO NOTHING`);
    await step(client, 'projects (100)', `
      INSERT INTO core.project (name, code, state, state_origin, project_type, district_id, latitude, longitude, source_system, external_id)
      SELECT 'Scale Project ' || lpad(g::text, 3, '0'), 'SC-' || lpad(g::text, 3, '0'),
             (ARRAY['active','active','active','active','central_store','finished','in_bid'])[1 + g % 7],
             'source', (ARRAY['residential','infrastructure','commercial'])[1 + g % 3],
             (SELECT id FROM core.district ORDER BY name OFFSET (g % 7) LIMIT 1),
             round((22.6 + random() * 2.8)::numeric, 6), round((51.6 + random() * 4.8)::numeric, 6),
             'datoms', 'scale-site-' || g
      FROM generate_series(1, 100) g`);
    await step(client, 'buildings, levels, zones', `
      WITH b AS (
        INSERT INTO core.building (project_id, name, code)
        SELECT p.id, n.name, n.code FROM core.project p CROSS JOIN (VALUES ('Tower A','A'), ('Block B','B')) n(name, code)
        WHERE p.external_id LIKE 'scale-site-%' RETURNING id, project_id, name
      ), l AS (
        INSERT INTO core.level (building_id, name, elevation_m, sort_order)
        SELECT b.id, 'L' || n, n * 3.5, n FROM b CROSS JOIN generate_series(0, 3) n RETURNING id, building_id, name
      )
      INSERT INTO core.zone (project_id, level_id, name, kind)
      SELECT p.id, (SELECT l.id FROM l JOIN b ON b.id = l.building_id WHERE b.project_id = p.id AND b.name = z.building AND l.name = z.level),
             z.name, z.kind
      FROM core.project p CROSS JOIN (VALUES
        ('Laydown yard', 'laydown', NULL, NULL), ('Main gate', 'gate', NULL, NULL),
        ('Tower A podium', 'room', 'Tower A', 'L0'), ('Block B roof', 'room', 'Block B', 'L3')) z(name, kind, building, level)
      WHERE p.external_id LIKE 'scale-site-%'`);
    await step(client, 'assets (5,000)', `
      WITH proj AS (SELECT id, row_number() OVER (ORDER BY name) AS rn FROM core.project WHERE external_id LIKE 'scale-site-%'),
      cats(i, cat) AS (VALUES (0,'DG Set'),(1,'DG Set'),(2,'Fuel Tank'),(3,'AC Sub-Meter'),(4,'AC Sub-Meter'),(5,'AC Sub-Meter'),(6,'AC Sub-Meter'),(7,'Solar Inverter'),(8,'Solar Inverter'),(9,'Solar Inverter')),
      gen AS (SELECT g, ((g - 1) / 50) + 1 AS prn, (g - 1) % 50 AS k FROM generate_series(1, 5000) g)
      INSERT INTO core.asset (project_id, asset_type_id, building_id, level_id, zone_id, kind, name, source_type_name,
                              make, model, serial_no, rated_kva, asset_info, source_system, external_id, source_created_at)
      SELECT p.id,
             (SELECT t.id FROM core.asset_type t WHERE c.cat = ANY (t.source_names) LIMIT 1),
             zp.building_id, zp.level_id, zp.zone_id,
             CASE WHEN gen.k < 48 THEN 'physical' ELSE 'site_metric' END,
             CASE WHEN gen.k < 48 THEN c.cat || ' ' || lpad(gen.g::text, 4, '0') ELSE 'Site energy total ' || (gen.k - 47) END,
             CASE WHEN gen.k < 48 THEN c.cat ELSE 'Energy Site Total' END,
             'Make' || (gen.g % 9), 'Model' || (gen.g % 13), 'SN' || gen.g, 250 + gen.g % 500,
             jsonb_build_object('capacity', 'x'), 'datoms', 'scale-' || gen.g, now() - interval '200 days'
      FROM gen
      JOIN proj p ON p.rn = gen.prn
      LEFT JOIN cats c ON c.i = gen.k % 10
      LEFT JOIN LATERAL (
        SELECT z.id AS zone_id, z.level_id, l.building_id FROM core.zone z LEFT JOIN core.level l ON l.id = z.level_id
        WHERE z.project_id = p.id AND gen.k < 48 AND gen.g % 5 < 3 ORDER BY z.name OFFSET (gen.g % 4) LIMIT 1
      ) zp ON true`);
    await step(client, 'status map + current status', `
      WITH sm AS (INSERT INTO telemetry.status_map VALUES ('datoms','Running','running'),('datoms','Idle','idle'),
                  ('datoms','Under Maintenance','maintenance'),('datoms','Off','off') ON CONFLICT DO NOTHING RETURNING 1)
      INSERT INTO telemetry.asset_status_current (asset_id, source_value, since, observed_at)
      SELECT id, (ARRAY['Running','Running','Idle','Under Maintenance','Off'])[1 + (random() * 4)::int], now() - interval '2 hours', now()
      FROM core.asset WHERE kind = 'physical'`);
    await step(client, 'locations', `
      INSERT INTO telemetry.asset_location_current (asset_id, latitude, longitude, observed_at)
      SELECT a.id, p.latitude + random() / 100, p.longitude + random() / 100, now()
      FROM core.asset a JOIN core.project p ON p.id = a.project_id WHERE a.kind = 'physical'`);

    // ---- packets ---------------------------------------------------------------------------
    // A random sample of physical assets, so the four categories appear in their 2:1:4:3 proportions.
    await client.query(`
      CREATE TEMP TABLE pk AS
      SELECT a.id AS asset_id, a.source_type_name,
             (SELECT array_agg(p.key ORDER BY p.key) FROM telemetry.parameter p
              WHERE p.source_system = a.source_system AND p.source_type_name = a.source_type_name) AS keys
      FROM core.asset a WHERE a.kind = 'physical' ORDER BY md5(a.id::text) LIMIT ${options.packetAssets}`);
    const sample = await client.query(`SELECT source_type_name, count(*)::int AS assets, avg(cardinality(keys))::numeric(6,1) AS keys FROM pk GROUP BY 1 ORDER BY 1`);
    console.log('packet assets by category:', JSON.stringify(sample.rows));

    for (let d = days; d >= 0; d--) {
      await step(client, `packets day -${d}`, `
        INSERT INTO telemetry.packet (asset_id, ts, values, received_at)
        SELECT pk.asset_id, t.ts,
               (SELECT jsonb_object_agg(k, round((random() * 1000)::numeric, 2)) FROM unnest(pk.keys) k),
               t.ts + interval '2 seconds'
        FROM pk CROSS JOIN generate_series(
               greatest(date_trunc('day', now()) - interval '${d} days', date_trunc('minute', now()) - interval '${days} days'),
               least(date_trunc('day', now()) - interval '${d - 1} days', date_trunc('minute', now())) - interval '1 minute',
               interval '1 minute') t(ts)`);
    }
    await step(client, 'latest_packet', `
      INSERT INTO telemetry.latest_packet (asset_id, ts, values)
      SELECT DISTINCT ON (asset_id) asset_id, ts, values FROM telemetry.packet
      WHERE ts >= now() - interval '1 day' ORDER BY asset_id, ts DESC`);

    // ---- rollups through the real functions ------------------------------------------------
    for (let d = days; d >= 0; d--) {
      await step(client, `rollup_5m day -${d}`, `
        SELECT telemetry.refresh_rollup_5m(date_trunc('day', now()) - interval '${d} days',
                                           least(date_trunc('day', now()) - interval '${d - 1} days', date_trunc('minute', now())))`);
    }
    await step(client, 'rollup_1h from 5m', `
      SELECT telemetry.refresh_rollup_combine('telemetry.rollup_5m', 'telemetry.rollup_1h', '1 hour',
             date_trunc('day', now()) - interval '${days} days', date_trunc('hour', now()))`);
    await step(client, 'rollup_1d from 1h (Dubai days)', `
      SELECT telemetry.refresh_rollup_combine('telemetry.rollup_1h', 'telemetry.rollup_1d', '1 day',
             date_trunc('day', now()) - interval '${days} days', date_trunc('hour', now()), 'Asia/Dubai')`);

    await client.query(`CREATE TEMP TABLE tpl AS SELECT DISTINCT ON (asset_id) asset_id, stats FROM telemetry.rollup_1h ORDER BY asset_id, bucket DESC`);
    if (options.historyDays > 0) {
      await step(client, `synthetic hourly history (${options.historyDays} d)`, `
        INSERT INTO telemetry.rollup_1h (asset_id, bucket, stats, packets)
        SELECT tpl.asset_id, b, tpl.stats, 60 FROM tpl
        CROSS JOIN generate_series(date_trunc('hour', now()) - interval '${options.historyDays} days',
                                   date_trunc('day', now()) - interval '${days} days' - interval '1 hour', interval '1 hour') b
        ON CONFLICT DO NOTHING`);
    }
    await step(client, 'synthetic daily history (3 years)', `
      INSERT INTO telemetry.rollup_1d (asset_id, bucket, stats, packets)
      SELECT tpl.asset_id, b, tpl.stats, 1440 FROM tpl
      CROSS JOIN generate_series(date_trunc('day', now()) - interval '3 years', date_trunc('day', now()) - interval '${days} days', interval '1 day') b
      ON CONFLICT DO NOTHING`);

    // ---- events and a scoped user ----------------------------------------------------------
    if (options.events > 0) {
      await client.query(`CREATE TEMP TABLE alist AS SELECT (row_number() OVER (ORDER BY external_id) - 1) AS n, id, project_id FROM core.asset WHERE kind = 'physical'`);
      await step(client, `events (${options.events})`, `
        INSERT INTO events.event (occurred_at, source_system, external_id, project_id, asset_id, category, severity, title, source_state)
        SELECT now() - random() * interval '180 days', 'datoms', 'scale-e' || g, a.project_id, a.id,
               (ARRAY['alarm','fault','info','maintenance'])[1 + g % 4], (ARRAY['high','medium','low'])[1 + g % 3], 'Event ' || g, 'active'
        FROM generate_series(1, ${options.events}) g
        JOIN alist a ON a.n = g % (SELECT count(*) FROM alist)`);
    }
    const group = '22222222-2222-4222-8222-222222222222';
    await client.query(`INSERT INTO access.app_user (entra_oid, tenant_id, email) VALUES (gen_random_uuid(), gen_random_uuid(), 'scale@example.invalid')`);
    await client.query(`INSERT INTO access.project_access (project_id, entra_group_id) SELECT id, $1 FROM core.project WHERE external_id LIKE 'scale-site-%' ORDER BY name LIMIT 20`, [group]);

    // ---- vacuum, sizes ----------------------------------------------------------------------
    await client.query('RESET ROLE'); // VACUUM needs ownership; the superuser has it
    const vt0 = performance.now();
    await client.query('VACUUM (ANALYZE)');
    console.log(`vacuum analyze: ${((performance.now() - vt0) / 1000).toFixed(1)} s`);
    await client.query(`SET ROLE ${MIGRATOR_ROLE}`);

    const sizes = await client.query(`
      SELECT p.relname AS table,
             sum(c.reltuples)::bigint AS rows_estimate,
             sum(pg_relation_size(c.oid)) AS heap,
             sum(pg_indexes_size(c.oid)) AS indexes,
             sum(pg_total_relation_size(c.oid)) AS total
      FROM pg_class p LEFT JOIN pg_inherits i ON i.inhparent = p.oid LEFT JOIN pg_class c ON c.oid = i.inhrelid
      WHERE p.relname IN ('packet','rollup_5m','rollup_1h','event') AND p.relkind = 'p' GROUP BY p.relname
      UNION ALL SELECT 'rollup_1d', reltuples::bigint, pg_relation_size(oid), pg_indexes_size(oid), pg_total_relation_size(oid) FROM pg_class WHERE oid = 'telemetry.rollup_1d'::regclass
      UNION ALL SELECT 'latest_packet', reltuples::bigint, pg_relation_size(oid), pg_indexes_size(oid), pg_total_relation_size(oid) FROM pg_class WHERE oid = 'telemetry.latest_packet'::regclass
      UNION ALL SELECT 'asset', reltuples::bigint, pg_relation_size(oid), pg_indexes_size(oid), pg_total_relation_size(oid) FROM pg_class WHERE oid = 'core.asset'::regclass
      ORDER BY 1`);
    const exact = await client.query(`
      SELECT (SELECT count(*) FROM telemetry.packet WHERE ts >= now() - interval '${days + 2} days') AS packet,
             (SELECT count(*) FROM telemetry.rollup_5m WHERE bucket >= now() - interval '${days + 2} days') AS rollup_5m,
             (SELECT count(*) FROM telemetry.rollup_1h WHERE bucket >= now() - interval '${options.historyDays + 40} days') AS rollup_1h,
             (SELECT count(*) FROM telemetry.rollup_1d WHERE bucket >= now() - interval '4 years') AS rollup_1d,
             (SELECT count(*) FROM events.event WHERE occurred_at >= now() - interval '200 days') AS event`);
    const rowCount = exact.rows[0] as Record<string, string>;
    const idx = await client.query(`
      SELECT pg_size_pretty(sum(pg_relation_size(i.indexrelid))) AS size FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid WHERE ic.relname LIKE 'packet\\_p%\\_ts\\_idx' ESCAPE '\\'`);
    console.log('\nSizes');
    console.log('| table | rows | heap | indexes | total | bytes per row |');
    console.log('|---|---|---|---|---|---|');
    for (const s of sizes.rows) {
      const rows = Number(rowCount[s.table as string] ?? s.rows_estimate);
      const per = rows > 0 ? Math.round(Number(s.total) / rows) : 0;
      console.log(`| ${s.table} | ${rows.toLocaleString('en')} | ${fmtBytes(Number(s.heap))} | ${fmtBytes(Number(s.indexes))} | ${fmtBytes(Number(s.total))} | ${per.toLocaleString('en')} |`);
    }
    console.log(`packet_ts_idx (all partitions): ${idx.rows[0]?.size}`);

    // ---- closed-bucket rollup timings (ADR 0007) -------------------------------------------
    const buckets: number[] = [];
    console.log('\nClosed-bucket rollups (the unit of work in production), one run each:');
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await client.query(`
        SELECT telemetry.refresh_rollup_5m(b, b + interval '5 minutes')
        FROM (SELECT date_bin('5 minutes', now() - interval '${i + 1} hours', timestamptz '2000-01-01') AS b) x`);
      buckets.push(performance.now() - t0);
    }
    const hourT0 = performance.now();
    await client.query(`SELECT telemetry.refresh_rollup_combine('telemetry.rollup_5m','telemetry.rollup_1h','1 hour',
      date_trunc('hour', now()) - interval '2 hours', date_trunc('hour', now()) - interval '1 hour')`);
    const hourMs = performance.now() - hourT0;
    const dayT0 = performance.now();
    await client.query(`SELECT telemetry.refresh_rollup_combine('telemetry.rollup_1h','telemetry.rollup_1d','1 day',
      (date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') - interval '1 day') AT TIME ZONE 'Asia/Dubai',
      date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai', 'Asia/Dubai')`);
    const dayMs = performance.now() - dayT0;
    const assetsWithPackets = (await client.query('SELECT count(*)::int AS n FROM pk')).rows[0].n as number;
    buckets.sort((a, b) => a - b);
    const med5 = buckets[2] ?? 0;
    console.log(`5-minute bucket: median ${med5.toFixed(0)} ms (min ${buckets[0]?.toFixed(0)}, max ${buckets[4]?.toFixed(0)}) for ${assetsWithPackets} assets`);
    console.log(`hourly close: ${hourMs.toFixed(0)} ms; Dubai day close: ${dayMs.toFixed(0)} ms`);
    console.log(
      `scaled linearly to 5,000 assets (same category mix): 5-min ~${((med5 * 5000) / assetsWithPackets / 1000).toFixed(1)} s, hourly ~${((hourMs * 5000) / assetsWithPackets / 1000).toFixed(1)} s, day ~${((dayMs * 5000) / assetsWithPackets / 1000).toFixed(1)} s`,
    );

    // ---- screens ------------------------------------------------------------------------------
    const ctx = await client.query(`
      SELECT (SELECT id FROM access.app_user WHERE email = 'scale@example.invalid') AS user_id,
             (SELECT id FROM core.project WHERE external_id LIKE 'scale-site-%' ORDER BY name LIMIT 1) AS project_id,
             (SELECT pk.asset_id FROM pk ORDER BY (pk.source_type_name = 'DG Set') DESC, pk.asset_id LIMIT 1) AS asset_id,
             (SELECT pk.keys[1] FROM pk ORDER BY (pk.source_type_name = 'DG Set') DESC, pk.asset_id LIMIT 1) AS key,
             (SELECT name FROM core.asset WHERE name LIKE 'DG Set %' ORDER BY name LIMIT 1 OFFSET 40) AS name`);
    const c = ctx.rows[0] as Record<string, string>;
    const projectOfAsset = await client.query(`SELECT project_id FROM core.asset WHERE id = $1`, [c['asset_id']]);
    const context: BenchContext = {
      userId: c['user_id']!,
      groupId: group,
      projectId: projectOfAsset.rows[0].project_id as string,
      assetId: c['asset_id']!,
      key: c['key']!,
      searchText: (c['name'] ?? 'DG Set').replace(/\d+$/, '').trim().slice(-6) + ' 0',
    };
    await sleep(500);
    const results = await runScreens(client, context);
    const poll = await pollWriteMs(client);
    console.log('\nScreens (ms): first run = planning + execution right after the load; warm = median of 5 further runs');
    console.log('| Screen | Rows | First | Warm | Target | OK |');
    console.log('|---|---|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.name} | ${r.rows} | ${r.firstMs.toFixed(1)} | ${r.warmMs.toFixed(1)} | ${r.targetMs} | ${Math.max(r.firstMs, r.warmMs) <= r.targetMs ? 'yes' : 'NO'} |`);
    }
    console.log(`| One poll write (${assetsWithPackets} packets + ${assetsWithPackets} latest upserts) | | ${poll.toFixed(1)} | | 300 | ${poll <= 300 ? 'yes' : 'NO'} |`);
    if (results.some((r) => Math.max(r.firstMs, r.warmMs) > r.targetMs)) {
      process.exitCode = 2; // a query over its N-04 target blocks the merge
    }
    console.log('\nStep timings:');
    for (const t of timings) console.log(`  ${t.step}: ${t.seconds.toFixed(1)} s${t.detail ? ` (${t.detail})` : ''}`);
  } finally {
    await client.end();
  }
});
