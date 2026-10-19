import { describe, expect, it } from 'vitest';
import {
  InMemoryCatalogueRepository,
  runCatalogueSync,
  type AssetTypeRef,
  type CatalogueSettings,
  type SourceAsset,
  type SourceCatalogue,
} from '../src/index.js';

const settings: CatalogueSettings = { retireAfterMisses: 2, retireMaxFraction: 0.05 };

const types: AssetTypeRef[] = [
  { id: 't-dg', code: 'diesel_generator', sourceNames: ['DG Set'] },
  { id: 't-fuel', code: 'fuel_tank', sourceNames: ['Fuel Tank'] },
  { id: 't-gen', code: 'generic', sourceNames: [] },
];

function asset(id: string, over: Partial<SourceAsset> = {}): SourceAsset {
  return {
    externalId: id,
    name: `Asset ${id}`,
    sourceTypeName: 'DG Set',
    nameplate: { a: 1 },
    ...over,
  };
}

function walk(assets: SourceAsset[], over: Partial<SourceCatalogue> = {}): SourceCatalogue {
  return { assets, total: assets.length, complete: true, ...over };
}

/** A connector that serves one walk per call, in order. */
function rig(walks: SourceCatalogue[], s: CatalogueSettings = settings) {
  const repo = new InMemoryCatalogueRepository(types);
  const alerts: string[] = [];
  let i = 0;
  let clock = Date.parse('2026-10-14T10:00:00Z');
  const connector = {
    sourceSystem: 'datoms',
    listAssets: () => Promise.resolve(walks[Math.min(i++, walks.length - 1)]!),
  };
  const run = () =>
    runCatalogueSync({
      connector,
      repo,
      settings: s,
      onWarning: (w) => alerts.push(w.code),
      now: () => new Date((clock += 1000)),
    });
  return { repo, run, alerts };
}

function ids(n: number, from = 1): SourceAsset[] {
  return Array.from({ length: n }, (_, k) => asset(String(from + k)));
}

describe('catalogue sync: insert and update', () => {
  it('inserts a new asset with its type, no project, and a link_todo for the missing site', async () => {
    const { repo, run } = rig([walk([asset('1')])]);
    const { details } = await run();
    expect(details.inserted).toBe(1);
    const row = repo.assets.get('1')!;
    expect(row.assetTypeId).toBe('t-dg');
    expect(row.projectId).toBeNull();
    expect(row.nameplate).toEqual({ a: 1 });
    expect(repo.todos.get('asset\u00001')?.reason).toBe('no_site');
    expect(repo.runs[0]).toMatchObject({ status: 'ok', itemsRead: 1, itemsWritten: 1 });
  });

  it('a site id from the source is not linked (S3-02) and gets its own to-do reason', async () => {
    const { repo, run } = rig([walk([asset('1', { siteExternalId: 'S9' })])]);
    await run();
    expect(repo.assets.get('1')!.projectId).toBeNull();
    expect(repo.todos.get('asset\u00001')?.reason).toBe('site_not_linked');
  });

  it('updates a changed name and nameplate, leaves absent fields alone', async () => {
    const { repo, run } = rig([
      walk([asset('1')]),
      walk([asset('1', { name: 'Renamed', nameplate: { a: 2 } })]),
      walk([{ externalId: '1' }]), // name and nameplate absent: nothing is overwritten
    ]);
    await run();
    const second = await run();
    expect(second.details).toMatchObject({ updated: 1, inserted: 0 });
    expect(repo.assets.get('1')).toMatchObject({ name: 'Renamed', nameplate: { a: 2 } });
    const third = await run();
    expect(third.details).toMatchObject({ updated: 0, unchanged: 1 });
    expect(repo.assets.get('1')).toMatchObject({ name: 'Renamed', nameplate: { a: 2 } });
  });

  it('is idempotent: the same walk twice changes nothing the second time', async () => {
    const same = walk([asset('1'), asset('2', { sourceTypeName: 'Fuel Tank' })]);
    const { run } = rig([same, same]);
    await run();
    const again = await run();
    expect(again.details).toMatchObject({ inserted: 0, updated: 0, unchanged: 2, retired: 0 });
  });

  it('nameplate comparison ignores key order', async () => {
    const { run } = rig([
      walk([asset('1', { nameplate: { a: 1, b: null } })]),
      walk([asset('1', { nameplate: { b: null, a: 1 } })]),
    ]);
    await run();
    expect((await run()).details.updated).toBe(0);
  });

  it('an unknown category becomes generic plus one asset_type link_todo', async () => {
    const { repo, run } = rig([
      walk([
        asset('1', { sourceTypeName: 'Crane Hook Camera' }),
        asset('2', { sourceTypeName: 'Crane Hook Camera' }),
      ]),
    ]);
    await run();
    expect(repo.assets.get('1')!.assetTypeId).toBe('t-gen');
    expect(repo.assets.get('2')!.assetTypeId).toBe('t-gen');
    const todo = repo.todos.get('asset_type\u0000Crane Hook Camera');
    expect(todo?.reason).toBe('unknown_asset_type');
    // one to-do per type name, not per asset
    expect([...repo.todos.values()].filter((t) => t.entityType === 'asset_type')).toHaveLength(1);
  });

  it('a missing category is generic plus an asset to-do, never an invented type', async () => {
    const { repo, run } = rig([walk([{ externalId: '1', name: 'x' }])]);
    await run();
    expect(repo.assets.get('1')!.assetTypeId).toBe('t-gen');
    expect(repo.assets.get('1')!.sourceTypeName).toBeNull();
    expect(repo.todos.get('asset\u00001')).toBeDefined();
  });

  it('once an admin maps the name, a generic asset gets the real type on the next sync', async () => {
    const w = walk([asset('1', { sourceTypeName: 'Hoist Cam' })]);
    const { repo, run } = rig([w, w]);
    await run();
    expect(repo.assets.get('1')!.assetTypeId).toBe('t-gen');
    repo.types.push({ id: 't-hoist', code: 'hoist', sourceNames: ['Hoist Cam'] });
    await run();
    expect(repo.assets.get('1')!.assetTypeId).toBe('t-hoist');
  });

  it('does not overwrite a manually set type on a settled asset', async () => {
    const w = walk([asset('1')]);
    const { repo, run } = rig([w, w]);
    await run();
    repo.assets.get('1')!.assetTypeId = 't-fuel'; // set by an admin
    await run();
    expect(repo.assets.get('1')!.assetTypeId).toBe('t-fuel');
  });

  it('uses the id as the name only when the source gives none', async () => {
    const { repo, run } = rig([walk([{ externalId: '7', sourceTypeName: 'DG Set' }])]);
    await run();
    expect(repo.assets.get('7')!.name).toBe('7');
  });
});

