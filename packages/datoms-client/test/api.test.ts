import { describe, expect, it } from 'vitest';
import {
  BudgetSkippedError,
  DatomsApiError,
  InMemoryPageSizeStore,
  type MappedBulkPage,
} from '../src/index.js';
import {
  TEST_TOKEN,
  errorReply,
  fakeFetch,
  fixture,
  rig,
  syntheticAssets,
  syntheticRows,
  type FakeCall,
} from './helpers.js';

const credits = { 'X-RateLimit-Unit': 'asset-read-credits', 'X-RateLimit-Limit': '2000' };

/** A fake DATOMS asset list that pages like the real one. */
function assetListServer(total: number, maxCalls = Infinity) {
  const all = syntheticAssets(total);
  return fakeFetch((call, n) => {
    if (n > maxCalls) return errorReply(500, 'INTERNAL');
    const u = new URL('https://x' + call.path);
    const page = Number(u.searchParams.get('page'));
    const limit = Number(u.searchParams.get('limit'));
    return {
      body: {
        success: true,
        data: all.slice((page - 1) * limit, page * limit),
        pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
      },
      headers: {
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '59',
        'X-RateLimit-Reset': '60',
      },
    };
  });
}

/** A fake bulk endpoint. `tooLarge(limit, page)` decides when to answer 422. */
function bulkServer(
  total: number,
  tooLarge: (limit: number, page: number) => boolean = () => false,
) {
  const rows = syntheticRows(total);
  return fakeFetch((call) => {
    const b = call.body as { page?: number; limit?: number; asset_ids?: string[] };
    if (b.asset_ids) {
      if (tooLarge(b.asset_ids.length, 1))
        return errorReply(422, 'PAGE_RESPONSE_TOO_LARGE', credits);
      return {
        body: {
          success: true,
          data: b.asset_ids.map(
            (id) => rows.find((r) => r.asset_id === id) ?? { asset_id: id, success: false },
          ),
        },
        headers: credits,
      };
    }
    const { page = 1, limit = 500 } = b;
    if (tooLarge(limit, page)) return errorReply(422, 'PAGE_RESPONSE_TOO_LARGE', credits);
    return {
      body: {
        success: true,
        data: rows.slice((page - 1) * limit, page * limit),
        pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
      },
      headers: credits,
    };
  });
}

async function drain(gen: AsyncGenerator<MappedBulkPage>): Promise<MappedBulkPage[]> {
  const pages: MappedBulkPage[] = [];
  for await (const p of gen) pages.push(p);
  return pages;
}

describe('catalogue paging walker (GET /assets)', () => {
  it('walks every page until page >= total_pages and reports a complete walk', async () => {
    const s = assetListServer(2500);
    const { api } = rig(s.impl);
    const out = await api.collectAssets(1000);
    expect(s.calls.map((c) => c.path)).toEqual([
      '/assets?page=1&limit=1000',
      '/assets?page=2&limit=1000',
      '/assets?page=3&limit=1000',
    ]);
    expect(out.assets).toHaveLength(2500);
    expect(out.total).toBe(2500);
    expect(out.complete).toBe(true);
  });

  it('hands pages out one at a time (next page is fetched only when asked)', async () => {
    const s = assetListServer(2500);
    const { api } = rig(s.impl);
    const it = api.walkAssets(1000);
    await it.next();
    expect(s.calls).toHaveLength(1);
    await it.next();
    expect(s.calls).toHaveLength(2);
  });

  it('walks the recorded list in one page', async () => {
    const recorded = fixture('assets-list-page1.json').body;
    const { impl, calls } = fakeFetch(() => ({ body: recorded }));
    const out = await rig(impl).api.collectAssets();
    expect(calls).toHaveLength(1);
    expect(out.assets).toHaveLength(22);
    expect(out.complete).toBe(true);
  });

  it('a walk that saw fewer rows than pagination.total is NOT complete', async () => {
    const { impl } = fakeFetch(() => ({
      body: {
        data: syntheticAssets(5),
        pagination: { total: 9, page: 1, limit: 1000, total_pages: 1 },
      },
    }));
    const out = await rig(impl).api.collectAssets();
    expect(out.complete).toBe(false);
  });

  it('tolerates the missing Unit header on GET /assets', async () => {
    const s = assetListServer(3);
    const r = rig(s.impl);
    await r.api.collectAssets();
    expect(r.callStore.records[0]?.unit).toBeUndefined();
    expect(r.callStore.records[0]?.limit).toBe(60);
    expect(r.callStore.records[0]?.credits).toBe(0);
  });
});

