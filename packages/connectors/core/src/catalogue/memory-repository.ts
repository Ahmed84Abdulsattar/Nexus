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
  readonly assets = new Map<string, StoredAsset & { lastSeenAt: Date }>();
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
        retiredAt: null,
        missCount: 0,
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
    }
    return Promise.resolve();
  }

  markSeen(_sys: string, ids: string[], at: Date): Promise<void> {
    for (const id of ids) {
      const a = this.assets.get(id);
      if (!a) continue;
      a.lastSeenAt = at;
      a.missCount = 0;
      a.retiredAt = null;
    }
    return Promise.resolve();
  }

  setMisses(_sys: string, misses: { externalId: string; missCount: number }[]): Promise<void> {
    for (const m of misses) {
      const a = this.assets.get(m.externalId);
      if (a) a.missCount = m.missCount;
    }
    return Promise.resolve();
  }

  retire(_sys: string, ids: string[], at: Date): Promise<void> {
    for (const id of ids) {
      const a = this.assets.get(id);
      if (a) {
        a.retiredAt = at;
        a.missCount = 0;
      }
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
