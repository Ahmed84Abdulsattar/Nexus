/**
 * Source-neutral shapes every connector produces (docs/03 section 5, docs/07 section 4 item 7).
 *
 * Rules for all of them:
 * - Identity is `sourceSystem` + `externalId` (BIM-ready, CLAUDE.md rule 8).
 * - A field the source does not give is ABSENT (undefined). A connector never fills in a default,
 *   and a consumer never turns "absent" into 0, "" or a guessed status.
 * - Values and keys pass through unchanged from the source.
 */

/** `physical` = a sensored item; `site_metric` = values for a whole site as the source reports them (ADR 0009). */
export type AssetKind = 'physical' | 'site_metric';

export interface SourceSite {
  externalId: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  state?: string;
  district?: string;
}

/** One catalogue entry (names and nameplate). */
export interface SourceAsset {
  externalId: string;
  name?: string;
  createdAt?: Date;
  /** The source's own type (DATOMS: category name). Matched to `core.asset_type.source_names`. */
  sourceTypeName?: string;
  sourceTypeId?: string;
  /**
   * The source's lifecycle label (DATOMS: lifecycle_status), exactly as reported. Stored in
   * core.asset.source_lifecycle_status; display only, never used for status, counts, poll scope or
   * retirement.
   */
  lifecycleStatus?: string;
  /** Nameplate as the source sends it (nulls included). */
  nameplate?: Record<string, unknown>;
  /** Absent until the source gives the asset-to-site link (DATOMS: Q21/Q22). */
  siteExternalId?: string;
  /** Absent means "not stated"; the database default (`physical`) applies only on insert. */
  kind?: AssetKind;
}

export interface SourceStatus {
  /** The label exactly as the source sends it. */
  label: string;
}

export interface SourceLocation {
  latitude: number;
  longitude: number;
}

export interface SourceAlert {
  externalId?: string;
  ts: Date;
  severity?: string;
  message?: string;
  /** The source's alert, unchanged. */
  raw?: unknown;
}

/** One latest reading of one asset. */
export interface SourceReading {
  externalAssetId: string;
  /** The source's packet time (`data.time`): the change-detection key. */
  ts: Date;
  /**
   * Parameters unchanged, with the source's null-valued keys DROPPED (null means "no data"; docs/07 section 4 item 7).
   * The consumer REPLACES the stored latest values with this object, never merges.
   */
  values: Record<string, unknown>;
  /** EVERY parameter key in the row, null-valued ones included, so new keys are recorded in the dictionary. */
  seenKeys: string[];
  status?: SourceStatus;
  location?: SourceLocation;
  siteExternalId?: string;
  assetTypeName?: string;
  kind?: AssetKind;
  alerts?: SourceAlert[];
}

/** What one read call (or one page of a fleet read) returns. */
export interface SourceReadingBatch {
  readings: SourceReading[];
  /** Ids the source answered for but without a usable packet. */
  noData: string[];
  /** Ids whose row had no usable time or values. */
  invalid: string[];
}

/** The result of one complete catalogue walk. */
export interface SourceCatalogue {
  assets: SourceAsset[];
  /** The total the source reported (DATOMS: pagination.total). */
  total: number | undefined;
  /**
   * True only when the walk reached the last page AND the number of assets seen equals `total`.
   * Safe retire (docs/07 section 6) depends on this and on nothing else.
   */
  complete: boolean;
  /** Rows that failed validation and were dropped (count only). */
  invalidRows?: number;
  /** True when a row, page or total cap was hit. */
  capped?: boolean;
}

/** `fleet` = every asset in scope; `ids` = exactly these (DATOMS: id mode, max 500 per call). */
export type ReadScope = { mode: 'fleet' } | { mode: 'ids'; externalIds: readonly string[] };
