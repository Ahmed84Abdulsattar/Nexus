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
// Mapped (Nexus-side) shapes. They are structurally assignable to the connector types
// (SourceAsset, SourceReading in packages/connectors/core); the DATOMS connector checks this at
// compile time, so a drift between the two fails the build.
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
  nameplate: Record<string, unknown> | undefined;
  // Absent until DATOMS gives the field list (Q21, Q22). Never defaulted. The asset list rows
  // carry no site, so the asset-to-site link is not mapped (docs/07 section 3.2).
  siteExternalId?: never;
  kind?: never;
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
    nameplate: raw.asset_info ?? undefined,
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
 * One telemetry reading.
 *
 * DECISION (Ahmed, 2026-10-14): a parameter that DATOMS sends as `null` means "no data". Keys
 * with a `null` value are DROPPED from `values`; all other values (including `0`, `false` and
 * `""`) pass through unchanged. `seenKeys` lists EVERY key in the row, null or not, in the
 * order sent, so the worker can still record each key in `telemetry.parameter` per source type
 * (the UI then shows a never-reported key as "no data yet").
 *
 * The worker must REPLACE `latest_packet.values` with `values` on every new packet, never merge
 * it with the stored object: a value that went null must not keep showing its old value.
 */
export interface MappedReading {
  externalAssetId: string;
  ts: Date;
  /** `parameters` without the null-valued keys. */
  values: Record<string, unknown>;
  /** Every parameter key in the row, including those whose value was null. */
  seenKeys: string[];
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
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== null) kept[k] = v;
    }
    readings.push({ externalAssetId: id, ts, values: kept, seenKeys: Object.keys(values) });
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

// ---------------------------------------------------------------------------------------------
// Fixture-mode helpers (src/fixtures.ts). They live here because they touch raw field names.
// ---------------------------------------------------------------------------------------------

export type ParsedBulkRequest = { mode: 'ids'; ids: string[] } | { mode: 'fleet'; page: number };

/** Reads a bulk request body the way `bulkIdRequest` / `bulkFleetRequest` build it. */
export function parseBulkRequest(body: unknown): ParsedBulkRequest {
  const b = (body ?? {}) as { asset_ids?: unknown; page?: unknown };
  if (Array.isArray(b.asset_ids)) return { mode: 'ids', ids: b.asset_ids.map(String) };
  return { mode: 'fleet', page: typeof b.page === 'number' ? b.page : 1 };
}

export function bulkRowId(row: RawBulkRow): string {
  return String(row.asset_id);
}

/** What id mode answers for an id that is not in the fleet: `success: false`, no data. */
export function noDataRow(id: string): RawBulkRow {
  return { asset_id: id, success: false };
}

/** The same response with no rows (a page past the end). */
export function withoutRows<T extends { data: unknown[] }>(body: T): T {
  return { ...body, data: [] };
}
