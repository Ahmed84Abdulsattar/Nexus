import { Logger, Module } from '@nestjs/common';
import { createDatomsConnector, datomsMode } from '@nexus/connectors-datoms';
import type { Database } from '@nexus/db';
import { DB } from '../db/database.module.js';
import { LoggingMetrics, Metrics } from '../observability/metrics.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { CatalogueSyncJob, SOURCE_CONNECTOR, SOURCE_MODE } from './catalogue-sync.job.js';
import { MaintenanceJob } from './maintenance.job.js';
import { WorkerConnector } from './worker-connector.js';

/** Messages from the DATOMS client go to the Nest logger (endpoint, status, credits; never the token). */
const connectorLogger = new Logger('DatomsClient');

@Module({
  providers: [
    { provide: Metrics, useClass: LoggingMetrics },
    SchedulerService,
    { provide: SOURCE_MODE, useFactory: () => datomsMode(process.env) },
    {
      provide: SOURCE_CONNECTOR,
      inject: [DB],
      useFactory: (db: Database): WorkerConnector =>
        // Built on first use, with the share read from core.setting at the start of each job (ADR 0005).
        new WorkerConnector(
          async () =>
            (
              await db
                .selectFrom('core.setting')
                .select('value')
                .where('key', '=', 'budget.max_share')
                .executeTakeFirst()
            )?.value,
          (maxShare) => {
            const handle = createDatomsConnector({
              env: process.env,
              maxShare,
              log: {
                info: (m, f) => connectorLogger.log(f ? `${m} ${JSON.stringify(f)}` : m),
                warn: (m, f) => connectorLogger.warn(f ? `${m} ${JSON.stringify(f)}` : m),
                error: (m, f) => connectorLogger.error(f ? `${m} ${JSON.stringify(f)}` : m),
              },
            });
            new Logger('Connector').log(`DATOMS connector ready (${handle.mode})`);
            return handle;
          },
          new Logger('Connector'),
        ),
    },
    CatalogueSyncJob,
    MaintenanceJob,
  ],
  exports: [CatalogueSyncJob, MaintenanceJob, SchedulerService],
})
export class JobsModule {}
