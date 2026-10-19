import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@nexus/db';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';

/** The typed Kysely query builder (connects as DATABASE_URL, the nexus_api role). */
export const DB = Symbol('DB');

/** A query that runs longer than this is cancelled by the server, so it cannot hold a connection. */
export const STATEMENT_TIMEOUT_MS = 30_000;

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

/**
 * Global: any module injects `@Inject(DB) db: Database`. The pool is lazy (nothing connects until
 * the first query), so tests and the OpenAPI generator build the app without a database.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Database => {
        const logger = new Logger('Database');
        return createDatabase({
          url: config.database.url,
          poolMax: config.database.poolMax,
          applicationName: 'nexus-api',
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
          onPoolError: (error) => logger.error(`idle connection error: ${error.message}`),
        });
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DB],
})
export class DatabaseModule {}
