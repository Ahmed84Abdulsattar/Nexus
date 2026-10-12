import type { DatomsConfig } from './config.js';
import { DatomsHttp, type DatomsResponse } from './http.js';
import {
  BULK_LATEST_PATH,
  assetListQuery,
  bulkFleetRequest,
  bulkIdRequest,
  type RawAssetList,
  type RawBulkResponse,
} from './mapping.js';

/**
 * Single-request calls, no retry, no budget. The product uses `DatomsApi` (api.ts), which wraps
 * these. The per-asset latest call is deliberately NOT here: it exists only in
 * `scripts/` (ADR 0010; a test enforces it).
 */
export class DatomsClient {
  private readonly http: DatomsHttp;

  constructor(config: DatomsConfig, fetchImpl?: typeof fetch, timeoutMs?: number) {
    this.http = new DatomsHttp(config, fetchImpl, timeoutMs);
  }

  /** Catalogue only (limit 1-1000; 60 requests per 60 s per IP). */
  listAssets(page = 1, limit = 1000): Promise<DatomsResponse<RawAssetList>> {
    return this.http.request('GET', assetListQuery(page, limit));
  }

  /** Fleet mode (limit up to 500): every asset in scope, in a fixed order, with pagination. */
  bulkLatestFleet(page: number, limit: number): Promise<DatomsResponse<RawBulkResponse>> {
    return this.http.request('POST', BULK_LATEST_PATH, bulkFleetRequest(page, limit));
  }

  /** Id mode (1-500 unique ids), one row per id in request order, no pagination. */
  bulkLatestById(ids: readonly string[]): Promise<DatomsResponse<RawBulkResponse>> {
    return this.http.request('POST', BULK_LATEST_PATH, bulkIdRequest(ids));
  }
}
