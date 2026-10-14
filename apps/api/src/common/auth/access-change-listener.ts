import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import pg from 'pg';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { AccessContextService } from './access-context.js';

/** The channel db/schema.sql notifies on (access.notify_access_change). */
export const ACCESS_CHANNEL = 'nexus_access';

const changeSchema = z.union([
  z.object({ scope: z.literal('user'), userId: z.uuid() }),
  z.object({ scope: z.literal('all') }),
]);

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Listens for access changes announced by the database and clears this instance's access cache
 * (docs/08 section 2, S1-01 step 6). Every API instance runs one, so a role, project-access or
 * active-flag change reaches all of them within milliseconds instead of after the 5 minute TTL.
 *
 * Needs a DIRECT Postgres connection: LISTEN does not work through PgBouncer in transaction mode
 * (Azure's built-in pooler, port 6432). It uses DATABASE_URL, one extra connection per instance.
 *
 * Safety:
 *  - an unreadable payload clears everything;
 *  - while the connection is down the cache is switched off (AccessContextService.setChangeChannelUp),
 *    and when it is back the cache starts empty, because notifications sent in between were missed.
 */
@Injectable()
export class AccessChangeListener implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccessChangeListener.name);
  private client: pg.Client | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryMs = FIRST_RETRY_MS;
  private stopped = false;
  private listening = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: AccessContextService,
  ) {}

  /** True while LISTEN is active. */
  get isListening(): boolean {
    return this.listening;
  }

  onApplicationBootstrap(): void {
    // Not awaited: the API starts serving while the first connection is made. Until it is up the
    // cache is simply not used.
    this.access.setChangeChannelUp(false);
    void this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
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
    });
    this.client = client;
    // After a failure only the first of error/end schedules a retry.
    let lost = false;
    const onLost = (reason: string): void => {
      if (lost || this.client !== client) return;
      lost = true;
      this.client = undefined;
      this.listening = false;
      this.access.setChangeChannelUp(false);
      void client.end().catch(() => undefined);
      this.logger.warn(
        `access change listener lost (${reason}); the access cache is off until it reconnects`,
      );
      this.scheduleRetry();
    };
    client.on('error', (e) => onLost(e.message));
    client.on('end', () => onLost('connection closed'));
    client.on('notification', (message) => this.onNotification(message.payload));

    try {
      await client.connect();
      await client.query(`LISTEN ${ACCESS_CHANNEL}`);
    } catch (error) {
      onLost(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.stopped) return;
    this.retryMs = FIRST_RETRY_MS;
    this.listening = true;
    this.access.setChangeChannelUp(true);
    this.logger.log('listening for access changes');
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
