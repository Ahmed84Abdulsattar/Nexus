import { z } from 'zod';

/**
 * `integration.sync_run.details` (the catalogue_sync_details migration): the typed summary of one job run, one shape per
 * `job`. The health API (R-61) reads it through `syncRunDetailsSchema`. `sync_run.error` stays for
 * failures only. Later jobs (live_poll, rollups, maintenance) add their own members to the union.
 */

/**
 * Nexus operational warnings of the catalogue sync. They are NOT DATOMS alerts: they never go to
 * `events.event` (alerts exactly as the source reports them) or `integration.link_todo`. A run with
 * a warning is `status = 'partial'`. Each one is also logged as `nexus.sync.warning` and counted in
 * the metric of the same name (attribute `code`); alert rules on repeats belong to S8-02.
 */
export const retireBlockedWarningSchema = z.object({
  code: z.literal('retire_blocked'),
  /** Assets that met the miss rule in this walk. */
  wouldRetire: z.number().int().min(0),
  /** Active assets before the sync. */
  active: z.number().int().min(0),
  fraction: z.number().min(0),
  maxFraction: z.number().min(0),
});

export const incompleteWalkWarningSchema = z.object({
  code: z.literal('incomplete_walk'),
  seen: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
});

/** The walk contained the same id more than once. A duplicate never stands in for a missing asset. Count only. */
export const duplicateIdsWarningSchema = z.object({
  code: z.literal('duplicate_ids'),
  count: z.number().int().min(1),
});

/** Rows that failed validation (bad id, text or nameplate too large) and were dropped. Count only. */
export const invalidRowsWarningSchema = z.object({
  code: z.literal('invalid_rows'),
  count: z.number().int().min(1),
});

/** A row, page or total cap was hit (the response is not trusted): the walk is incomplete. */
export const cappedWarningSchema = z.object({ code: z.literal('capped') });

export const catalogueWarningSchema = z.discriminatedUnion('code', [
  retireBlockedWarningSchema,
  incompleteWalkWarningSchema,
  duplicateIdsWarningSchema,
  invalidRowsWarningSchema,
  cappedWarningSchema,
]);
export type CatalogueWarning = z.infer<typeof catalogueWarningSchema>;
export type CatalogueWarningCode = CatalogueWarning['code'];

/** The metric / log event name for a warning (fixed: the S8-02 alert rules use it). */
export const SYNC_WARNING_METRIC = 'nexus.sync.warning';

export const catalogueSyncDetailsSchema = z.object({
  job: z.literal('catalogue_sync'),
  /** Assets the source returned (duplicates included). */
  seen: z.number().int().min(0),
  /** The total the source reported (DATOMS: pagination.total); null when it gave none. */
  total: z.number().int().min(0).nullable(),
  /**
   * True only when the walk reached the last page and seen equals total. The safe-retire rule reads
   * this from the last `catalogue.retire_after_misses` runs (docs/07 section 6).
   */
  complete: z.boolean(),
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  /** Retired assets that came back (`retired_at` cleared). */
  reappeared: z.number().int().min(0),
  /** Active assets not in this walk (counted on a complete walk only). */
  missed: z.number().int().min(0),
  retired: z.number().int().min(0),
  /** Link to-do rows created or confirmed by this run. */
  linkTodos: z.number().int().min(0),
  warnings: z.array(catalogueWarningSchema),
  /** Where the data came from. Absent on runs written before this field existed. */
  mode: z.enum(['live', 'fixtures']).optional(),
});
export type CatalogueSyncDetails = z.infer<typeof catalogueSyncDetailsSchema>;

/**
 * Maintenance job (S3-08, docs/07 section 5). Warnings are Nexus operational warnings like the
 * catalogue ones: a named log event and the `nexus.sync.warning` metric (attributes `code`, `job`).
 */
export const partitionMissingWarningSchema = z.object({
  code: z.literal('partition_missing'),
  /** For example 'telemetry.packet'. */
  table: z.string(),
  /** The partition that should exist after the run, for example 'packet_p20261020'. */
  partition: z.string(),
});

export const maintenanceStepFailedWarningSchema = z.object({
  code: z.literal('step_failed'),
  step: z.enum(['create', 'drop', 'prune_sync_run', 'settings', 'health']),
  table: z.string().optional(),
  /** Error name and SQLSTATE (or a redacted, capped message); never connection details. */
  message: z.string().max(200),
});

export const maintenanceWarningSchema = z.discriminatedUnion('code', [
  partitionMissingWarningSchema,
  maintenanceStepFailedWarningSchema,
]);
export type MaintenanceWarning = z.infer<typeof maintenanceWarningSchema>;

export const maintenanceDetailsSchema = z.object({
  job: z.literal('maintenance'),
  /** Partitions created in this run, per table (only tables where something was created). */
  created: z.array(z.object({ table: z.string(), count: z.number().int().min(1) })),
  /** Partitions dropped in this run, per table, by name. */
  dropped: z.array(z.object({ table: z.string(), partitions: z.array(z.string()) })),
  /** Retention settings whose configured value was unsafe or invalid; `used` is what was applied. */
  clamped: z.array(
    z.object({
      setting: z.string(),
      configured: z.unknown(),
      used: z.number(),
      reason: z.enum(['below_minimum', 'invalid', 'rounded', 'above_maximum']),
    }),
  ),
  /** Rows deleted from integration.sync_run (the newest complete catalogue runs are always kept). */
  syncRunsPruned: z.number().int().min(0),
  warnings: z.array(maintenanceWarningSchema),
});
export type MaintenanceDetails = z.infer<typeof maintenanceDetailsSchema>;

export const syncRunDetailsSchema = z.discriminatedUnion('job', [
  catalogueSyncDetailsSchema,
  maintenanceDetailsSchema,
]);
export type SyncRunDetails = z.infer<typeof syncRunDetailsSchema>;