describe('catalogue sync: lifecycle status (display only)', () => {
  it('stores the source label as reported and follows changes, without touching anything else', async () => {
    const { repo, run } = rig([
      walk([asset('1', { lifecycleStatus: 'active' })]),
      walk([asset('1', { lifecycleStatus: 'Decommissioned' })]),
      walk([asset('1')]), // absent: not overwritten
    ]);
    await run();
    expect(repo.assets.get('1')!.sourceLifecycleStatus).toBe('active');
    const second = await run();
    expect(second.details.updated).toBe(1);
    expect(repo.assets.get('1')).toMatchObject({
      sourceLifecycleStatus: 'Decommissioned',
      retiredAt: null,
    });
    await run();
    expect(repo.assets.get('1')!.sourceLifecycleStatus).toBe('Decommissioned');
  });
});

describe('catalogue sync: safe retire', () => {
  it('an incomplete walk retires nothing and counts no miss', async () => {
    const all = ids(100);
    const { repo, run, alerts } = rig([
      walk(all),
      walk(all.slice(0, 50), { complete: false, total: 100 }),
      walk(all.slice(0, 50), { complete: false, total: 100 }),
      walk(all.slice(0, 50), { complete: false, total: 100 }),
    ]);
    await run();
    for (let k = 0; k < 3; k++) {
      const r = await run();
      expect(r.details).toMatchObject({ retired: 0, missed: 0, complete: false });
    }
    expect([...repo.assets.values()].every((a) => !a.retiredAt)).toBe(true);
    expect(alerts).toContain('incomplete_walk');
    expect(repo.runs.at(-1)!.status).toBe('partial');
  });

  it('a walk whose count differs from the total is not complete even if flagged complete', async () => {
    const all = ids(100);
    const { repo, run } = rig([walk(all), walk(all.slice(0, 99), { total: 100, complete: true })]);
    await run();
    const r = await run();
    expect(r.details.complete).toBe(false);
    expect(repo.assets.get('100')!.retiredAt).toBeNull();
    expect(r.details.warnings).toEqual([{ code: 'incomplete_walk', seen: 99, total: 100 }]);
  });

  it('retires only after 2 consecutive complete misses, and sets retired_at, never deletes', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99); // asset 100 disappears: 1 of 100 = 1%
    const { repo, run } = rig([walk(all), walk(rest), walk(rest)]);
    await run();
    const first = await run();
    expect(first.details).toMatchObject({ missed: 1, retired: 0 });
    expect(repo.assets.get('100')).toMatchObject({ retiredAt: null });
    const second = await run();
    expect(second.details).toMatchObject({ retired: 1 });
    const gone = repo.assets.get('100')!;
    expect(gone.retiredAt).toBeInstanceOf(Date);
    expect(repo.assets.size).toBe(100); // the row is still there
  });

  it('honours retire_after_misses from config', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    const { repo, run } = rig([walk(all), walk(rest)], { ...settings, retireAfterMisses: 1 });
    await run();
    await run();
    expect(repo.assets.get('100')!.retiredAt).toBeInstanceOf(Date);
  });

  it('an asset that re-appears after one miss starts counting from zero again', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    const { repo, run } = rig([walk(all), walk(rest), walk(all), walk(rest), walk(rest)]);
    await run();
    await run(); // miss 1
    await run(); // back
    expect(repo.assets.get('100')!.retiredAt).toBeNull();
    const again = await run(); // miss 1 again, not 2
    expect(again.details.retired).toBe(0);
    expect(repo.assets.get('100')!.retiredAt).toBeNull();
    const last = await run(); // second consecutive miss
    expect(last.details.retired).toBe(1);
  });

  it('an incomplete walk between two misses neither resets nor advances the counter', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    const { run } = rig([
      walk(all),
      walk(rest),
      walk(rest, { complete: false, total: 100 }),
      walk(rest),
    ]);
    await run();
    await run();
    await run();
    const r = await run();
    expect(r.details.retired).toBe(1);
  });

  it('retires nothing and alerts when more than 5% would go (all counters still advance)', async () => {
    const all = ids(100);
    const rest = all.slice(0, 90); // 10% disappear
    const { repo, run, alerts } = rig([walk(all), walk(rest), walk(rest), walk(rest)]);
    await run();
    await run();
    const blocked = await run();
    expect(blocked.details).toMatchObject({ retired: 0 });
    expect(blocked.details.warnings[0]).toMatchObject({
      code: 'retire_blocked',
      wouldRetire: 10,
      active: 100,
    });
    expect(alerts).toContain('retire_blocked');
    expect([...repo.assets.values()].filter((a) => a.retiredAt)).toHaveLength(0);
    expect(repo.runs.at(-1)!.status).toBe('partial');
  });

  it('exactly 5% is allowed; more than 5% is not', async () => {
    const all = ids(100);
    const five = all.slice(0, 95);
    const six = all.slice(0, 94);
    const a = rig([walk(all), walk(five), walk(five)]);
    await a.run();
    await a.run();
    expect((await a.run()).details.retired).toBe(5);
    const b = rig([walk(all), walk(six), walk(six)]);
    await b.run();
    await b.run();
    const blocked = await b.run();
    expect(blocked.details.retired).toBe(0);
    expect(blocked.details.warnings[0]?.code).toBe('retire_blocked');
  });

  it('an empty complete walk cannot wipe the catalogue', async () => {
    const all = ids(20);
    const { repo, run } = rig([walk(all), walk([]), walk([])]);
    await run();
    await run();
    const r = await run();
    expect(r.details.retired).toBe(0);
    expect(r.details.warnings[0]?.code).toBe('retire_blocked');
    expect([...repo.assets.values()].every((a) => !a.retiredAt)).toBe(true);
  });

  it('a retired asset that comes back is active again', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    const { repo, run } = rig([walk(all), walk(rest), walk(rest), walk(all)]);
    for (let k = 0; k < 3; k++) await run();
    expect(repo.assets.get('100')!.retiredAt).not.toBeNull();
    const back = await run();
    expect(back.details.reappeared).toBe(1);
    expect(repo.assets.get('100')!.retiredAt).toBeNull();
  });

  it('an asset seen in an incomplete walk starts from zero again', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    const { repo, run } = rig([
      walk(all),
      walk(rest), // complete miss 1
      walk(all, { complete: false, total: 101 }), // incomplete, but 100 is in it
      walk(rest), // complete: only miss 1 again
      walk(rest),
    ]);
    for (let k = 0; k < 4; k++) await run();
    expect(repo.assets.get('100')!.retiredAt).toBeNull();
    expect((await run()).details.retired).toBe(1);
  });

  it('with fewer complete runs on record than the rule needs, nothing is due', async () => {
    const all = ids(100);
    const rest = all.slice(0, 99);
    // Existing rows but no complete run on record (for example runs pruned): no retire.
    const { repo, run } = rig([walk(rest)]);
    for (const a of all) {
      await repo.insertAssets('datoms', [
        {
          externalId: a.externalId,
          name: a.name ?? '',
          sourceTypeName: null,
          assetTypeId: null,
          projectId: null,
          nameplate: {},
          sourceCreatedAt: null,
          kind: null,
          sourceLifecycleStatus: null,
          seenAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    }
    const r = await run();
    expect(r.details).toMatchObject({ missed: 1, retired: 0 });
  });

  it('a failed walk writes a failed sync_run and rethrows', async () => {
    const repo = new InMemoryCatalogueRepository(types);
    await expect(
      runCatalogueSync({
        connector: { sourceSystem: 'datoms', listAssets: () => Promise.reject(new Error('boom')) },
        repo,
        settings,
      }),
    ).rejects.toThrow('boom');
    expect(repo.runs[0]).toMatchObject({ status: 'failed', error: { message: 'boom' } });
  });
});
