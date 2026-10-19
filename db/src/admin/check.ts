import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { withDatabaseName } from '../urls.js';
import { runCodegen } from './codegen.js';
import { migrate } from './migrate.js';
import { readSql, SCHEMA_FILE } from './paths.js';
import { pgDump } from './pg-tools.js';

export interface CheckResult {
  ok: boolean;
  /** Human-readable problems; empty when ok. */
  problems: string[];
}

/** Partition children (telemetry.packet_p20261012 ...) depend on the date the schema was created. */
const DUMP_ARGS = [
  '--schema-only',
  '--no-owner',
  '--no-privileges',
  '--no-tablespaces',
  '--no-publications',
  '--no-subscriptions',
  '--exclude-table=*.*_p20??*',
  '--exclude-table=public.pgmigrations',
  '--exclude-table=public.pgmigrations_id_seq',
];

/**
 * `pnpm db:check` (docs/06 section 8, rule 4). In two empty databases it
 *   1. applies every migration (the real runner, including db/roles.sql) and loads db/schema.sql,
 *   2. diffs the `pg_dump --schema-only` of both, leaving out partition children,
 *   3. compares the reference data (every row of every table, without timestamps and generated ids),
 *   4. checks that db/src/types.ts is what the migrated schema generates.
 * Both databases are dropped at the end, whatever happens. Needs an administrator connection that
 * can create databases and pg_dump (see pg-tools.ts).
 */
export async function checkSchema(options: {
  adminUrl: string;
  log?: (message: string) => void;
}): Promise<CheckResult> {
  const log = options.log ?? ((): void => undefined);
  const suffix = randomBytes(4).toString('hex');
  const migratedDb = `nexus_check_migrated_${suffix}`;
  const schemaDb = `nexus_check_schema_${suffix}`;
  const migratedUrl = withDatabaseName(options.adminUrl, migratedDb);
  const schemaUrl = withDatabaseName(options.adminUrl, schemaDb);
  const problems: string[] = [];

  const admin = new pg.Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(migratedDb)}`);
    await admin.query(`CREATE DATABASE ${quoteIdent(schemaDb)}`);

    log('applying migrations to an empty database ...');
    await migrate({ url: migratedUrl, direction: 'up', log });

    log('loading db/schema.sql into another empty database ...');
    const schemaClient = new pg.Client({ connectionString: schemaUrl });
    await schemaClient.connect();
    try {
      await schemaClient.query(readSql(SCHEMA_FILE));
    } finally {
      await schemaClient.end();
    }

    log('comparing pg_dump --schema-only ...');
    const [fromMigrations, fromSchema] = await Promise.all([
      pgDump(migratedUrl, DUMP_ARGS),
      pgDump(schemaUrl, DUMP_ARGS),
    ]);
    problems.push(...diffLines(normalizeDump(fromMigrations), normalizeDump(fromSchema)));

    log('comparing reference data ...');
    const [dataMigrated, dataSchema] = await Promise.all([
      referenceData(migratedUrl),
      referenceData(schemaUrl),
    ]);
    problems.push(...diffReferenceData(dataMigrated, dataSchema));

    log('checking db/src/types.ts ...');
    try {
      await runCodegen({ url: migratedUrl, verify: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      problems.push(
        `db/src/types.ts is out of date. Run \`pnpm --filter @nexus/db codegen\` after migrating, and commit it. (${detail.split('\n')[0] ?? ''})`,
      );
    }
  } finally {
    for (const name of [migratedDb, schemaDb]) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end();
  }
  return { ok: problems.length === 0, problems };
}

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Drops what differs between runs: comments, session settings, the random \restrict tokens. */
export function normalizeDump(dump: string): string[] {
  return dump
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(
      (l) =>
        l !== '' &&
        !l.startsWith('--') &&
        !l.startsWith('\\restrict') &&
        !l.startsWith('\\unrestrict') &&
        !l.startsWith('SET ') &&
        !l.startsWith('SELECT pg_catalog.set_config'),
    );
}

/** Lines present on one side only (as a multiset), labelled. Empty when the dumps match. */
export function diffLines(migrations: string[], schema: string[]): string[] {
  const count = (lines: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(migrations);
  const b = count(schema);
  const out: string[] = [];
  for (const [line, n] of a) {
    if ((b.get(line) ?? 0) < n) out.push(`only in the migrations:  ${line}`);
  }
  for (const [line, n] of b) {
    if ((a.get(line) ?? 0) < n) out.push(`only in db/schema.sql:   ${line}`);
  }
  return out.length === 0 ? [] : ['the schema differs between db/migrations and db/schema.sql:', ...out.slice(0, 40)];
}

type TableRows = Record<string, string[]>;

/**
 * Every ordinary table (not partition children, not the migrations table): its rows as sorted JSON
 * text. Columns that differ between two runs are left out: timestamptz columns (now()) and uuid
 * columns generated by gen_random_uuid().
 */
async function referenceData(url: string): Promise<TableRows> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tables = await client.query<{ schema: string; name: string; columns: string[] }>(`
      SELECT n.nspname AS schema, c.relname AS name,
             array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE
               a.atttypid <> 'timestamptz'::regtype
               AND NOT (a.atttypid = 'uuid'::regtype AND pg_get_expr(d.adbin, d.adrelid) LIKE 'gen_random_uuid()%')
             ) AS columns
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND n.nspname IN ('core', 'access', 'telemetry', 'events', 'integration', 'audit')
      GROUP BY n.nspname, c.relname
      ORDER BY 1, 2`);
    const result: TableRows = {};
    for (const t of tables.rows) {
      const cols = t.columns ?? [];
      if (cols.length === 0) continue;
      const list = cols.map((c) => `"${c}"`).join(', ');
      const rows = await client.query<{ j: string }>(
        `SELECT row_to_json(t)::text AS j FROM (SELECT ${list} FROM "${t.schema}"."${t.name}") t ORDER BY 1`,
      );
      result[`${t.schema}.${t.name}`] = rows.rows.map((r) => r.j);
    }
    return result;
  } finally {
    await client.end();
  }
}

function diffReferenceData(migrated: TableRows, schema: TableRows): string[] {
  const out: string[] = [];
  for (const table of new Set([...Object.keys(migrated), ...Object.keys(schema)])) {
    const a = migrated[table] ?? [];
    const b = schema[table] ?? [];
    if (a.length === b.length && a.every((row, i) => row === b[i])) continue;
    out.push(`reference data differs in ${table}: ${a.length} rows from migrations, ${b.length} from db/schema.sql`);
    const setB = new Set(b);
    const setA = new Set(a);
    for (const row of a.filter((r) => !setB.has(r)).slice(0, 3)) out.push(`  only in the migrations: ${row}`);
    for (const row of b.filter((r) => !setA.has(r)).slice(0, 3)) out.push(`  only in db/schema.sql:  ${row}`);
  }
  return out;
}
