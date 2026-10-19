import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { assertDirectConnection } from '@nexus/db';
import pg from 'pg';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { AccessContextService } from './access-context.js';

/** The channel db/schema.sql notifies on (access.notify_access_change). */
export const ACCESS_CHANNEL = 'nexus_access';
/** The listener sends itself a random value on this channel to prove LISTEN really works. */
export const PROBE_CHANNEL = 'nexus_access_probe';

const changeSchema = z.union([
  z.object({ scope: z.literal('user'), userId: z.uuid() }),
  z.object({ scope: z.literal('all') }),
]);

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** Optional provider for tests: shorter probe times. */
export const LISTENER_OPTIONS = Symbol('LISTENER_OPTIONS');

export interface ListenerOptions {
  /** Fixed time between probes. Default: random 15 to 30 s. */
  probeIntervalMs?: number;
  /** A probe not echoed back within this time means the connection is deaf. Default 5 s. */
  probeTimeoutMs?: number;
}

/**
 * Listens for access changes announced by the database and clears this instance's access cache
 * (docs/08 section 2, S1-01 step 6). Every API instance runs one, so a role, project-access or
 * active-flag change reaches all of them within milliseconds instead of after the 5 minute TTL.
 *
 * Needs a DIRECT Postgres connection: LISTEN does not work through PgBouncer in transaction mode
 * (Azure's built-in pooler, port 6432), so the listener refuses that port. It uses DATABASE_URL, one
 * extra connection per instance.
 *
 * A LISTEN connection can look healthy and still hear nothing (a half-open TCP connection after a
 * network or failover event, or a pooler). So "up" is proved, not assumed:
 *  - TCP keepalive starts after 10 s;
 *  - after LISTEN the listener sends itself a random nonce on a probe channel and marks the channel up
 *    only when the nonce comes back; it repeats this every 15 to 30 s, and a nonce that is not back
 *    within 5 s counts as a lost connection;
 *  - while the channel is not proven, the access cache is off (AccessContextService.setChangeChannelUp)
 *    and when it is proven again the cache starts empty, because notifications in between were missed;
 *  - an unreadable payload clears everything.
 */
@Injectable()
export class AccessChangeListener implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccessChangeListener.name);
  private client: pg.Client | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private probeTimer: NodeJS.Timeout | undefined;
  private pendingProbe: { nonce: string; done: () => void } | undefined;
  private retryMs = FIRST_RETRY_MS;
  private stopped = false;
  private listening = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: AccessContextService,
    @Optional() @Inject(LISTENER_OPTIONS) private readonly options?: ListenerOptions,
  ) {}

  /** True while LISTEN is active and the last probe came back. */
  get isListening(): boolean {
    return this.listening;
  }

  onApplicationBootstrap(): void {
    assertDirectConnection(this.config.database.url); // refuses the pooler port, also via ?port=
    // Not awaited: the API starts serving while the first connection is made. Until it is proven the
    // cache is simply not used.
    this.access.setChangeChannelUp(false);
    void this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.probeTimer);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: this.config.database.url,
      application_name: 'nexus-api-listener',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    this.client = client;
    // After a failure only the first of error/end/probe timeout schedules a retry.
    let lost = false;
    const onLost = (reason: string): void => {
      if (lost || this.client !== client) return;
      lost = true;
      this.client = undefined;
      this.listening = false;
      clearTimeout(this.probeTimer);
      this.pendingProbe = undefined;
      this.access.setChangeChannelUp(false);
      void client.end().catch(() => undefined);
      this.logger.warn(
        `access change listener lost (${reason}); the access cache is off until it reconnects`,
      );
      this.scheduleRetry();
    };
    client.on('error', (e) => onLost(e.message));
    client.on('end', () => onLost('connection closed'));
    client.on('notification', (message) => {
      if (message.channel === PROBE_CHANNEL) {
        const pending = this.pendingProbe;
        if (pending && message.payload === pending.nonce) pending.done();
      } else {
        this.onNotification(message.payload);
      }
    });

    const loop = (): void => {
      const delay = this.options?.probeIntervalMs ?? 15_000 + Math.random() * 15_000;
      this.probeTimer = setTimeout(() => {
        this.probe(client).then(loop, (e: Error) => onLost(e.message));
      }, delay);
      this.probeTimer.unref();
    };

    try {
      await client.connect();
      await client.query(`LISTEN ${ACCESS_CHANNEL}`);
      await client.query(`LISTEN ${PROBE_CHANNEL}`);
      await this.probe(client); // up only after our own nonce has come back
    } catch (error) {
      onLost(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.stopped || lost) return;
    this.retryMs = FIRST_RETRY_MS;
    this.listening = true;
    this.access.setChangeChannelUp(true);
    this.logger.log('listening for access changes');
    loop();
  }

  /** Sends a random value to ourselves and waits for it. Rejects on timeout or a query error. */
  private probe(client: pg.Client): Promise<void> {
    const timeoutMs = this.options?.probeTimeoutMs ?? 5_000;
    const nonce = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const mine: { nonce: string; done: () => void } = {
        nonce,
        done: () => {
          clearTimeout(timer);
          // Only clear the slot if it is still this probe's.
          if (this.pendingProbe === mine) this.pendingProbe = undefined;
          resolve();
        },
      };
      const timer = setTimeout(() => {
        if (this.pendingProbe === mine) this.pendingProbe = undefined;
        reject(new Error(`probe not echoed within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref();
      this.pendingProbe = mine;
      client.query('SELECT pg_notify($1, $2)', [PROBE_CHANNEL, nonce]).catch((e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => void this.connect(), this.retryMs);
    this.retryTimer.unref();
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private onNotification(payload: string | undefined): void {
    let change: z.infer<typeof changeSchema> | undefined;
    try {
      const parsed = changeSchema.safeParse(JSON.parse(payload ?? ''));
      if (parsed.success) change = parsed.data;
    } catch {
      // handled below
    }
    if (change?.scope === 'user') this.access.invalidateUser(change.userId);
    else this.access.invalidateAll(); // scope "all", or anything we cannot read
  }
}
