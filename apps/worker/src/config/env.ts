import { DatabaseConfigError, assertDirectConnection, resolveDatabaseUrl } from '@nexus/db';
import { z } from 'zod';

/**
 * Environment of the worker, validated once at startup (docs/04 "Environment variables").
 * Only what the worker uses today; later tasks add their own (DATOMS, Key Vault ...).
 */
const blankToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

const envSchema = z.object({
  APP_ENV: z.enum(['local', 'dev', 'prod']),
  // Hard ceiling on budget.max_share (ADR 0005). Blank counts as unset. Range checked in (0, 1].
  DATOMS_MAX_SHARE_CEILING: z.preprocess(
    blankToUndefined,
    z.coerce.number().gt(0).max(1).optional(),
  ),
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
  /**
   * Upper bound for `budget.max_share` (ADR 0005): the effective share is min(setting, ceiling). It
   * comes from the environment, not from core.setting, because `nexus_api` can write that table.
   * Required outside prod; in prod it is 1 when absent.
   */
  maxShareCeiling: number;
}

export class WorkerConfigError extends Error {}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new WorkerConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  const ceiling = parsed.data.DATOMS_MAX_SHARE_CEILING;
  if (parsed.data.APP_ENV !== 'prod' && ceiling === undefined) {
    // Also covers DATOMS_LIVE=true: outside prod the worker never starts without a ceiling.
    // TODO(S3-03): outside prod, also refuse DATOMS_LIVE=true unless poll.subset_external_ids is a non-null list.
    const live = env['DATOMS_LIVE'] === 'true' ? '; DATOMS_LIVE=true is refused without it' : '';
    throw new WorkerConfigError(
      `Invalid environment:\n  DATOMS_MAX_SHARE_CEILING: required when APP_ENV is not prod (a number above 0 and at most 1, e.g. 0.1)${live}`,
    );
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
    maxShareCeiling: ceiling ?? 1,
    appEnv: parsed.data.APP_ENV,
    database: {
      url: database.url,
      poolMax: parsed.data.DATABASE_POOL_MAX,
      fellBack: database.fellBack,
    },
  };
}

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
