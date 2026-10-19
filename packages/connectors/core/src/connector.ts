import type { ReadScope, SourceCatalogue, SourceReadingBatch, SourceSite } from './types.js';

/**
 * A data source. The worker runs each registered connector on its own schedule and uses only this
 * interface (docs/03 section 5). All source-specific knowledge stays inside the implementation.
 */
export interface SourceConnector {
  /** `core.source_system.code`, for example 'datoms'. */
  readonly sourceSystem: string;

  /** The complete catalogue walk: names and nameplate. Spends no telemetry credits. */
  listAssets(): Promise<SourceCatalogue>;

  /**
   * Latest readings, one batch per page or chunk, so the caller can process and release each.
   * For DATOMS this is the bulk endpoint only (ADR 0010).
   */
  readLatest(scope: ReadScope): AsyncIterable<SourceReadingBatch>;

  /** Only for sources with a separate site list. DATOMS has none: sites come in the bulk rows. */
  listSites?(): Promise<SourceSite[]>;
}
