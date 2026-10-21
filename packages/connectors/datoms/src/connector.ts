import type {
  ListAssetsOptions,
  ReadScope,
  SourceAsset,
  SourceCatalogue,
  SourceConnector,
  SourceReading,
  SourceReadingBatch,
} from '@nexus/connectors-core';
import type { DatomsApi, MappedAsset, MappedReading } from '@nexus/datoms-client';

// Compile-time guard: the datoms-client mapping output must stay assignable to the connector
// types. If mapping.ts drifts from SourceAsset / SourceReading, the build fails here.
type Assert<T extends true> = T;
export type MappedAssetMatchesSource = Assert<MappedAsset extends SourceAsset ? true : false>;
export type MappedReadingMatchesSource = Assert<MappedReading extends SourceReading ? true : false>;

/** Page size of `GET /assets` (docs/07 section 2.1: limit up to 1000). */
const CATALOGUE_PAGE_LIMIT = 1000;

/**
 * DATOMS as a SourceConnector. No field names here: mapping is done in datoms-client
 * (`mapping.ts`), HTTP, paging, budget and retries in `DatomsApi`.
 *
 * Telemetry comes only from the bulk endpoint (ADR 0010).
 */
export class DatomsConnector implements SourceConnector {
  readonly sourceSystem = 'datoms';

  constructor(private readonly api: DatomsApi) {}

  async listAssets(options: ListAssetsOptions = {}): Promise<SourceCatalogue> {
    const { assets, total, complete, invalidRows, capped } = await this.api.collectAssets(
      CATALOGUE_PAGE_LIMIT,
      options.signal,
    );
    return { assets, total, complete, invalidRows, capped };
  }

  async *readLatest(scope: ReadScope): AsyncGenerator<SourceReadingBatch> {
    if (scope.mode === 'fleet') {
      for await (const page of this.api.walkFleet()) {
        yield { readings: page.readings, noData: page.noData, invalid: page.invalid };
      }
      return;
    }
    yield await this.api.bulkByIds(scope.externalIds);
  }
}
