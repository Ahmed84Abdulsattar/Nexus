import type { SourceConnector } from '../connector.js';
import type { SourceAsset } from '../types.js';
import type {
  AssetPatch,
  AssetTypeRef,
  CatalogueAlert,
  CatalogueRepository,
  CatalogueSettings,
  CatalogueSummary,
  LinkTodoRow,
  NewAssetRow,
  StoredAsset,
} from './types.js';

/** The code of the fallback asset type (seeded; docs/07 section 6). */
export const GENERIC_ASSET_TYPE_CODE = 'generic';

export interface CatalogueSyncDeps {
  connector: Pick<SourceConnector, 'sourceSystem' | 'listAssets'>;
  repo: CatalogueRepository;
  settings: CatalogueSettings;
  /** Receives alerts (retire blocked, incomplete walk, failed sync). Wired to logging/notifications by the worker. */
  onAlert?: (alert: CatalogueAlert) => void;
  now?: () => Date;
}

export interface CatalogueSyncResult {
  summary: CatalogueSummary;
  alerts: CatalogueAlert[];
}

/**
 * One catalogue sync (docs/07 sections 5 and 6). Pure orchestration: no database, no source
 * details, no DATOMS field names. Idempotent: running it twice on the same walk changes nothing
 * the second time (apart from timestamps).
 *
 * Rules:
 * - New asset: insert. Type from `asset_type.source_names`; unknown or absent type is `generic`
 *   plus a link_todo. `project_id` stays null plus a link_todo (linking is S3-02).
 * - Existing asset: update only fields the source states and that differ. An absent field never
 *   overwrites a stored value.
 * - Retire: only after a COMPLETE walk, only after `retireAfterMisses` consecutive complete walks
 *   without the asset, and never more than `retireMaxFraction` of the active assets in one sync.
 *   An incomplete walk neither counts a miss nor resets one.
 */
