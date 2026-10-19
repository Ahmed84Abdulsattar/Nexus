import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DB_ROOT } from './paths.js';
import { postgresEnvironment } from './pg-tools.js';

const run = promisify(execFile);

export const TYPES_FILE = `${DB_ROOT}src/types.ts`;

/**
 * Regenerates db/src/types.ts (the typed table list for Kysely) from a migrated database, or with
 * `verify` only checks that the committed file is current. Partition children are left out (the
 * generator skips them), and so is the migrations table.
 */
export async function runCodegen(options: {
  url: string;
  verify?: boolean;
}): Promise<{ stdout: string }> {
  const bin = `${DB_ROOT}node_modules/kysely-codegen/dist/cli/bin.js`;
  const args = [
    bin,
    '--dialect',
    'postgres',
    '--url',
    'env(NEXUS_CODEGEN_URL)',
    '--exclude-pattern',
    'public.*',
    '--out-file',
    TYPES_FILE,
    '--log-level',
    'info',
    ...(options.verify ? ['--verify'] : []),
  ];
  // The URL goes through the environment so a password never shows in the process list.
  const { stdout } = await run(process.execPath, args, {
    cwd: DB_ROOT,
    env: { ...process.env, ...postgresEnvironment(options.url), NEXUS_CODEGEN_URL: options.url },
  });
  return { stdout };
}
