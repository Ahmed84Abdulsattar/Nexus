import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * libpq environment variables for a connection URL, so a password never appears in a process list.
 * (Used when starting pg_dump and other PostgreSQL client programs.)
 */
export function postgresEnvironment(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.username) env['PGUSER'] = decodeURIComponent(u.username);
  if (u.password) env['PGPASSWORD'] = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env['PGSSLMODE'] = sslmode;
  return env;
}

/**
 * Finds a PostgreSQL client program (pg_dump). Order: PG_DUMP (full path), NEXUS_PG_BIN (the
 * folder scripts/pg-local.ps1 uses), the default portable install on Windows, then PATH.
 */
export function findPgTool(name: 'pg_dump', env: NodeJS.ProcessEnv = process.env): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (env['PG_DUMP'] && name === 'pg_dump') return env['PG_DUMP'];
  const folders = [
    env['NEXUS_PG_BIN'],
    env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Programs', 'pgsql-16', 'bin') : undefined,
    ...(env['PATH'] ?? '').split(delimiter),
  ];
  for (const folder of folders) {
    if (folder && existsSync(join(folder, exe))) return join(folder, exe);
  }
  throw new Error(
    `${name} not found. Install PostgreSQL 16 client tools, or set PG_DUMP to the full path of ${exe} ` +
      '(or NEXUS_PG_BIN to its folder).',
  );
}

export async function pgDump(
  url: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { stdout } = await run(findPgTool('pg_dump', env), args, {
    env: { ...env, ...postgresEnvironment(url) },
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}
