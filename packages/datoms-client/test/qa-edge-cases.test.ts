// QA edge-case tests for S2-02 (docs/07 section 4). Test-only; no feature code changed.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetTracker,
  DatomsApi,
  DatomsApiError,
  DatomsClient,
  DatomsHttp,
  DatomsNetworkError,
  InMemoryBudgetStore,
  InMemoryPageSizeStore,
  REQUEST_TIMEOUT_MS,
  mapBulkRows,
  parseRetryAfter,
  withRetry,
  type DatomsResponse,
  type MappedBulkPage,
} from '../src/index.js';
import {
  TEST_TOKEN,
  errorReply,
  fakeFetch,
  fixture,
  rig,
  syntheticRows,
  testConfig,
} from './helpers.js';

const credits = { 'X-RateLimit-Unit': 'asset-read-credits', 'X-RateLimit-Limit': '2000' };
const T0 = Date.parse('2026-10-12T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fleet/id bulk fake. `tooLarge(limit, page)` decides when to answer 422. */
function bulkServer(total: number, tooLarge: (limit: number, page: number) => boolean) {
  const rows = syntheticRows(total);
  return fakeFetch((call) => {
    const b = call.body as { page?: number; limit?: number; asset_ids?: string[] };
    if (b.asset_ids) {
      if (tooLarge(b.asset_ids.length, 1))
        return errorReply(422, 'PAGE_RESPONSE_TOO_LARGE', credits);
      return {
        body: {
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

const bodyOf = (c: { body: unknown }) => c.body as { page: number; limit: number };

// -----------------------------------------------------------------------------------------------
describe('QA: 422 resume page (odd limits, limit 1, no gap)', () => {
  // Independent restatement of the docs/07 formula.
  const resume = (page: number, limit: number) =>
    Math.floor(((page - 1) * limit) / Math.max(1, Math.floor(limit / 2))) + 1;

  it.each([
    // [startLimit, page that first fails, expected next call]
    [499, 3, { page: 5, limit: 249 }], // floor(998/249)+1
    [7, 2, { page: 3, limit: 3 }], // floor(7/3)+1
    [3, 2, { page: 4, limit: 1 }], // 3 -> 1, floor(3/1)+1
    [2, 4, { page: 7, limit: 1 }], // 2 -> 1, floor(6/1)+1
    [5, 1, { page: 1, limit: 2 }], // page 1 stays page 1
  ])('limit %i failing on page %i resumes at %o', async (start, failPage, expected) => {
    const store = new InMemoryPageSizeStore({ limit: start, learnedAt: T0 });
    const s = bulkServer(1600, (limit, page) => limit === start && page === failPage);
    const r = rig(s.impl, { pageSizes: store });
    await drain(r.api.walkFleet());
    const i = s.calls.findIndex((c) => bodyOf(c).page === failPage && bodyOf(c).limit === start);
    expect(bodyOf(s.calls[i + 1]!)).toEqual(expected);
    expect(resume(failPage, start)).toBe(expected.page);
  });

  it.each([2, 3, 5, 7, 11, 499])(
    'no row is skipped when limit %i is halved at any page',
    async (start) => {
      const total = 53;
      const pagesAtStart = Math.ceil(total / start);
      for (let failPage = 1; failPage <= pagesAtStart; failPage++) {
        const store = new InMemoryPageSizeStore({ limit: start, learnedAt: T0 });
        const s = bulkServer(total, (limit, page) => limit === start && page === failPage);
        const r = rig(s.impl, { pageSizes: store });
        const ids = (await drain(r.api.walkFleet())).flatMap((p) =>
          p.readings.map((x) => x.externalAssetId),
        );
        const want = syntheticRows(total).map((x) => x.asset_id);
        expect(new Set(ids), `start ${start} failPage ${failPage}`).toEqual(new Set(want));
      }
    },
  );

  it('limit 1 that still gets 422 is an error with no further call', async () => {
    const store = new InMemoryPageSizeStore({ limit: 1, learnedAt: T0 });
    const s = bulkServer(5, () => true);
    const r = rig(s.impl, { pageSizes: store });
    const err = await drain(r.api.walkFleet()).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).status).toBe(422);
    expect(s.calls).toHaveLength(1);
  });

  it('a walk that ends at limit 1 completes and remembers 1', async () => {
    const store = new InMemoryPageSizeStore({ limit: 3, learnedAt: T0 });
    const s = bulkServer(7, (limit) => limit > 1);
    const r = rig(s.impl, { pageSizes: store });
    const pages = await drain(r.api.walkFleet());
    expect(pages.flatMap((p) => p.readings)).toHaveLength(7);
    expect((await store.get())?.limit).toBe(1);
  });

  it('a 422 with another error code is not treated as "too large"', async () => {
    const { impl, calls } = fakeFetch(() => errorReply(422, 'SOMETHING_ELSE'));
    const err = await drain(rig(impl).api.walkFleet()).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect(calls).toHaveLength(1);
  });
});

describe('QA: id-mode split', () => {
  it('splits an odd list floor(n/2) / rest and keeps request order', async () => {
    const s = bulkServer(3, (n) => n > 1);
    const ids = syntheticRows(3).map((r) => r.asset_id);
    const out = await rig(s.impl).api.bulkByIds(ids);
    const sizes = s.calls.map((c) => (c.body as { asset_ids: string[] }).asset_ids.length);
    expect(sizes).toEqual([3, 1, 2, 1, 1]);
    expect(out.readings.map((r) => r.externalAssetId)).toEqual(ids);
  });

  it('a single id that still gets 422 is an error, after splitting down to one', async () => {
    const s = bulkServer(5, () => true);
    const ids = syntheticRows(5).map((r) => r.asset_id);
    const err = await rig(s.impl)
      .api.bulkByIds(ids)
      .catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).status).toBe(422);
    expect(s.calls.map((c) => (c.body as { asset_ids: string[] }).asset_ids.length)).toEqual([
      5, 2, 1,
    ]);
  });

  it('a list of exactly 1 id is never split', async () => {
    const s = bulkServer(1, () => true);
    await expect(rig(s.impl).api.bulkByIds(['1000'])).rejects.toBeInstanceOf(DatomsApiError);
    expect(s.calls).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------------------------
describe('QA: 429 Retry-After and the retry matrix', () => {
  afterEach(() => vi.useRealTimers());

  const res = (status: number, retryAfter?: string): DatomsResponse => ({
    status,
    ok: status < 300,
    rateLimit: retryAfter !== undefined ? { retryAfter } : {},
    durationMs: 1,
  });

  it('Retry-After in seconds, fractional seconds round up', () => {
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('1.2')).toBe(1200);
    expect(parseRetryAfter('120')).toBe(120_000);
  });

  it('Retry-After as an HTTP date, in the past gives 0, in the future gives the gap', () => {
    expect(parseRetryAfter('Mon, 12 Oct 2026 12:01:30 GMT', T0)).toBe(90_000);
    expect(parseRetryAfter('Mon, 12 Oct 2026 11:00:00 GMT', T0)).toBe(0);
  });

  it('withRetry waits the HTTP-date gap taken from the real clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const waits: number[] = [];
    let n = 0;
    const out = await withRetry(
      () => Promise.resolve(++n === 1 ? res(429, 'Mon, 12 Oct 2026 12:00:20 GMT') : res(200)),
      { sleep: (ms) => (waits.push(ms), Promise.resolve()) },
    );
    expect(out.status).toBe(200);
    expect(waits).toEqual([20_000]);
  });

  it('429 forever: 5 tries in total, then DatomsApiError(rate_limited), waits = Retry-After each time', async () => {
    const { impl, calls } = fakeFetch(() =>
      errorReply(429, 'RATE_LIMITED', { 'Retry-After': '3' }),
    );
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).kind).toBe('rate_limited');
    expect(calls).toHaveLength(5);
    expect(r.waits).toEqual([3000, 3000, 3000, 3000]);
  });

  it.each([500, 502, 503, 504])('%i is retried and capped at 5 tries', async (status) => {
    const { impl, calls } = fakeFetch(() => errorReply(status, 'X'));
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect((err as DatomsApiError).kind).toBe('server');
    expect(calls).toHaveLength(5);
    expect(r.waits).toHaveLength(4);
    // jitter fixed at 0.5 -> 75% of 1 s, 2 s, 4 s, 8 s
    expect(r.waits).toEqual([750, 1500, 3000, 6000]);
  });

  it('every attempt (including failed ones) is written to the call store', async () => {
    const { impl } = fakeFetch(() => errorReply(503, 'X'));
    const r = rig(impl);
    await r.api.bulkByIds(['1']).catch(() => undefined);
    expect(r.callStore.records).toHaveLength(5);
    expect(r.callStore.records.every((x) => x.credits === 0)).toBe(true);
  });

  it.each([400, 401, 403])('%i is never retried by any walker', async (status) => {
    for (const run of [
      (a: DatomsApi) => a.collectAssets(),
      (a: DatomsApi) => drain(a.walkFleet()),
      (a: DatomsApi) => a.bulkByIds(['1']),
    ]) {
      const { impl, calls } = fakeFetch(() => errorReply(status, 'X'));
      const r = rig(impl);
      await expect(run(r.api)).rejects.toBeInstanceOf(DatomsApiError);
      expect(calls).toHaveLength(1);
      expect(r.waits).toEqual([]);
    }
  });

  it('network errors are retried 5 times and the thrown message has no token', async () => {
    let n = 0;
    const impl = (async () => {
      n++;
      throw new Error(`connect ECONNRESET with ${TEST_TOKEN}`);
    }) as unknown as typeof fetch;
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsNetworkError);
    expect(n).toBe(5);
    expect(String((err as Error).message)).not.toContain(TEST_TOKEN);
    for (const l of r.lines) expect(l).not.toContain(TEST_TOKEN);
  });
});

describe('QA: 30 s timeout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the default request timeout handed to AbortSignal is exactly 30 000 ms', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const { impl } = fakeFetch(() => ({ body: { data: [] } }));
    await new DatomsHttp(testConfig, impl).request('POST', '/x', {});
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(spy).toHaveBeenCalledWith(30_000);
  });

  it('a timed-out request is retried like a network error, 5 tries in all', async () => {
    let n = 0;
    const hang = ((_u: unknown, init?: RequestInit) => {
      n++;
      return new Promise((_ok, fail) => {
        init?.signal?.addEventListener('abort', () =>
          fail(new DOMException('timed out', 'TimeoutError')),
        );
      });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const api = new DatomsApi({
      client: new DatomsClient(testConfig, hang, 5),
      budget: new BudgetTracker({ fleetSize: 500, maxShare: 1 }),
      pageSizes: new InMemoryPageSizeStore(),
      sleep: (ms) => (waits.push(ms), Promise.resolve()),
      retry: { random: () => 0.5 },
    });
    await expect(api.bulkByIds(['1'])).rejects.toBeInstanceOf(DatomsNetworkError);
    expect(n).toBe(5);
    expect(waits).toHaveLength(4);
  });

  // BUG (see QA report): a failure while READING the body (after the headers arrived, including the
  // 30 s abort firing mid-body) escapes http.ts as a raw TypeError/AbortError and is not retried.
  it.todo(
    'a body-read failure is wrapped as DatomsNetworkError and retried (http.ts: await res.text() is outside the try)',
  );
});

// -----------------------------------------------------------------------------------------------
describe('QA: budget tracker at 90% of EVERY cap, max_share, adaptive interval', () => {
  const mk = (share = 1, allowance?: number) => {
    const clock = { t: T0 };
    const b = new BudgetTracker({
      fleetSize: 500,
      maxShare: share,
      ...(allowance !== undefined ? { monthlyAllowance: allowance } : {}),
      now: () => clock.t,
    });
    return { b, clock };
  };

  // [name, window ms, cap at share 1]
  const WINDOWS: [string, number, number][] = [
    ['1m', MIN, 4 * 500],
    ['5m', 5 * MIN, 8 * 500],
    ['1h', HOUR, 100 * 500],
    ['24h', DAY, 2500 * 500],
    ['30d', 30 * DAY, 60000 * 500],
  ];

  describe.each([1, 0.5, 0.1])('max_share %s', (share) => {
    it.each(WINDOWS)(
      '%s: exactly 90%% fits, one more credit waits until the old call leaves',
      (_n, ms, cap0) => {
        const { b } = mk(share);
        const limit = 0.9 * cap0 * share;
        const spent = Math.floor(limit) - 1;
        b.record(T0 - ms / 2, spent, 1);
        expect(b.check(1).allowed).toBe(true); // spent + 1 <= 90%
        const d = b.check(2); // spent + 2 > 90% (limit is an integer or x.5 here)
        expect(d.allowed).toBe(false);
        expect(d.waitMs).toBe(ms / 2); // the old call leaves the window after half of it
      },
    );
  });

  it('exactly at the 90% line is allowed, one credit past it is not (1m, share 1)', () => {
    const { b } = mk();
    expect(b.check(1800).allowed).toBe(true);
    expect(b.check(1801).allowed).toBe(false);
  });

  it('the request-count window (240/min) also stops at 90% and honours max_share', () => {
    const full = mk();
    full.b.record(T0 - 30_000, 0, 216);
    expect(full.b.check(1)).toMatchObject({ allowed: false, waitMs: 30_000 });
    const half = mk(0.5);
    half.b.record(T0 - 30_000, 0, 108);
    expect(half.b.check(1)).toMatchObject({ allowed: false, waitMs: 30_000 });
    const ok = mk(0.5);
    ok.b.record(T0 - 30_000, 0, 107);
    expect(ok.b.check(1).allowed).toBe(true);
  });

  it('the monthly allowance is also capped at 90% (times max_share)', () => {
    const { b } = mk(1, 1_000_000);
    b.record(T0 - DAY, 899_999, 1);
    expect(b.check(1).allowed).toBe(true);
    expect(b.check(2).allowed).toBe(false);
  });

  it('a call larger than 90% of a cap is a skip (Infinity), not a wait', () => {
    const { b } = mk(0.1); // 1m cap 200, 90% = 180
    expect(b.check(181).waitMs).toBe(Infinity);
    expect(b.check(180).allowed).toBe(true);
  });

  it('adaptive interval: strictly above 80% -> x2, strictly above 90% -> x5 (every window)', () => {
    for (const [name, ms, cap] of WINDOWS) {
      const at = (credits: number) => {
        const { b } = mk();
        b.record(T0 - ms / 2, credits, 1);
        return b.slowdownFactor();
      };
      expect(at(0.8 * cap), `${name} at 80%`).toBe(1);
      expect(at(0.8 * cap + 1), `${name} just over 80%`).toBe(2);
      expect(at(0.9 * cap), `${name} at 90%`).toBe(2);
      expect(at(0.9 * cap + 1), `${name} just over 90%`).toBe(5);
    }
  });

  it('adaptive interval follows max_share and returns to 1 when the window clears', () => {
    const { b, clock } = mk(0.1); // 1m cap 200
    b.record(T0, 161, 1);
    expect(b.slowdownFactor()).toBe(2);
    b.record(T0, 20, 1);
    expect(b.slowdownFactor()).toBe(5);
    clock.t += MIN + 1;
    expect(b.slowdownFactor()).toBe(1);
  });

  it('adaptive interval also reacts to request-rate pressure', () => {
    const { b } = mk();
    b.record(T0, 0, 193); // > 80% of 240
    expect(b.slowdownFactor()).toBe(2);
  });

  it('no Unit header: Limit/Remaining are ignored, so Remaining 0 does not block', () => {
    const { b } = mk();
    b.applyHeaders({ limit: '60', remaining: '0', reset: '60' });
    expect(b.check(100).allowed).toBe(true);
    b.applyHeaders({ unit: 'requests', limit: '240', remaining: '0', reset: '60' });
    expect(b.check(100).allowed).toBe(true);
  });

  it('Unit asset-read-credits with Remaining 0 waits for Reset, then is allowed again', () => {
    const { b, clock } = mk();
    b.applyHeaders({ unit: 'asset-read-credits', limit: '2000', remaining: '0', reset: '30' });
    expect(b.check(1)).toMatchObject({ allowed: false, waitMs: 30_000 });
    clock.t += 30_001;
    expect(b.check(1).allowed).toBe(true);
  });

  it('Unit given but Reset missing falls back to a 60 s window', () => {
    const { b } = mk();
    b.applyHeaders({ unit: 'asset-read-credits', remaining: '0' });
    expect(b.check(1)).toMatchObject({ allowed: false, waitMs: 60_000 });
  });

  it('a restart restores usage so the 90% rule still holds', async () => {
    const store = new InMemoryBudgetStore();
    await store.append({
      at: T0 - 10_000,
      endpoint: '/x',
      mode: 'fleet',
      status: 200,
      durationMs: 1,
      credits: 1800,
      requests: 1,
      correlationId: 'c',
    });
    const { b } = mk();
    await b.restore(store);
    expect(b.check(1).allowed).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------------
describe('QA: paging walkers stop at total_pages', () => {
  it('fleet walker trusts the response total_pages, never asks for one more page', async () => {
    const rows = syntheticRows(30);
    const { impl, calls } = fakeFetch((c) => {
      const { page, limit } = c.body as { page: number; limit: number };
      return {
        body: {
          data: rows.slice((page - 1) * limit, page * limit),
          pagination: { total: 30, page, limit, total_pages: 2 },
        },
        headers: credits,
      };
    });
    const pages = await drain(rig(impl).api.walkFleet());
    expect(pages).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('catalogue walker stops at total_pages even if the server would keep serving rows', async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { data: [], pagination: { total: 0, page: 1, limit: 1000, total_pages: 1 } },
    }));
    await rig(impl).api.collectAssets();
    expect(calls).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------------------------
describe('QA: ADR 0010 at run time', () => {
  it('walkAssets, walkFleet and bulkByIds only ever call /assets and the bulk query', async () => {
    const rows = syntheticRows(5);
    const { impl, calls } = fakeFetch((c) => {
      if (c.method === 'GET')
        return {
          body: { data: [], pagination: { total: 0, page: 1, limit: 1000, total_pages: 1 } },
        };
      const b = c.body as { page?: number; limit?: number; asset_ids?: string[] };
      return b.asset_ids
        ? { body: { data: rows }, headers: credits }
        : {
            body: { data: rows, pagination: { total: 5, page: 1, limit: 500, total_pages: 1 } },
            headers: credits,
          };
    });
    const r = rig(impl);
    await r.api.collectAssets();
    await drain(r.api.walkFleet());
    await r.api.bulkByIds(['1000']);
    expect(calls.length).toBe(3);
    for (const c of calls) {
      expect(c.path).not.toMatch(/data\/latest/);
      expect(c.path).toMatch(/^\/assets(\?|\/telemetry\/latest\/query$)/);
    }
    expect(calls.filter((c) => c.method === 'POST').length).toBe(2);
    expect(calls.every((c) => c.method === 'GET' || c.method === 'POST')).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------
describe('QA: hard rule 1 in the mapping', () => {
  const T = '2026-10-12T10:00:00Z';

  it('null stays null, 0/false/"" stay as sent, a missing key stays missing', () => {
    const parameters = { a: null, b: 0, c: false, d: '', mc_st: null, lat: 25.2, long: 55.3 };
    const out = mapBulkRows([{ asset_id: '9', success: true, data: { time: T, parameters } }]);
    const v = out.readings[0]!.values;
    expect(v).toStrictEqual(parameters);
    expect(v['a']).toBeNull();
    expect('zzz' in v).toBe(false);
  });

  it('lat/long/mc_st/under_maintenance create no status, location, site, type, kind or alert', () => {
    const parameters = { lat: 25.2, long: 55.3, mc_st: 1, under_maintenance: true };
    const [reading] = mapBulkRows([
      { asset_id: '9', success: true, data: { time: T, parameters } },
    ]).readings;
    expect(Object.keys(reading!).sort()).toEqual(['externalAssetId', 'ts', 'values']);
    expect(reading!.values).toStrictEqual(parameters);
  });

  it('every recorded bulk row passes through unchanged, null for null', () => {
    const body = fixture<{ data: Parameters<typeof mapBulkRows>[0] }>(
      'bulk-latest-id-mode.json',
    ).body;
    const out = mapBulkRows(body.data);
    expect(out.readings.length).toBe(body.data.length);
    for (const row of body.data) {
      const m = out.readings.find((x) => x.externalAssetId === row.asset_id)!;
      expect(m.values).toStrictEqual(row.data!.parameters);
    }
  });

  it('an empty parameters object is a reading with no values, not a zero-filled one', () => {
    const out = mapBulkRows([{ asset_id: '9', success: true, data: { time: T, parameters: {} } }]);
    expect(out.readings[0]!.values).toStrictEqual({});
  });

  it('success:false rows give no reading at all (no invented zero reading)', () => {
    const out = mapBulkRows([{ asset_id: '9', success: false }]);
    expect(out.readings).toHaveLength(0);
    expect(out.noData).toEqual(['9']);
  });

  it('an unparsable time is invalid, not "now"', () => {
    const out = mapBulkRows([
      { asset_id: '9', success: true, data: { time: 'not-a-date', parameters: { a: 1 } } },
    ]);
    expect(out.readings).toHaveLength(0);
    expect(out.invalid).toEqual(['9']);
  });
});

// -----------------------------------------------------------------------------------------------
describe('QA: fixtures contain no secrets', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('there are fixtures to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no bearer, authorization, token, secret or key text', (f) => {
    const text = readFileSync(join(dir, f), 'utf8');
    expect(text).not.toMatch(/bearer|authori[sz]ation|token|secret|api[-_]?key|password/i);
  });

  it.each(files)('%s meta holds only path, method, date, status and rate-limit headers', (f) => {
    const { meta } = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      meta: { rateLimit: Record<string, string> } & Record<string, unknown>;
    };
    expect(Object.keys(meta).sort()).toEqual(['date', 'endpoint', 'method', 'rateLimit', 'status']);
    for (const k of Object.keys(meta.rateLimit))
      expect(['unit', 'limit', 'remaining', 'reset', 'retryAfter']).toContain(k);
    expect(String(meta['endpoint'])).not.toMatch(/^https?:/);
  });
});
