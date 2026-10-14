import type { AssetKind } from '../types.js';

/** Settings (from `core.setting`), passed in as config, never constants. */
export interface CatalogueSettings {
  /** `catalogue.retire_after_misses`: consecutive COMPLETE walks without the asset. */
  retireAfterMisses: number;
  /** `catalogue.retire_max_fraction`: more than this share of active assets retires nothing. */
  retireMaxFraction: number;
}

/** A `core.asset_type` row, reduced to what the sync needs. */
export interface AssetTypeRef {
  id: string;
  code: string;
  /** `source_names`: source type names exactly as the source spells them. */
  sourceNames: readonly string[];
}

/** A `core.asset` row of this source system, reduced to what the sync needs. */
export interface StoredAsset {
  id: string;
  externalId: string;
  name: string;
  sourceTypeName: string | null;
  assetTypeId: string | null;
  projectId: string | null;
  /** `core.asset.asset_info`. */
  nameplate: Record<string, unknown>;
  sourceCreatedAt: Date | null;
  kind: AssetKind;
  retiredAt: Date | null;
  /** Consecutive complete walks that did not contain it (0 = seen last time). */
  missCount: number;
}

export interface NewAssetRow {
  externalId: string;
  name: string;
  sourceTypeName: string | null;
  assetTypeId: string | null;
  /** Always null in S3-01: linking is S3-02 and needs the site fields (Q21/Q22). */
  projectId: null;
  nameplate: Record<string, unknown>;
  sourceCreatedAt: Date | null;
  /** Only set when the source states it; otherwise the database default applies. */
  kind: AssetKind | null;
  seenAt: Date;
}

/** Only the fields that changed are present. */
export interface AssetPatch {
  id: string;
  externalId: string;
  name?: string;
  sourceTypeName?: string | null;
  assetTypeId?: string | null;
  nameplate?: Record<string, unknown>;
  sourceCreatedAt?: Date;
  kind?: AssetKind;
}

export type LinkTodoReason = 'unknown_asset_type' | 'no_type' | 'no_site' | 'site_not_linked';

export interface LinkTodoRow {
  entityType: 'asset' | 'asset_type' | 'site';
  externalId: string;
  reason: LinkTodoReason;
  payload: Record<string, unknown>;
}

export type CatalogueAlertCode = 'retire_blocked' | 'incomplete_walk' | 'sync_failed';

export interface CatalogueAlert {
  code: CatalogueAlertCode;
  message: string;
  details: Record<string, unknown>;
}

export interface CatalogueSummary {
  /** Assets the source returned. */
  read: number;
  total: number | undefined;
  complete: boolean;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Retired rows that came back (`retired_at` cleared). */
  reappeared: number;
  /** Active rows not in this walk (only counted on a complete walk). */
  missed: number;
  retired: number;
  retireBlocked: boolean;
  linkTodos: number;
}

export interface SyncRunRecord {
  job: 'catalogue_sync';
  startedAt: Date;
  finishedAt: Date;
  status: 'ok' | 'partial' | 'failed';
  itemsRead: number;
  itemsWritten: number;
  summary?: CatalogueSummary;
  error?: { message: string };
}

/**
 * Storage for the catalogue sync. The Kysely implementation (phase 2) lives in the worker; the
 * in-memory one is used by the tests. Batching of large arrays is the implementation's job.
 *
 * `missCount` is not a column of core.asset: the implementation keeps it (phase 2: in
 * `integration.cursor`, job 'catalogue_sync').
 */
export interface CatalogueRepository {
  loadAssetTypes(): Promise<AssetTypeRef[]>;
  /** Every row of the source system, retired ones included. */
  loadAssets(sourceSystem: string): Promise<StoredAsset[]>;
  insertAssets(sourceSystem: string, rows: NewAssetRow[]): Promise<void>;
  updateAssets(patches: AssetPatch[], at: Date): Promise<void>;
  /** Sets last_seen_at, resets the miss counter and clears `retired_at` (a retired asset came back). */
  markSeen(sourceSystem: string, externalIds: string[], at: Date): Promise<void>;
  /** Stores the new miss counters. */
  setMisses(
    sourceSystem: string,
    misses: { externalId: string; missCount: number }[],
  ): Promise<void>;
  /** Sets `retired_at` and clears the counter. Never deletes. */
  retire(sourceSystem: string, externalIds: string[], at: Date): Promise<void>;
  /** Insert-if-absent on (source_system, entity_type, external_id); never reopens a resolved row. */
  addLinkTodos(sourceSystem: string, rows: LinkTodoRow[]): Promise<void>;
  writeSyncRun(sourceSystem: string, run: SyncRunRecord): Promise<void>;
}
