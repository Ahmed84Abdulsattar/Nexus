import type { DatomsConfig } from './config.js';
import { DatomsHttp, type DatomsResponse } from './http.js';

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/** Raw shapes from the v4 PDF. Fields not listed are kept as-is (index signature). */
export interface RawAsset {
  id: string;
  name?: string;
  [key: string]: unknown;
}
export interface RawAssetList {
  data: RawAsset[];
  pagination: Pagination;
  [key: string]: unknown;
}
export interface RawLatest {
  data: { time: string; parameters: Record<string, unknown> };
  [key: string]: unknown;
}
export interface RawBulkRow {
  asset_id: string;
  success: boolean;
  data?: { time: string; parameters: Record<string, unknown> };
  [key: string]: unknown;
}
export interface RawBulkResponse {
  data: RawBulkRow[];
  [key: string]: unknown;
}

export class DatomsClient {
  private readonly http: DatomsHttp;

  constructor(config: DatomsConfig, fetchImpl?: typeof fetch) {
    this.http = new DatomsHttp(config, fetchImpl);
  }

  /** GET /assets: catalogue only (limit 1-1000; 60 requests per 60 s per IP). */
  listAssets(page = 1, limit = 1000): Promise<DatomsResponse<RawAssetList>> {
    return this.http.request('GET', `/assets?page=${page}&limit=${limit}`);
  }

  /** POST /assets/telemetry/latest/query in id mode (1-500 unique ids). The only telemetry source. */
  bulkLatestById(ids: string[]): Promise<DatomsResponse<RawBulkResponse>> {
    return this.http.request('POST', '/assets/telemetry/latest/query', { asset_ids: ids });
  }

  /**
   * GET /assets/{id}/data/latest. FOR CLI SCRIPTS ONLY (ADR 0010): never call this from the
   * worker, the API or the poll loop. Limit: 8 per 5 min per asset.
   */
  getLatestForAsset(id: string): Promise<DatomsResponse<RawLatest>> {
    return this.http.request('GET', `/assets/${encodeURIComponent(id)}/data/latest`);
  }
}
