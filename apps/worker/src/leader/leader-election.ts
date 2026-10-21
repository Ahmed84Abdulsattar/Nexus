import pg from 'pg';

/** The advisory-lock name (docs/07 section 5): `pg_try_advisory_lock(hashtext('nexus-worker-leader'))`. */
export const LEADER_LOCK_NAME = 'nexus-worker-leader';

export interface LeaderLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface LeaderElectionOptions {
  /** The worker's own login (WORKER_DATABASE_URL). Never logged. */
  url: string;
  /** Shows in pg_stat_activity. */
  applicationName?: string;
  logger?: LeaderLogger;
  /** Lock name; tests use their own so they never fight a real worker. */
  lockName?: string;
}

const silent: LeaderLogger = { log() {}, warn() {} };

/**
 * Leader election with a session-level advisory lock on a DEDICATED connection (not the query pool:
 * a pooled connection can be recycled, which would drop the lock without anyone noticing).
 *
 * Only the leader runs DATOMS jobs. `ensureLeader()` is called before EVERY job:
 * - holding the lock: a `SELECT 1` on the lock connection proves the session (and so the lock) is
 *   still alive; if it fails (database failover, network), the connection is thrown away and the
 *   worker is no longer the leader until it takes the lock again;
 * - not holding it: connect and `pg_try_advisory_lock`; a replica that loses the race stays quiet.
 * A held lock disappears with its session, so a crashed leader never blocks the next one.
 */
export class LeaderElection {
  private client: pg.Client | undefined;
  private held = false;
  private checking: Promise<boolean> | undefined;
  private readonly log: LeaderLogger;
  private readonly lockName: string;

  constructor(private readonly options: LeaderElectionOptions) {
    this.log = options.logger ?? silent;
    this.lockName = options.lockName ?? LEADER_LOCK_NAME;
  }

  get isLeader(): boolean {
    return this.held;
  }

  /**
   * Concurrent callers (two jobs starting together) share ONE check. Without this each would open its
   * own session, the second `pg_try_advisory_lock` would fail against the first (same lock name,
   * different session), and that job would be skipped as "not leader" for a whole retry cycle.
   */
  ensureLeader(): Promise<boolean> {
    this.checking ??= this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async check(): Promise<boolean> {
    if (this.client && !this.held) await this.drop(); // an error event marked it lost
    if (this.client && this.held) {
      try {
        await this.client.query('SELECT 1');
        return true;
      } catch {
        this.log.warn('leader connection lost: stopping jobs and trying to take the lock again');
        await this.drop();
      }
    }
    return this.acquire();
  }

  /** Gives the lock up (shutdown). */
  async release(): Promise<void> {
    await this.drop();
  }

  private async acquire(): Promise<boolean> {
    const client = new pg.Client({
      connectionString: this.options.url,
      application_name: this.options.applicationName ?? 'nexus-worker-leader',
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
    });
    // An error event on an idle client would otherwise crash the process.
    client.on('error', () => {
      if (this.client === client) this.held = false;
    });
    try {
      await client.connect();
      const res = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [this.lockName],
      );
      if (res.rows[0]?.ok !== true) {
        await client.end().catch(() => undefined);
        return false;
      }
    } catch (error) {
      this.log.warn(`could not reach the database for the leader lock: ${describe(error)}`);
      await client.end().catch(() => undefined);
      return false;
    }
    this.client = client;
    this.held = true;
    this.log.log('this worker is the leader');
    return true;
  }

  private async drop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.held = false;
    if (client) await client.end().catch(() => undefined);
  }
}

/** Error name only: pg messages can carry connection details. */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