describe('bulk fleet mode', () => {
  it('walks pages and maps rows', async () => {
    const s = bulkServer(1200);
    const { api } = rig(s.impl);
    const pages = await drain(api.walkFleet());
    expect(pages.map((p) => p.readings.length)).toEqual([500, 500, 200]);
    expect(s.calls.map((c) => c.body)).toEqual([
      { page: 1, limit: 500 },
      { page: 2, limit: 500 },
      { page: 3, limit: 500 },
    ]);
  });

  it('on 422 halves the page size and resumes at floor(((page-1)*limit)/new_limit)+1', async () => {
    // Page 1 of 500 is fine, page 2 of 500 is "too large": limit 500 -> 250, resume page 3.
    const s = bulkServer(1500, (limit, page) => limit > 250 && page >= 2);
    const r = rig(s.impl);
    const pages = await drain(r.api.walkFleet());
    expect(s.calls.map((c) => c.body)).toEqual([
      { page: 1, limit: 500 },
      { page: 2, limit: 500 }, // 422
      { page: 3, limit: 250 },
      { page: 4, limit: 250 },
      { page: 5, limit: 250 },
      { page: 6, limit: 250 },
    ]);
    const ids = pages.flatMap((p) => p.readings.map((x) => x.externalAssetId));
    expect(ids).toHaveLength(1500);
    expect(new Set(ids).size).toBe(1500); // no gap, no repeat
  });

  it('keeps halving down to 1 and gives up there', async () => {
    const s = bulkServer(10, () => true);
    const { api } = rig(s.impl);
    await expect(drain(api.walkFleet())).rejects.toBeInstanceOf(DatomsApiError);
    expect(s.calls.map((c) => (c.body as { limit: number }).limit)).toEqual([
      500, 250, 125, 62, 31, 15, 7, 3, 1,
    ]);
  });

  it('the 422 resume formula', async () => {
    // page 3, limit 500 -> new 250 -> floor(1000/250)+1 = 5
    const s = bulkServer(2000, (limit, page) => limit === 500 && page === 3);
    const { api } = rig(s.impl);
    await drain(api.walkFleet());
    expect(s.calls.map((c) => (c.body as { page: number }).page).slice(0, 4)).toEqual([1, 2, 3, 5]);
  });

  it('stores the learned page size and uses it next time', async () => {
    const s = bulkServer(600, (limit) => limit > 250);
    const r = rig(s.impl);
    await drain(r.api.walkFleet());
    expect((await r.pageSizes.get())?.limit).toBe(250);
    const s2 = bulkServer(600, (limit) => limit > 250);
    const r2 = rig(s2.impl, { pageSizes: r.pageSizes });
    await drain(r2.api.walkFleet());
    expect((s2.calls[0]?.body as { limit: number }).limit).toBe(250);
    expect(s2.calls).toHaveLength(3); // 250 + 250 + 100, no 422 this time
  });

  it('tries 500 again once a day and resets the store when it works', async () => {
    const store = new InMemoryPageSizeStore({ limit: 250, learnedAt: 0 });
    const s = bulkServer(300);
    const r = rig(s.impl, { pageSizes: store });
    await drain(r.api.walkFleet());
    expect((s.calls[0]?.body as { limit: number }).limit).toBe(500);
    expect((await store.get())?.limit).toBe(500);
  });

  it('does not retry 500 before a day has passed', async () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    const store = new InMemoryPageSizeStore({ limit: 250, learnedAt: now - 3_600_000 });
    const s = bulkServer(300);
    await drain(rig(s.impl, { pageSizes: store }).api.walkFleet());
    expect((s.calls[0]?.body as { limit: number }).limit).toBe(250);
  });
});

describe('bulk id mode', () => {
  it('returns mapped readings and no-data ids, in request order', async () => {
    const recorded = fixture<{ data: { asset_id: string }[] }>('bulk-latest-id-mode.json').body;
    const ids = recorded.data.map((r) => r.asset_id);
    const { impl, calls } = fakeFetch(() => ({ body: recorded, headers: credits }));
    const out = await rig(impl).api.bulkByIds([...ids, ...ids]); // duplicates collapse
    expect((calls[0]?.body as { asset_ids: string[] }).asset_ids).toEqual(ids);
    expect(out.readings.map((r) => r.externalAssetId)).toEqual(ids);
  });

  it('sends at most 500 ids per call', async () => {
    const s = bulkServer(1200);
    const ids = syntheticRows(1200).map((r) => r.asset_id);
    const out = await rig(s.impl).api.bulkByIds(ids);
    expect(
      s.calls.map((c: FakeCall) => (c.body as { asset_ids: string[] }).asset_ids.length),
    ).toEqual([500, 500, 200]);
    expect(out.readings).toHaveLength(1200);
  });

  it('on 422 splits the id list in two and keeps request order', async () => {
    const s = bulkServer(8, (n) => n > 2);
    const ids = syntheticRows(8).map((r) => r.asset_id);
    const out = await rig(s.impl).api.bulkByIds(ids);
    expect(out.readings.map((r) => r.externalAssetId)).toEqual(ids);
    const sizes = s.calls.map((c) => (c.body as { asset_ids: string[] }).asset_ids.length);
    expect(sizes).toEqual([8, 4, 2, 2, 4, 2, 2]);
  });

  it('unknown ids come back as no-data', async () => {
    const s = bulkServer(2);
    const out = await rig(s.impl).api.bulkByIds(['1000', '999999']);
    expect(out.readings).toHaveLength(1);
    expect(out.noData).toEqual(['999999']);
  });

  it('an empty list makes no call', async () => {
    const s = bulkServer(1);
    await rig(s.impl).api.bulkByIds([]);
    expect(s.calls).toHaveLength(0);
  });
});

