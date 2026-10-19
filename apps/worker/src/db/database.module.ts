import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, describeDatabaseUrl, type Database } from '@nexus/db';
import { WORKER_CONFIG, type WorkerConfig } from '../config/env.js';

/** The typed Kysely query builder (connects as WORKER_DATABASE_URL, the nexus_worker role). */
export const DB = Symbol('DB');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

/**
 * Global: any job injects `@Inject(DB) db: Database`. The pool is lazy, so the module compiles
 * without a database. No statement timeout: rollups can legitimately run for a while (docs/06 section 6).
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig): Database => {
        const logger = new Logger('Database');
        logger.log(`database ${describeDatabaseUrl(config.database.url)}${config.database.fellBack ? ' (from DATABASE_URL: APP_ENV=local fallback)' : ''}`);
        return createDatabase({
          url: config.database.url,
          poolMax: config.database.poolMax,
          applicationName: 'nexus-worker',
          onPoolError: (error) => logger.error(`idle connection error: ${error.message}`),
        });
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DB],
})
export class DatabaseModule {}
