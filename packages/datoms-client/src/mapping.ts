/**
 * THE ONLY FILE WITH DATOMS FIELD NAMES (docs/07 section 4 item 7).
 *
 * Built against the v4 PDF and the real responses recorded on 2026-10-12 (fixtures/).
 * When the DATOMS sample (Q21) and field list (Q22) arrive, only this file, its tests and
 * fixtures/ change.
 *
 * Rules:
 * - Keys and values in `parameters` pass through unchanged.
 * - A missing field maps to "absent" (undefined), never to a default value.
 * - Status, location, site, asset type (for readings), alerts and kind are ABSENT on purpose:
 *   the bulk rows seen so far carry none of them (docs/07 section 3.2, Q22). In particular
 *   `lat`, `long`, `mc_st` and `under_maintenance` stay ordinary parameter values and are
 *   NOT mapped to location or status.
 */

// ---------------------------------------------------------------------------------------------
// Raw DATOMS shapes (what the API sends)
// ---------------------------------------------------------------------------------------------

export interface RawPagination {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface RawAsset {
  id: string;
  name?: string;
  created_at?: string;
  lifecycle_status?: string;
  category_id?: number | string | null;
  category_name?: string | null;
  asset_info?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RawAssetList {
  success?: boolean;
  data: RawAsset[];
  pagination: RawPagination;
}

export interface RawBulkRow {
  asset_id: string;
  success: boolean;
  data?: { time: string; parameters: Record<string, unknown> };
}

export interface RawBulkResponse {
  success?: boolean;
  data: RawBulkRow[];
  /** Present in fleet mode only. */
  pagination?: RawPagination;
}

// ---------------------------------------------------------------------------------------------
// Request bodies and paths
// ---------------------------------------------------------------------------------------------

export const ASSET_LIST_PATH = '/assets';
export const BULK_LATEST_PATH = '/assets/telemetry/latest/query';

export function assetListQuery(page: number, limit: number): string {
  return `${ASSET_LIST_PATH}?page=${page}&limit=${limit}`;
}

/** Fleet mode body. Never mixed with id mode (that gives 400). */
export function bulkFleetRequest(page: number, limit: number): unknown {
  return { page, limit };
}

/** Id mode body: 1-500 unique ids. */
export function bulkIdRequest(ids: readonly string[]): unknown {
  return { asset_ids: ids };
}

/** Error code of a 422 that asks for a smaller page (docs/07 section 2.3). */
export const CODE_PAGE_RESPONSE_TOO_LARGE = 'PAGE_RESPONSE_TOO_LARGE';

// ---------------------------------------------------------------------------------------------
// Mapped (Nexus-side) shapes. They match the connector types (SourceAsset, SourceReading).
// ---------------------------------------------------------------------------------------------

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function mapPagination(raw: RawPagination | undefined): Pagination | undefined {
  if (!raw) return undefined;
  return { total: raw.total, page: raw.page, limit: raw.limit, totalPages: raw.total_pages };
}

export interface MappedAsset {
  externalId: string;
  name: string | undefined;
  createdAt: Date | undefined;
  /** DATOMS category name; matched against `core.asset_type.source_names`. */
  sourceTypeName: string | undefined;
  sourceTypeId: string | undefined;
  lifecycleStatus: string | undefined;
  /** `asset_info`, unchanged (make, model, kva, capacity, ... and nulls as sent). */
  nameplate: Record<string, unknown>;
}

export function mapAsset(raw: RawAsset): MappedAsset {
  const created = raw.created_at ? new Date(raw.created_at) : undefined;
  return {
    externalId: String(raw.id),
    name: raw.name ?? undefined,
    createdAt: created && !Number.isNaN(created.getTime()) ? created : undefined,
    sourceTypeName: raw.category_name ?? undefined,
    sourceTypeId:
      raw.category_id === null || raw.category_id === undefined
        ? undefined
        : String(raw.category_id),
    lifecycleStatus: raw.lifecycle_status ?? undefined,
    nameplate: raw.asset_info ?? {},
  };
}

export interface AssetListPage {
  assets: MappedAsset[];
  pagination: Pagination | undefined;
}

export function mapAssetListPage(body: RawAssetList): AssetListPage {
  return { assets: (body.data ?? []).map(mapAsset), pagination: mapPagination(body.pagination) };
}

/**
 * One telemetry reading. `values` is the `parameters` object unchanged.
 *
 * DECISION (flagged for the user): a parameter that DATOMS sends as `null` is kept as `null`
 * in `values` ("reported null"). It is never turned into 0 or a default, and it is not
 * dropped. Consumers show "—" for it. A key that is not in the row at all is "absent".
 */
export interface MappedReading {
  externalAssetId: string;
  ts: Date;
  values: Record<string, unknown>;
  // Absent until DATOMS gives the field list (Q21, Q22). Never defaulted, never guessed.
  status?: never;
  location?: never;
  siteExternalId?: never;
  assetTypeName?: never;
  kind?: never;
  alerts?: never;
}

export interface MappedBulkPage {
  readings: MappedReading[];
  /** Ids whose row had `success: false` (no usable packet, or not in the fleet). */
  noData: string[];
  /** Ids whose row was `success: true` but had no usable `data.time` or `data.parameters`. */
  invalid: string[];
  pagination: Pagination | undefined;
}

export function mapBulkRows(rows: readonly RawBulkRow[]): Omit<MappedBulkPage, 'pagination'> {
  const readings: MappedReading[] = [];
  const noData: string[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const id = String(row.asset_id);
    if (!row.success) {
      noData.push(id);
      continue;
    }
    const ts = row.data?.time ? new Date(row.data.time) : undefined;
    const values = row.data?.parameters;
    if (!ts || Number.isNaN(ts.getTime()) || !values || typeof values !== 'object') {
      invalid.push(id);
      continue;
    }
    readings.push({ externalAssetId: id, ts, values });
  }
  return { readings, noData, invalid };
}

/** Rows in a bulk response; each in-fleet row costs one credit (docs/07 section 2.3). */
export function bulkRowCount(body: RawBulkResponse | undefined): number {
  return body?.data?.length ?? 0;
}

export function mapBulkPage(body: RawBulkResponse): MappedBulkPage {
  return { ...mapBulkRows(body.data ?? []), pagination: mapPagination(body.pagination) };
}
