import { Logger, Module } from '@nestjs/common';
import type {
  ReadScope,
  SourceCatalogue,
  SourceConnector,
  SourceReadingBatch,
  SourceSite,
} from '@nexus/connectors-core';
import { createDatomsConnector } from '@nexus/connectors-datoms';
import type { Database } from '@nexus/db';
import { z } from 'zod';
import { DB } from '../db/database.module.js';
import { LoggingMetrics, Metrics } from '../observability/metrics.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { CatalogueSyncJob, SOURCE_CONNECTOR } from './catalogue-sync.job.js';
import { MaintenanceJob } from './maintenance.job.js';

/**
 * Builds the connector on first use, so that creating the application connects to nothing (the
 * `budget.max_share` setting is read from the database at that point, ADR 0005). With
 * DATOMS_LIVE unset or false it answers from fixtures; the worker never sees the difference.
 */
export class LazyConnector implements SourceConnector {
  readonly sourceSystem = 'datoms';
  private inner: Promise<SourceConnector> | undefined;

  constructor(private readonly create: () => Promise<SourceConnector>) {}

  private get connector(): Promise<SourceConnector> {
    // A failed creation is not cached: the next run tries again.
    this.inner ??= this.create().catch((error: unknown) => {
      this.inner = undefined;
      throw error;
    });
    return this.inner;
  }

  async listAssets(): Promise<SourceCatalogue> {
    return (await this.connector).listAssets();
  }

  async *readLatest(scope: ReadScope): AsyncGenerator<SourceReadingBatch> {
    yield* (await this.connector).readLatest(scope);
  }

  async listSites(): Promise<SourceSite[]> {
    const c = await this.connector;
    return c.listSites ? c.listSites() : [];
  }
}

async function loadMaxShare(db: Database): Promise<number> {
  const row = await db
    .selectFrom('core.setting')
    .select('value')
    .where('key', '=', 'budget.max_share')
    .executeTakeFirst();
  // Fail closed on a bad value: an unreadable share must not mean "use everything".
  return z.number().gt(0).max(1).parse(row?.value);
}

@Module({
  providers: [
    { provide: Metrics, useClass: LoggingMetrics },
    SchedulerService,
    {
      provide: SOURCE_CONNECTOR,
      inject: [DB],
      useFactory: (db: Database): SourceConnector =>
        new LazyConnector(async () => {
          const { connector, mode } = createDatomsConnector({
            env: process.env,
            maxShare: await loadMaxShare(db),
          });
          new Logger('Connector').log(`DATOMS connector ready (${mode})`);
          return connector;
        }),
    },
    CatalogueSyncJob,
    MaintenanceJob,
  ],
  exports: [CatalogueSyncJob, MaintenanceJob, SchedulerService],
})
export class JobsModule {}
