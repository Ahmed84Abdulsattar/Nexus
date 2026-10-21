import { describe, expect, it } from 'vitest';
import {
  BudgetTracker,
  MAX_ASSET_INFO_BYTES,
  MAX_CATALOGUE_ASSETS,
  type RawAsset,
} from '../src/index.js';
import { DatomsHttp, readCappedText } from '../src/http.js';
import { fakeFetch, rig, syntheticAssets, testConfig } from './helpers.js';

const page = (data: unknown[], total: number, limit = 1000) => ({
  body: { data, pagination: { total, page: 1, limit, total_pages: 1 } },
});

describe('M3: duplicate ids never make a walk complete', () => {
  it('total 22, 22 rows with one duplicate id: complete=false', async () => {
    const rows = syntheticAssets(22);
    rows[21] = { ...rows[21]!, id: rows[0]!.id };
    const { impl } = fakeFetch(() => page(rows, 22));
    const out = await rig(impl).api.collectAssets();
    expect(out.assets).toHaveLength(22);
    expect(out.complete).toBe(false);
  });
});

describe('M5: catalogue rows are validated and capped', () => {
  it('drops invalid rows (count only) and the walk is not complete', async () => {
    const rows: unknown[] = [
      ...syntheticAssets(3),
      { id: '', name: 'empty id' },
      { id: 7, name: 'x'.repeat(513) },
      { id: 8, category_name: 5 },
      { id: 9, asset_info: { blob: 'y'.repeat(MAX_ASSET_INFO_BYTES) } },
    ];
    const { impl } = fakeFetch(() => page(rows, 7));
    const out = await rig(impl).api.collectAssets();
    expect(out.assets).toHaveLength(3);
    expect(out.invalidRows).toBe(4);
    expect(out.complete).toBe(false);
  });

  it('accepts an integer id and a null name', async () => {
    const rows = [{ id: 5, name: null, category_name: 'DG Set' }] as unknown as RawAsset[];
    const { impl } = fakeFetch(() => page(rows, 1));
    const out = await rig(impl).api.collectAssets();
    expect(out.assets[0]).toMatchObject({ externalId: '5', name: undefined });
    expect(out.complete).toBe(true);
  });

  it('caps rows per page at the limit: capped, not complete', async () => {
    const { impl } = fakeFetch(() => page(syntheticAssets(10), 5, 5));
    const out = await rig(impl).api.collectAssets(5);
    expect(out.assets).toHaveLength(5);
    expect(out.capped).toBe(true);
    expect(out.complete).toBe(false);
  });

  it('caps the total at MAX_CATALOGUE_ASSETS', async () => {
    const limit = 1000;
    const pages = Math.ceil((MAX_CATALOGUE_ASSETS + 3000) / limit);
    const { impl } = fakeFetch((call) => {
      const p = Number(new URL('http://x' + call.path).searchParams.get('page'));
      const data = Array.from({ length: limit }, (_, i) => ({ id: `${p}-${i}`, name: 'n' }));
      return {
        body: {
          data,
          pagination: { total: pages * limit, page: p, limit, total_pages: pages },
        },
      };
    });
    const out = await rig(impl).api.collectAssets(limit);
    expect(out.assets).toHaveLength(MAX_CATALOGUE_ASSETS);
    expect(out.capped).toBe(true);
    expect(out.complete).toBe(false);
  });
});

describe('M5: response size cap', () => {
  const bodyOf = (bytes: number, headers: Record<string, string> = {}) =>
    new Response(new Blob([new Uint8Array(bytes).fill(97)]), { headers });

  it('refuses by content-length', async () => {
    const res = bodyOf(10, { 'content-length': '999' });
    await expect(readCappedText(res, 100)).rejects.toThrow(/too large/);
  });

  it('counts bytes while streaming when there is no content-length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(40).fill(97));
        c.close();
      },
    });
    await expect(readCappedText(new Response(stream), 100)).rejects.toThrow(/too large/);
    expect(await readCappedText(bodyOf(50), 100)).toHaveLength(50);
  });

  it('DatomsHttp turns it into a network error without the token', async () => {
    const big = (async () => bodyOf(500, {})) as unknown as typeof fetch;
    const http = new DatomsHttp(testConfig, big, 5_000, { maxResponseBytes: 100 });
    await expect(http.request('GET', '/assets')).rejects.toThrow(/failed: DatomsNetworkError/);
  });
});

describe('M4: the budget share can change while running', () => {
  it('setMaxShare changes the caps and refuses bad values', () => {
    const b = new BudgetTracker({ fleetSize: 500, maxShare: 1 });
    const before = b.check(400, 'bulk');
    expect(before.allowed).toBe(true);
    b.setMaxShare(0.1);
    expect(b.maxShare).toBe(0.1);
    expect(b.check(400, 'bulk').allowed).toBe(false);
    expect(() => b.setMaxShare(0)).toThrow();
    expect(() => b.setMaxShare(1.5)).toThrow();
    expect(b.maxShare).toBe(0.1);
  });
});
