import { describe, expect, it } from 'vitest';
import {
  InMemoryCatalogueRepository,
  runCatalogueSync,
  sanitizeErrorText,
  type AssetTypeRef,
  type CatalogueSettings,
  type SourceAsset,
  type SourceCatalogue,
} from '../src/index.js';

const settings: CatalogueSettings = { retireAfterMisses: 2, retireMaxFraction: 0.05 };
const types: AssetTypeRef[] = [
  { id: 't-dg', code: 'diesel_generator', sourceNames: ['DG Set'] },
  { id: 't-gen', code: 'generic', sourceNames: [] },
];
const ids = (n: number): SourceAsset[] =>
  Array.from({ length: n }, (_, k) => ({
    externalId: String(k + 1),
    name: `Asset ${k + 1}`,
    sourceTypeName: 'DG Set',
  }));
const walk = (assets: SourceAsset[], over: Partial<SourceCatalogue> = {}): SourceCatalogue => ({
  assets,
  total: assets.length,
  complete: true,
  ...over,
});

function rig(walks: SourceCatalogue[]) {
  const repo = new InMemoryCatalogueRepository(types);
  let i = 0;
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const connector = {
    sourceSystem: 'datoms',
    listAssets: () => Promise.resolve(walks[Math.min(i++, walks.length - 1)]!),
  };
  const run = () =>
    runCatalogueSync({ connector, repo, settings, now: () => new Date((clock += 1000)) });
  return { repo, run };
}

describe('catalogue sync: security review fixes', () => {
  it('M3: total 22 with 22 rows and one duplicate id is NOT complete, and retires nothing', async () => {
    const all = ids(22);
    const dup = [...all.slice(0, 21), all[0]!]; // asset 22 missing, id 1 twice
    const { repo, run } = rig([walk(all), walk(dup), walk(dup)]);
    await run();
    for (let k = 0; k < 2; k++) {
      const r = await run();
      expect(r.details).toMatchObject({ complete: false, retired: 0, missed: 0 });
      expect(r.details.warnings).toEqual(
        expect.arrayContaining([{ code: 'duplicate_ids', count: 1 }]),
      );
    }
    expect(repo.assets.get('22')!.retiredAt).toBeNull();
  });

  it('M5: invalid rows and caps make the walk incomplete, with count-only warnings', async () => {
    const all = ids(10);
    const { run } = rig([walk(all), walk(all, { invalidRows: 2, capped: true })]);
    await run();
    const r = await run();
    expect(r.details.complete).toBe(false);
    expect(r.details.warnings).toEqual(
      expect.arrayContaining([{ code: 'invalid_rows', count: 2 }, { code: 'capped' }]),
    );
  });

  it('L6: records the mode in details', async () => {
    const repo = new InMemoryCatalogueRepository(types);
    const { details } = await runCatalogueSync({
      connector: { sourceSystem: 'datoms', listAssets: () => Promise.resolve(walk(ids(1))) },
      repo,
      settings,
      mode: 'fixtures',
    });
    expect(details.mode).toBe('fixtures');
  });

  it('L1: an aborted signal stops the sync before anything is written', async () => {
    const repo = new InMemoryCatalogueRepository(types);
    const ctl = new AbortController();
    const connector = {
      sourceSystem: 'datoms',
      listAssets: () => {
        ctl.abort(new Error('lock lost'));
        return Promise.resolve(walk(ids(3)));
      },
    };
    await expect(
      runCatalogueSync({ connector, repo, settings, signal: ctl.signal }),
    ).rejects.toThrow('lock lost');
    expect(repo.assets.size).toBe(0);
  });

  it('L2: error text is cut and cleaned, and SQLSTATE errors keep only name and code', () => {
    const text = sanitizeErrorText(new Error(`bad\u0000\n${'x'.repeat(1000)}`));
    expect(text.length).toBeLessThan(310);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u001f]/);
    const pgError = Object.assign(new Error('password=hunter2 host=db row (secret)'), {
      code: '23505',
    });
    expect(sanitizeErrorText(pgError)).toBe('Error (SQLSTATE 23505)');
    expect(sanitizeErrorText('str')).toBe('unknown error');
  });
});
