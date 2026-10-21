import { DatabaseConfigError, assertDirectConnection, resolveDatabaseUrl } from '@nexus/db';
import { z } from 'zod';

/**
 * Environment of the worker, validated once at startup (docs/04 "Environment variables").
 * Only what the worker uses today; later tasks add their own (DATOMS, Key Vault ...).
 */
const blankToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

const envSchema = z.object({
  APP_ENV: z.enum(['local', 'dev', 'prod']),
  DATABASE_POOL_MAX: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(100).default(10),
  ),
});

export interface WorkerConfig {
  appEnv: 'local' | 'dev' | 'prod';
  database: {
    /** The worker's own login (nexus_worker role). Contains credentials when the URL has them: never log it. */
    url: string;
    poolMax: number;
    /** True when DATABASE_URL stood in for WORKER_DATABASE_URL (APP_ENV=local only). */
    fellBack: boolean;
  };
}

export class WorkerConfigError extends Error {}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new WorkerConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  let database;
  try {
    // WORKER_DATABASE_URL; falls back to DATABASE_URL only when APP_ENV=local (see @nexus/db urls.ts).
    database = resolveDatabaseUrl(env, 'worker');
    // The leader lock is a session advisory lock: through PgBouncer (6432) two workers could both
    // hold it. Refused at start-up, naming the variable that was actually used.
    assertDirectConnection(database.url, database.variable);
  } catch (error) {
    if (error instanceof DatabaseConfigError)
      throw new WorkerConfigError(`Invalid environment:\n  ${error.message}`);
    throw error;
  }
  return {
    appEnv: parsed.data.APP_ENV,
    database: {
      url: database.url,
      poolMax: parsed.data.DATABASE_POOL_MAX,
      fellBack: database.fellBack,
    },
  };
}

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
