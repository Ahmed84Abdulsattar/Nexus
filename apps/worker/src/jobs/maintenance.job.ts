import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Database } from '@nexus/db';
import {
  SYNC_WARNING_METRIC,
  type MaintenanceDetails,
  type MaintenanceWarning,
} from '@nexus/shared';
import { DB } from '../db/database.module.js';
import {
  msUntilNextDubaiHour,
  runMaintenance,
  writeMaintenanceRun,
} from '../maintenance/run-maintenance.js';
import { Metrics } from '../observability/metrics.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';

export const MAINTENANCE_JOB_NAME = 'maintenance';
/** Local hour (Asia/Dubai) of the daily run (docs/07 section 5). */
export const MAINTENANCE_HOUR_DUBAI = 2;

/**
 * The maintenance job (S3-08): once at start-up, then daily at 02:00 Asia/Dubai, leader only and
 * never overlapping (the scheduler guarantees both). It creates partitions ahead, drops expired
 * ones with clamped retention, prunes the job history and records a `sync_run` row. The rules are
 * in `maintenance/run-maintenance.ts`.
 */
@Injectable()
export class MaintenanceJob implements OnModuleInit {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly metrics: Metrics,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: MAINTENANCE_JOB_NAME,
      runOnStart: true,
      intervalMs: () => msUntilNextDubaiHour(new Date(), MAINTENANCE_HOUR_DUBAI),
      run: async () => {
        await this.run();
      },
    });
  }

  async run(now?: () => Date): Promise<MaintenanceDetails> {
    const result = await runMaintenance({
      db: this.db,
      ...(now ? { now } : {}),
      onWarning: (w) => this.onWarning(w),
      onClamp: (c) =>
        this.logger.warn(JSON.stringify({ event: 'nexus.maintenance.retention_clamped', ...c })),
    });
    await writeMaintenanceRun(this.db, result);
    const { details } = result;
    this.logger.log(
      `maintenance done: created ${details.created.reduce((n, c) => n + c.count, 0)} partitions, ` +
        `dropped ${details.dropped.reduce((n, d) => n + d.partitions.length, 0)}, ` +
        `clamped ${details.clamped.length}, sync_run pruned ${details.syncRunsPruned}, ` +
        `warnings ${details.warnings.length}`,
    );
    return details;
  }

  /** Nexus operational warning (not a DATOMS alert): a named log event and a metric (S8-02 alert rules). */
  private onWarning(w: MaintenanceWarning): void {
    this.logger.warn(JSON.stringify({ event: SYNC_WARNING_METRIC, job: 'maintenance', ...w }));
    this.metrics.increment(SYNC_WARNING_METRIC, { code: w.code, job: 'maintenance' });
  }
}
