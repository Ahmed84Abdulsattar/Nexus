import type {
  AssetPatch,
  AssetTypeRef,
  CatalogueRepository,
  LinkTodoRow,
  NewAssetRow,
  StoredAsset,
  SyncRunRecord,
} from './types.js';

/** An in-memory `CatalogueRepository` for tests and local runs. Same semantics as the SQL one. */
export class InMemoryCatalogueRepository implements CatalogueRepository {
  readonly assets = new Map<string, StoredAsset>();
  readonly todos = new Map<string, LinkTodoRow>();
  readonly runs: SyncRunRecord[] = [];
  private seq = 0;

  constructor(readonly types: AssetTypeRef[]) {}

  loadAssetTypes(): Promise<AssetTypeRef[]> {
    return Promise.resolve(this.types);
  }

  loadAssets(): Promise<StoredAsset[]> {
    return Promise.resolve([...this.assets.values()].map((a) => ({ ...a })));
  }

  insertAssets(_sys: string, rows: NewAssetRow[]): Promise<void> {
    for (const r of rows) {
      if (this.assets.has(r.externalId)) throw new Error(`duplicate asset ${r.externalId}`);
      this.assets.set(r.externalId, {
        id: `asset-${++this.seq}`,
        externalId: r.externalId,
        name: r.name,
        sourceTypeName: r.sourceTypeName,
        assetTypeId: r.assetTypeId,
        projectId: r.projectId,
        nameplate: r.nameplate,
        sourceCreatedAt: r.sourceCreatedAt,
        kind: r.kind ?? 'physical',
        sourceLifecycleStatus: r.sourceLifecycleStatus,
        retiredAt: null,
        lastSeenAt: r.seenAt,
      });
    }
    return Promise.resolve();
  }

  updateAssets(patches: AssetPatch[]): Promise<void> {
    for (const p of patches) {
      const a = this.assets.get(p.externalId);
      if (!a) throw new Error(`no asset ${p.externalId}`);
      if (p.name !== undefined) a.name = p.name;
      if (p.sourceTypeName !== undefined) a.sourceTypeName = p.sourceTypeName;
      if (p.assetTypeId !== undefined) a.assetTypeId = p.assetTypeId;
      if (p.nameplate !== undefined) a.nameplate = p.nameplate;
      if (p.sourceCreatedAt !== undefined) a.sourceCreatedAt = p.sourceCreatedAt;
      if (p.kind !== undefined) a.kind = p.kind;
      if (p.sourceLifecycleStatus !== undefined) a.sourceLifecycleStatus = p.sourceLifecycleStatus;
    }
    return Promise.resolve();
  }

  loadRetireBaseline(_sys: string, count: number): Promise<Date | undefined> {
    const complete = this.runs
      .filter((r) => r.status !== 'failed' && r.details?.complete === true)
      .map((r) => r.startedAt.getTime())
      .sort((a, b) => b - a)
      .slice(0, count);
    return Promise.resolve(complete.length < count ? undefined : new Date(complete[count - 1]!));
  }

  markSeen(_sys: string, ids: string[], at: Date): Promise<void> {
    for (const id of ids) {
      const a = this.assets.get(id);
      if (!a) continue;
      a.lastSeenAt = at;
      a.retiredAt = null;
    }
    return Promise.resolve();
  }

  retire(_sys: string, ids: string[], at: Date): Promise<void> {
    for (const id of ids) {
      const a = this.assets.get(id);
      if (a) a.retiredAt = at;
    }
    return Promise.resolve();
  }

  addLinkTodos(_sys: string, rows: LinkTodoRow[]): Promise<void> {
    for (const r of rows) {
      const key = `${r.entityType}\u0000${r.externalId}`;
      if (!this.todos.has(key)) this.todos.set(key, r);
    }
    return Promise.resolve();
  }

  writeSyncRun(_sys: string, run: SyncRunRecord): Promise<void> {
    this.runs.push(run);
    return Promise.resolve();
  }
}
