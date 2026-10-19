import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runCatalogueSync, type SourceConnector } from '@nexus/connectors-core';
import type { Database } from '@nexus/db';
import {
  SYNC_WARNING_METRIC,
  type CatalogueSyncDetails,
  type CatalogueWarning,
} from '@nexus/shared';
import { KyselyCatalogueRepository } from '../catalogue/kysely-catalogue.repository.js';
import { loadCatalogueSettings } from '../catalogue/catalogue-settings.js';
import { DB } from '../db/database.module.js';
import { Metrics } from '../observability/metrics.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';

/** Injection token of the source connector (the worker only ever sees the interface). */
export const SOURCE_CONNECTOR = Symbol('SOURCE_CONNECTOR');

export const CATALOGUE_JOB_NAME = 'catalogue-sync';
/** Early runs (unknown ids seen by the poll) are at least this far apart (docs/07 section 5). */
export const CATALOGUE_EARLY_GAP_MS = 5 * 60_000;
const FALLBACK_INTERVAL_MS = 60 * 60_000;

/**
 * The catalogue sync job (docs/07 section 5): on start, then every `catalogue.interval_minutes`
 * (hourly), plus early when the poll sees ids the catalogue does not know (at most once per 5 min).
 * It only wires things: the connector, the Kysely repository, the settings and the schedule. The
 * rules live in `runCatalogueSync` (packages/connectors/core).
 */
@Injectable()
export class CatalogueSyncJob implements OnModuleInit {
  private readonly logger = new Logger('CatalogueSync');
  private readonly repo: KyselyCatalogueRepository;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SOURCE_CONNECTOR) private readonly connector: SourceConnector,
    private readonly metrics: Metrics,
    private readonly scheduler: SchedulerService,
  ) {
    this.repo = new KyselyCatalogueRepository(db);
  }

  onModuleInit(): void {
    this.scheduler.register({
      name: CATALOGUE_JOB_NAME,
      runOnStart: true,
      minEarlyGapMs: CATALOGUE_EARLY_GAP_MS,
      intervalMs: () => this.intervalMs(),
      run: async () => {
        await this.run();
      },
    });
  }

  /** For the live poll (S3-03): call when bulk rows named assets that are not in the catalogue. */
  requestEarlyRun(unknownIds: number): void {
    const result = this.scheduler.requestEarly(CATALOGUE_JOB_NAME);
    this.logger.log(`early catalogue sync requested (${unknownIds} unknown ids): ${result}`);
  }

  async run(): Promise<CatalogueSyncDetails> {
    const settings = await loadCatalogueSettings(this.db);
    const { details } = await runCatalogueSync({
      connector: this.connector,
      repo: this.repo,
      settings: settings.retire,
      onWarning: (w) => this.onWarning(w),
    });
    this.logger.log(
      `catalogue sync done: seen ${details.seen} of ${details.total ?? 'unknown'}, complete=${details.complete}, ` +
        `inserted ${details.inserted}, updated ${details.updated}, retired ${details.retired}, ` +
        `warnings ${details.warnings.length}`,
    );
    return details;
  }

  private async intervalMs(): Promise<number> {
    try {
      return (await loadCatalogueSettings(this.db)).intervalMs;
    } catch {
      return FALLBACK_INTERVAL_MS;
    }
  }

  /**
   * Nexus operational warning, not a DATOMS alert: a named log event and a metric (the S8-02 alert
   * rules use them). It is also stored in sync_run.details.warnings by the sync itself.
   */
  private onWarning(w: CatalogueWarning): void {
    this.logger.warn(JSON.stringify({ event: SYNC_WARNING_METRIC, job: 'catalogue_sync', ...w }));
    this.metrics.increment(SYNC_WARNING_METRIC, { code: w.code, job: 'catalogue_sync' });
  }
}
