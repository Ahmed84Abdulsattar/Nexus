import type {
  AssetKind,
  AssetPatch,
  AssetTypeRef,
  CatalogueRepository,
  LinkTodoRow,
  NewAssetRow,
  StoredAsset,
  SyncRunRecord,
} from '@nexus/connectors-core';
import type { Database } from '@nexus/db';
import { sql } from 'kysely';

/** Rows per statement. Keeps each statement far below the 65,535-parameter limit and its payload small. */
export const WRITE_BATCH = 1_000;

function chunks<T>(items: readonly T[], size = WRITE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Kysely implementation of the catalogue storage (docs/06 section 4, docs/07 sections 5 and 6).
 *
 * - Batched statements: at most `WRITE_BATCH` rows each, so 20,000 assets are a handful of statements.
 * - Never deletes: `retire` sets `retired_at` (CLAUDE.md rule 8).
 * - The safe-retire miss rule needs no per-asset counter: `loadRetireBaseline` reads the start times
 *   of earlier complete runs from `integration.sync_run.details`.
 * - Runs as the `nexus_worker` role: INSERT/UPDATE on core.asset, integration.*; SELECT on core.
 */
export class KyselyCatalogueRepository implements CatalogueRepository {
  constructor(private readonly db: Database) {}

  async loadAssetTypes(): Promise<AssetTypeRef[]> {
    const rows = await this.db
      .selectFrom('core.asset_type')
      .select(['id', 'code', 'source_names'])
      .execute();
    return rows.map((r) => ({ id: r.id, code: r.code, sourceNames: r.source_names }));
  }

  async loadAssets(sourceSystem: string): Promise<StoredAsset[]> {
    const rows = await this.db
      .selectFrom('core.asset')
      .select([
        'id',
        'external_id',
        'name',
        'source_type_name',
        'asset_type_id',
        'project_id',
        'asset_info',
        'source_created_at',
        'kind',
        'source_lifecycle_status',
        'retired_at',
        'last_seen_at',
      ])
      .where('source_system', '=', sourceSystem)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      externalId: r.external_id,
      name: r.name,
      sourceTypeName: r.source_type_name,
      assetTypeId: r.asset_type_id,
      projectId: r.project_id,
      nameplate: (r.asset_info ?? {}) as Record<string, unknown>,
      sourceCreatedAt: r.source_created_at,
      kind: r.kind as AssetKind,
      sourceLifecycleStatus: r.source_lifecycle_status,
      retiredAt: r.retired_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  async insertAssets(sourceSystem: string, rows: NewAssetRow[]): Promise<void> {
    for (const batch of chunks(rows)) {
      await this.db
        .insertInto('core.asset')
        .values(
          batch.map((r) => ({
            source_system: sourceSystem,
            external_id: r.externalId,
            name: r.name,
            source_type_name: r.sourceTypeName,
            asset_type_id: r.assetTypeId,
            project_id: r.projectId,
            asset_info: JSON.stringify(r.nameplate),
            source_created_at: r.sourceCreatedAt,
            source_lifecycle_status: r.sourceLifecycleStatus,
            first_seen_at: r.seenAt,
            last_seen_at: r.seenAt,
            // Absent means "not stated": the column default ('physical') applies.
            ...(r.kind !== null ? { kind: r.kind } : {}),
          })),
        )
        // The leader lock means no second writer, but an insert must never fail a whole sync.
        .onConflict((oc) => oc.columns(['source_system', 'external_id']).doNothing())
        .execute();
    }
  }

  async updateAssets(patches: AssetPatch[]): Promise<void> {
    for (const batch of chunks(patches)) {
      // One UPDATE per batch. A key that is absent in a patch leaves the column alone; a key that is
      // present (even null, for the type) sets it. That cannot be said with COALESCE, hence jsonb_exists().
      const payload = JSON.stringify(
        batch.map((p) => ({
          id: p.id,
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.sourceTypeName !== undefined ? { sourceTypeName: p.sourceTypeName } : {}),
          ...(p.assetTypeId !== undefined ? { assetTypeId: p.assetTypeId } : {}),
          ...(p.nameplate !== undefined ? { nameplate: p.nameplate } : {}),
          ...(p.sourceCreatedAt !== undefined
            ? { sourceCreatedAt: p.sourceCreatedAt.toISOString() }
            : {}),
          ...(p.kind !== undefined ? { kind: p.kind } : {}),
          ...(p.sourceLifecycleStatus !== undefined
            ? { sourceLifecycleStatus: p.sourceLifecycleStatus }
            : {}),
        })),
      );
      await sql`
        UPDATE core.asset AS a SET
          name                    = CASE WHEN jsonb_exists(p, 'name') THEN p->>'name' ELSE a.name END,
          source_type_name        = CASE WHEN jsonb_exists(p, 'sourceTypeName') THEN p->>'sourceTypeName' ELSE a.source_type_name END,
          asset_type_id           = CASE WHEN jsonb_exists(p, 'assetTypeId') THEN (p->>'assetTypeId')::uuid ELSE a.asset_type_id END,
          asset_info              = CASE WHEN jsonb_exists(p, 'nameplate') THEN p->'nameplate' ELSE a.asset_info END,
          source_created_at       = CASE WHEN jsonb_exists(p, 'sourceCreatedAt') THEN (p->>'sourceCreatedAt')::timestamptz ELSE a.source_created_at END,
          kind                    = CASE WHEN jsonb_exists(p, 'kind') THEN p->>'kind' ELSE a.kind END,
          source_lifecycle_status = CASE WHEN jsonb_exists(p, 'sourceLifecycleStatus') THEN p->>'sourceLifecycleStatus' ELSE a.source_lifecycle_status END
        FROM jsonb_array_elements(${payload}::jsonb) AS p
        WHERE a.id = (p->>'id')::uuid
      `.execute(this.db);
    }
  }

  async loadRetireBaseline(sourceSystem: string, count: number): Promise<Date | undefined> {
    if (count < 1) return undefined;
    // The last `count` complete runs, newest first (index sync_run_job_time_idx). Failed runs never
    // carry details.complete. The oldest of them is the baseline.
    const rows = await this.db
      .selectFrom('integration.sync_run')
      .select('started_at')
      .where('source_system', '=', sourceSystem)
      .where('job', '=', 'catalogue_sync')
      .where('status', 'in', ['ok', 'partial'])
      .where(sql<boolean>`details->>'complete' = 'true'`)
      .orderBy('started_at', 'desc')
      .limit(count)
      .execute();
    if (rows.length < count) return undefined;
    return rows[rows.length - 1]!.started_at;
  }

  async markSeen(sourceSystem: string, externalIds: string[], at: Date): Promise<void> {
    for (const batch of chunks(externalIds)) {
      await this.db
        .updateTable('core.asset')
        .set({ last_seen_at: at, retired_at: null })
        .where('source_system', '=', sourceSystem)
        .where('external_id', 'in', batch)
        .execute();
    }
  }

  async retire(sourceSystem: string, externalIds: string[], at: Date): Promise<void> {
    for (const batch of chunks(externalIds)) {
      await this.db
        .updateTable('core.asset')
        .set({ retired_at: at })
        .where('source_system', '=', sourceSystem)
        .where('external_id', 'in', batch)
        .where('retired_at', 'is', null)
        .execute();
    }
  }

  async addLinkTodos(sourceSystem: string, rows: LinkTodoRow[]): Promise<void> {
    for (const batch of chunks(rows)) {
      await this.db
        .insertInto('integration.link_todo')
        .values(
          batch.map((r) => ({
            source_system: sourceSystem,
            entity_type: r.entityType,
            external_id: r.externalId,
            payload: JSON.stringify(r.payload),
          })),
        )
        // Never reopens a resolved or ignored row.
        .onConflict((oc) => oc.columns(['source_system', 'entity_type', 'external_id']).doNothing())
        .execute();
    }
  }

  async writeSyncRun(sourceSystem: string, run: SyncRunRecord): Promise<void> {
    await this.db
      .insertInto('integration.sync_run')
      .values({
        source_system: sourceSystem,
        job: run.job,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        status: run.status,
        items_read: run.itemsRead,
        items_written: run.itemsWritten,
        details: run.details ? JSON.stringify(run.details) : null,
        error: run.error ? JSON.stringify(run.error) : null,
      })
      .execute();
  }
}
