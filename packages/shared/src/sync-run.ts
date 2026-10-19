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

export const catalogueWarningSchema = z.discriminatedUnion('code', [
  retireBlockedWarningSchema,
  incompleteWalkWarningSchema,
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
});
export type CatalogueSyncDetails = z.infer<typeof catalogueSyncDetailsSchema>;

export const syncRunDetailsSchema = z.discriminatedUnion('job', [catalogueSyncDetailsSchema]);
export type SyncRunDetails = z.infer<typeof syncRunDetailsSchema>;
