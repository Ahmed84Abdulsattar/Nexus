import { assertDirectConnection } from '@nexus/db';
import { sanitizeErrorText } from '@nexus/connectors-core';
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
  /** The shared check gives up after this long and answers "not leader" (default 15 s). */
  checkTimeoutMs?: number;
  /** Closing a connection waits this long, then the socket is destroyed (default 2 s). */
  closeTimeoutMs?: number;
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
  private controller = new AbortController();
  private checking: Promise<boolean> | undefined;
  /** The connection being opened right now; destroyed when the check times out. */
  private opening: pg.Client | undefined;
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
   * Aborts when the lock is lost (the connection failed, ended or was dropped). A job started while
   * leading gets the signal of that term and checks it between pages and batches. A new term has a new
   * signal; an old one stays aborted.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private lost(reason: string): void {
    this.held = false;
    if (!this.controller.signal.aborted) this.controller.abort(new Error(reason));
  }

  /**
   * Concurrent callers (two jobs starting together) share ONE check. Without this each would open its
   * own session, the second `pg_try_advisory_lock` would fail against the first (same lock name,
   * different session), and that job would be skipped as "not leader" for a whole retry cycle.
   */
  ensureLeader(): Promise<boolean> {
    this.checking ??= this.boundedCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /**
   * The check is bounded: a hung connect or query must not stall every job that waits on the shared
   * promise. On timeout the answer is "not leader" and the connection in flight is destroyed.
   */
  private async boundedCheck(): Promise<boolean> {
    const limit = this.options.checkTimeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), limit);
    });
    const check = this.check();
    check.catch(() => undefined); // a late failure after the timeout is not an unhandled rejection
    try {
      const result = await Promise.race([check, timeout]);
      if (result === false && !this.held) this.destroy(this.opening);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async check(): Promise<boolean> {
    if (this.client && !this.held) await this.drop(); // an error event marked it lost
    if (this.client && this.held) {
      const client = this.client;
      try {
        await client.query('SELECT 1');
        return this.held && this.client === client;
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
    try {
      // Defence in depth: loadWorkerConfig already refuses this at start-up.
      assertDirectConnection(this.options.url, 'WORKER_DATABASE_URL');
    } catch (error) {
      this.log.warn(sanitizeErrorText(error));
      return false;
    }
    const client = new pg.Client({
      connectionString: this.options.url,
      // TCP keep-alive: a silently dead connection (and so a lost lock) is noticed by the OS.
      keepAlive: true,
      application_name: this.options.applicationName ?? 'nexus-worker-leader',
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
    });
    this.opening = client;
    // An error event on an idle client would otherwise crash the process.
    client.on('error', () => {
      if (this.client === client) this.lost('leader connection error');
    });
    client.on('end', () => {
      if (this.client === client) this.lost('leader connection ended');
    });
    try {
      await client.connect();
      const res = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [this.lockName],
      );
      if (res.rows[0]?.ok !== true) {
        this.opening = undefined;
        await this.close(client);
        return false;
      }
    } catch (error) {
      this.log.warn(`could not reach the database for the leader lock: ${describe(error)}`);
      this.opening = undefined;
      await this.close(client);
      return false;
    }
    this.opening = undefined;
    this.client = client;
    this.controller = new AbortController(); // a new term
    this.held = true;
    this.log.log('this worker is the leader');
    return true;
  }

  private async drop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.lost('leader lock released');
    if (client) await this.close(client);
  }

  /** `end()` can hang on a dead connection: wait a little, then destroy the socket. */
  private async close(client: pg.Client): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.options.closeTimeoutMs ?? 2_000);
    });
    try {
      const r = await Promise.race([
        client.end().then(
          () => 'ok' as const,
          () => 'ok' as const,
        ),
        gaveUp,
      ]);
      if (r === 'timeout') this.destroy(client);
    } finally {
      clearTimeout(timer);
    }
  }

  private destroy(client: pg.Client | undefined): void {
    // pg keeps the socket on the (internal) connection object; destroying it ends every pending call.
    (
      client as unknown as { connection?: { stream?: { destroy(): void } } } | undefined
    )?.connection?.stream?.destroy();
  }
}

/** Sanitised: name and SQLSTATE for database errors, cut and cleaned text otherwise. */
function describe(error: unknown): string {
  return sanitizeErrorText(error);
}
