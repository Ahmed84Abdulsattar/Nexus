import type { CatalogueSyncDetails } from '@nexus/shared';
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
  /** `core.asset.source_lifecycle_status`: display only (the catalogue_sync_details migration). */
  sourceLifecycleStatus: string | null;
  retiredAt: Date | null;
  /** When a catalogue walk last contained it. The safe-retire rule compares this with run start times. */
  lastSeenAt: Date;
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
  /** The source's lifecycle label as reported; display only. */
  sourceLifecycleStatus: string | null;
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
  sourceLifecycleStatus?: string;
}

export type LinkTodoReason = 'unknown_asset_type' | 'no_type' | 'no_site' | 'site_not_linked';

export interface LinkTodoRow {
  entityType: 'asset' | 'asset_type' | 'site';
  externalId: string;
  reason: LinkTodoReason;
  payload: Record<string, unknown>;
}

export interface SyncRunRecord {
  job: 'catalogue_sync';
  startedAt: Date;
  finishedAt: Date;
  status: 'ok' | 'partial' | 'failed';
  itemsRead: number;
  itemsWritten: number;
  /** Absent only when the run failed. */
  details?: CatalogueSyncDetails;
  error?: { message: string };
}

/**
 * Storage for the catalogue sync. The Kysely implementation (phase 2) lives in the worker; the
 * in-memory one is used by the tests. Batching of large arrays is the implementation's job.
 *
 * There is no per-asset miss counter. Misses are derived from `last_seen_at` and the start times of the
 * last complete runs (`loadRetireBaseline`), so a sync writes nothing extra per asset (docs/07 section 6).
 */
export interface CatalogueRepository {
  loadAssetTypes(): Promise<AssetTypeRef[]>;
  /** Every row of the source system, retired ones included. */
  loadAssets(sourceSystem: string): Promise<StoredAsset[]>;
  insertAssets(sourceSystem: string, rows: NewAssetRow[]): Promise<void>;
  updateAssets(patches: AssetPatch[], at: Date): Promise<void>;
  /**
   * The start time of the OLDEST of the last `count` complete runs of this job (status ok or partial,
   * `details.complete = true`), or undefined when fewer than `count` exist. An asset whose `last_seen_at`
   * is before that time was missing from every one of those walks.
   */
  loadRetireBaseline(sourceSystem: string, count: number): Promise<Date | undefined>;
  /** Sets last_seen_at and clears `retired_at` (a retired asset came back). */
  markSeen(sourceSystem: string, externalIds: string[], at: Date): Promise<void>;
  /** Sets `retired_at`. Never deletes. */
  retire(sourceSystem: string, externalIds: string[], at: Date): Promise<void>;
  /** Insert-if-absent on (source_system, entity_type, external_id); never reopens a resolved row. */
  addLinkTodos(sourceSystem: string, rows: LinkTodoRow[]): Promise<void>;
  writeSyncRun(sourceSystem: string, run: SyncRunRecord): Promise<void>;
}