export async function runCatalogueSync(deps: CatalogueSyncDeps): Promise<CatalogueSyncResult> {
  const { connector, repo, settings } = deps;
  const now = deps.now ?? (() => new Date());
  const sys = connector.sourceSystem;
  const startedAt = now();
  const alerts: CatalogueAlert[] = [];
  const alert = (a: CatalogueAlert): void => {
    alerts.push(a);
    deps.onAlert?.(a);
  };

  try {
    const catalogue = await connector.listAssets();
    // The same id twice in one walk would insert twice; the last one wins.
    const incoming = new Map<string, SourceAsset>();
    for (const a of catalogue.assets) incoming.set(a.externalId, a);
    // "Seen equals total": compared on the raw count, so a duplicate-ridden walk is not complete.
    const complete =
      catalogue.complete &&
      catalogue.total !== undefined &&
      catalogue.assets.length === catalogue.total;

    const [types, stored] = await Promise.all([repo.loadAssetTypes(), repo.loadAssets(sys)]);
    const typeIndex = indexTypes(types);
    const storedBy = new Map(stored.map((s) => [s.externalId, s]));
    const at = now();

    const inserts: NewAssetRow[] = [];
    const patches: AssetPatch[] = [];
    const todos = new Map<string, LinkTodoRow>();
    const addTodo = (t: LinkTodoRow): void => {
      todos.set(`${t.entityType}\u0000${t.externalId}`, t);
    };
    const seenIds: string[] = [];
    let unchanged = 0;
    let reappeared = 0;

    for (const a of incoming.values()) {
      const row = storedBy.get(a.externalId);
      if (!row) {
        const type = resolveType(a.sourceTypeName, typeIndex);
        inserts.push({
          externalId: a.externalId,
          // core.asset.name is NOT NULL. When the source gives no name the id is shown;
          // it is a label, not a value, and a later real name replaces it.
          name: a.name ?? a.externalId,
          sourceTypeName: a.sourceTypeName ?? null,
          assetTypeId: type.id,
          projectId: null,
          nameplate: a.nameplate ?? {},
          sourceCreatedAt: a.createdAt ?? null,
          kind: a.kind ?? null,
          seenAt: at,
        });
        typeTodo(a, type.known, addTodo);
        siteTodo(a, addTodo);
        continue;
      }
      seenIds.push(a.externalId);
      if (row.retiredAt) reappeared++;
      const patch = diff(row, a, typeIndex, addTodo);
      if (patch) patches.push(patch);
      else unchanged++;
    }

    if (inserts.length) await repo.insertAssets(sys, inserts);
    if (patches.length) await repo.updateAssets(patches, at);
    if (seenIds.length) await repo.markSeen(sys, seenIds, at);

    // ---- Misses and safe retire (only on a complete walk) ----
    let missed = 0;
    let retired = 0;
    let retireBlocked = false;
    if (!complete) {
      alert({
        code: 'incomplete_walk',
        message: 'Catalogue walk was not complete: no asset can be counted as missing or retired',
        details: { read: catalogue.assets.length, total: catalogue.total ?? null },
      });
    } else {
      const active = stored.filter((s) => !s.retiredAt);
      const missing = active.filter((s) => !incoming.has(s.externalId));
      missed = missing.length;
      const due = missing.filter((s) => s.missCount + 1 >= settings.retireAfterMisses);
      const limit = settings.retireMaxFraction * active.length;
      if (due.length > 0 && due.length > limit) {
        retireBlocked = true;
        alert({
          code: 'retire_blocked',
          message: `Catalogue sync would retire ${due.length} of ${active.length} active assets (above the ${settings.retireMaxFraction * 100}% guard): nothing retired`,
          details: {
            wouldRetire: due.length,
            active: active.length,
            maxFraction: settings.retireMaxFraction,
          },
        });
      }
      const toRetire = retireBlocked ? [] : due;
      const retireSet = new Set(toRetire.map((s) => s.externalId));
      const counters = missing
        .filter((s) => !retireSet.has(s.externalId))
        .map((s) => ({ externalId: s.externalId, missCount: s.missCount + 1 }));
      if (counters.length) await repo.setMisses(sys, counters);
      if (toRetire.length) {
        await repo.retire(
          sys,
          toRetire.map((s) => s.externalId),
          at,
        );
      }
      retired = toRetire.length;
    }

    const todoRows = [...todos.values()];
    if (todoRows.length) await repo.addLinkTodos(sys, todoRows);

    const summary: CatalogueSummary = {
      read: catalogue.assets.length,
      total: catalogue.total,
      complete,
      inserted: inserts.length,
      updated: patches.length,
      unchanged,
      reappeared,
      missed,
      retired,
      retireBlocked,
      linkTodos: todoRows.length,
    };
    await repo.writeSyncRun(sys, {
      job: 'catalogue_sync',
      startedAt,
      finishedAt: now(),
      status: complete && !retireBlocked ? 'ok' : 'partial',
      itemsRead: summary.read,
      itemsWritten: inserts.length + patches.length + retired,
      summary,
    });
    return { summary, alerts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    alert({ code: 'sync_failed', message: `Catalogue sync failed: ${message}`, details: {} });
    try {
      await repo.writeSyncRun(sys, {
        job: 'catalogue_sync',
        startedAt,
        finishedAt: now(),
        status: 'failed',
        itemsRead: 0,
        itemsWritten: 0,
        error: { message },
      });
    } catch {
      // The original error is the one that matters.
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------------------------

interface TypeIndex {
  byName: Map<string, AssetTypeRef>;
  generic: AssetTypeRef | undefined;
  genericId: string | null;
}

function indexTypes(types: readonly AssetTypeRef[]): TypeIndex {
  const byName = new Map<string, AssetTypeRef>();
  for (const t of types) for (const n of t.sourceNames) if (!byName.has(n)) byName.set(n, t);
  const generic = types.find((t) => t.code === GENERIC_ASSET_TYPE_CODE);
  return { byName, generic, genericId: generic?.id ?? null };
}

/** `known` is false when the name is unknown or absent (the asset falls back to generic). */
function resolveType(
  name: string | undefined,
  idx: TypeIndex,
): { id: string | null; known: boolean } {
  const t = name === undefined ? undefined : idx.byName.get(name);
  return t ? { id: t.id, known: true } : { id: idx.genericId, known: false };
}

function typeTodo(a: SourceAsset, known: boolean, add: (t: LinkTodoRow) => void): void {
  if (known) return;
  if (a.sourceTypeName === undefined) {
    add({
      entityType: 'asset',
      externalId: a.externalId,
      reason: 'no_type',
      payload: { reason: 'no_type', name: a.name ?? null },
    });
    return;
  }
  add({
    entityType: 'asset_type',
    externalId: a.sourceTypeName,
    reason: 'unknown_asset_type',
    payload: {
      reason: 'unknown_asset_type',
      sourceTypeName: a.sourceTypeName,
      sourceTypeId: a.sourceTypeId ?? null,
      exampleAssetExternalId: a.externalId,
    },
  });
}

/** No project is ever invented (docs/07 section 6): a new asset starts unlinked. */
function siteTodo(a: SourceAsset, add: (t: LinkTodoRow) => void): void {
  const reason = a.siteExternalId === undefined ? 'no_site' : 'site_not_linked';
  add({
    entityType: 'asset',
    externalId: a.externalId,
    reason,
    payload: {
      reason,
      name: a.name ?? null,
      sourceTypeName: a.sourceTypeName ?? null,
      siteExternalId: a.siteExternalId ?? null,
    },
  });
}

/** Fields the source states and that differ from the stored row; undefined when nothing differs. */
function diff(
  row: StoredAsset,
  a: SourceAsset,
  idx: TypeIndex,
  addTodo: (t: LinkTodoRow) => void,
): AssetPatch | undefined {
  const p: AssetPatch = { id: row.id, externalId: row.externalId };
  let changed = false;
  if (a.name !== undefined && a.name !== row.name) {
    p.name = a.name;
    changed = true;
  }
  if (a.nameplate !== undefined && !jsonEqual(a.nameplate, row.nameplate)) {
    p.nameplate = a.nameplate;
    changed = true;
  }
  if (a.createdAt !== undefined && a.createdAt.getTime() !== row.sourceCreatedAt?.getTime()) {
    p.sourceCreatedAt = a.createdAt;
    changed = true;
  }
  if (a.kind !== undefined && a.kind !== row.kind) {
    p.kind = a.kind;
    changed = true;
  }
  // Re-resolve the type when the source's type name changed, or while the asset is still on
  // generic (an admin may have mapped the name since). A manual type on a settled asset stays.
  const typeNameChanged = a.sourceTypeName !== undefined && a.sourceTypeName !== row.sourceTypeName;
  if (typeNameChanged) {
    p.sourceTypeName = a.sourceTypeName ?? null;
    changed = true;
  }
  const onGeneric = row.assetTypeId === null || row.assetTypeId === idx.genericId;
  if (a.sourceTypeName !== undefined && (typeNameChanged || onGeneric)) {
    const type = resolveType(a.sourceTypeName, idx);
    if (type.id !== row.assetTypeId) {
      p.assetTypeId = type.id;
      changed = true;
    }
    if (typeNameChanged) typeTodo(a, type.known, addTodo);
  }
  return changed ? p : undefined;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