describe('errors, retries and the budget around real calls', () => {
  it.each([
    [400, 'validation'],
    [401, 'auth'],
    [403, 'auth'],
  ])('%i is not retried and surfaces as %s', async (status, kind) => {
    const { impl, calls } = fakeFetch(() => errorReply(status, 'X'));
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).kind).toBe(kind);
    expect(calls).toHaveLength(1);
    expect(r.waits).toEqual([]);
  });

  it('429 waits Retry-After and then succeeds', async () => {
    const rows = syntheticRows(1);
    const { impl, calls } = fakeFetch((_c, n) =>
      n === 1
        ? errorReply(429, 'RATE_LIMITED', { 'Retry-After': '12' })
        : { body: { data: rows }, headers: credits },
    );
    const r = rig(impl);
    const out = await r.api.bulkByIds(['1000']);
    expect(out.readings).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(r.waits).toEqual([12_000]);
  });

  it('5xx backs off and then succeeds', async () => {
    const rows = syntheticRows(1);
    const { impl, calls } = fakeFetch((_c, n) =>
      n < 3 ? errorReply(503, 'UNAVAILABLE') : { body: { data: rows }, headers: credits },
    );
    const r = rig(impl);
    await r.api.bulkByIds(['1000']);
    expect(calls).toHaveLength(3);
    expect(r.waits).toEqual([750, 1500]); // jitter fixed at 0.5 -> 75% of 1 s, 2 s
  });

  it('records every call (credits, Unit first, headers) for integration.api_call', async () => {
    const s = bulkServer(3);
    const r = rig(s.impl);
    await r.api.bulkByIds(['1000', '1001', '1002']);
    expect(r.callStore.records).toHaveLength(1);
    const rec = r.callStore.records[0]!;
    expect(rec).toMatchObject({
      mode: 'id',
      status: 200,
      credits: 3,
      unit: 'asset-read-credits',
      limit: 2000,
    });
    expect(rec.correlationId).toBeTruthy();
    expect(r.budget.usage().find((u) => u.name === '1m')!.used).toBe(3);
  });

  it('a 422 is refunded: it costs no credits in the tracker', async () => {
    const s = bulkServer(4, (n) => n > 2);
    const r = rig(s.impl);
    await r.api.bulkByIds(['1000', '1001', '1002', '1003']);
    // 422 (0) + two halves of 2 credits each
    expect(r.budget.usage().find((u) => u.name === '1m')!.used).toBe(4);
  });

  it('skips the call when the budget says wait longer than the limit', async () => {
    const s = bulkServer(3);
    const r = rig(s.impl, { maxShare: 0.001 }); // 1m cap = 2: three ids can never fit
    await expect(r.api.bulkByIds(['1000', '1001', '1002'])).rejects.toBeInstanceOf(
      BudgetSkippedError,
    );
    expect(s.calls).toHaveLength(0);
  });

  it('waits a short budget delay before calling', async () => {
    const s = bulkServer(3);
    const r = rig(s.impl);
    r.budget.record(r.clock.t, 1799); // 1m window nearly full
    await r.api.bulkByIds(['1000', '1001', '1002']);
    expect(r.waits.length).toBeGreaterThan(0);
    expect(s.calls).toHaveLength(1);
  });

  it('logs endpoint, mode, status, duration, credits and rate-limit headers, but never the token', async () => {
    const s = bulkServer(2);
    const r = rig(s.impl);
    await r.api.bulkByIds(['1000', '1001']);
    const line = r.lines.find((l) => l.includes('DATOMS call'))!;
    expect(line).toContain('/assets/telemetry/latest/query');
    expect(line).toContain('"mode":"id"');
    expect(line).toContain('"status":200');
    expect(line).toContain('"credits":2');
    expect(line).toContain('asset-read-credits');
    expect(line).toContain('correlationId');
    for (const l of r.lines) expect(l).not.toContain(TEST_TOKEN);
  });

  it('errors and warnings do not contain the token either', async () => {
    const { impl } = fakeFetch(() => errorReply(401, 'UNAUTHORIZED'));
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect(String(err.message)).not.toContain(TEST_TOKEN);
    for (const l of r.lines) expect(l).not.toContain(TEST_TOKEN);
  });

  it('slowdownFactor reflects the budget and logs the change', () => {
    const s = bulkServer(1);
    const r = rig(s.impl);
    expect(r.api.slowdownFactor()).toBe(1);
    r.budget.record(r.clock.t, 1700);
    expect(r.api.slowdownFactor()).toBe(2);
    expect(r.lines.some((l) => l.startsWith('warn') && l.includes('slowing'))).toBe(true);
  });
});
