import { describeDatabaseUrl, resolveDatabaseUrl, type ResolvedDatabaseUrl } from '../urls.js';

/** Shared by the db scripts: resolve DATABASE_ADMIN_URL and say which database is being used. */
export function adminTarget(env: NodeJS.ProcessEnv = process.env): ResolvedDatabaseUrl {
  const target = resolveDatabaseUrl(env, 'admin');
  const via = target.fellBack ? ` (from DATABASE_URL, because APP_ENV=local and DATABASE_ADMIN_URL is unset)` : '';
  console.log(`database: ${describeDatabaseUrl(target.url)}${via}`);
  return target;
}

/** Turns a permission error on a fallen-back URL into advice. Rethrows everything else unchanged. */
export function explainAdminError(error: unknown, target: ResolvedDatabaseUrl): never {
  const code = (error as { code?: string }).code;
  if (target.fellBack && (code === '42501' || code === '28000' || code === '28P01')) {
    throw new Error(
      'The database user in DATABASE_URL cannot administer the database. ' +
        'Set DATABASE_ADMIN_URL to a user that can create roles and schemas ' +
        '(locally: postgres://nexus@localhost:5432/nexus, see docs/04).',
      { cause: error },
    );
  }
  throw error;
}

/** Runs a script body and sets the exit code; prints the message, never a stack with connection details. */
export async function runScript(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message);
    process.exitCode = 1;
  }
}
