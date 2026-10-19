// Tests for the security review and QA findings of PR #11 (M1-M3, L1-L9, QA M1/L1-L4).
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pkg from '../src/index.js';
import {
  BudgetSkippedError,
  BudgetTracker,
  DatomsApi,
  DatomsApiError,
  DatomsClient,
  DatomsNetworkError,
  InMemoryPageSizeStore,
  MAX_RETRY_AFTER_MS,
  createDatomsConfig,
  defaultSleep,
  loadDatomsConfig,
  mapAsset,
  parseRetryAfter,
  withRetry,
  type DatomsResponse,
} from '../src/index.js';
import { DatomsHttp } from '../src/http.js';
import {
  assertValidId,
  latestPath,
  loadEnvFileKeepingLiveGate,
  validateIds,
} from '../scripts/guards.js';
import { fixturePath, saveFixture, serializeFixture } from '../scripts/record.js';
import {
  TEST_TOKEN,
  errorReply,
  fakeFetch,
  rig,
  syntheticAssets,
  syntheticRows,
  testConfig,
} from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');

afterEach(() => {
  vi.useRealTimers();
});

describe('M1: DATOMS_BASE_URL is validated', () => {
  const env = (url: string) => ({ DATOMS_BASE_URL: url, DATOMS_TOKEN: TEST_TOKEN });

  it('accepts the default and the real host', () => {
    expect(loadDatomsConfig(env('https://api.datoms.io/v4')).baseUrl).toBe(
      'https://api.datoms.io/v4',
    );
    expect(loadDatomsConfig({}).baseUrl).toBe('https://api.datoms.io/v4');
  });

  it.each([
    ['http://api.datoms.io/v4', 'https'],
    ['https://evil.example/v4', 'host'],
    ['https://api.datoms.io.evil.example/v4', 'host'],
    ['https://user:pw@api.datoms.io/v4', 'credentials'],
    ['https://api.datoms.io/v4?x=1', 'query'],
    ['https://api.datoms.io/v4#frag', 'query or fragment'],
    ['https://api.datoms.io:8443/v4', 'port'],
    ['not a url', 'valid URL'],
  ])('rejects %s', (url, word) => {
    let message = '';
    try {
      loadDatomsConfig(env(url));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(word);
    expect(message).not.toContain(TEST_TOKEN);
    expect(message).not.toContain('pw@');
  });

  it('another host needs an explicit allow-list', () => {
    expect(() => createDatomsConfig({ baseUrl: 'https://datoms.test/v4' })).toThrow(/host/);
    expect(
      createDatomsConfig(
        { baseUrl: 'https://datoms.test/v4' },
        { extraAllowedHosts: ['datoms.test'] },
      ).baseUrl,
    ).toBe('https://datoms.test/v4');
  });
});

describe('M2: the token stays out of dumps', () => {
  it('JSON.stringify and inspect of the config hide the token', () => {
    expect(JSON.stringify(testConfig)).not.toContain(TEST_TOKEN);
    expect(inspect(testConfig, { depth: 10 })).not.toContain(TEST_TOKEN);
    expect(Object.keys(testConfig)).not.toContain('token');
    expect(testConfig.token).toBe(TEST_TOKEN); // still readable for the HTTP layer
  });

  it('util.inspect of the whole api object does not contain the token', () => {
    const r = rig(fakeFetch(() => ({ body: {} })).impl);
    expect(inspect(r.api, { depth: 10, showHidden: true })).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(r.api)).not.toContain(TEST_TOKEN);
    const http = new DatomsHttp(testConfig);
    expect(inspect(http, { depth: 10, showHidden: true })).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(http)).not.toContain(TEST_TOKEN);
    expect(inspect(new DatomsClient(testConfig), { depth: 10, showHidden: true })).not.toContain(
      TEST_TOKEN,
    );
  });
});

describe('M3: body-phase failures are network errors', () => {
  it('a body stream that errors becomes DatomsNetworkError (no token in the message)', async () => {
    const impl = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new TypeError(`broken ${TEST_TOKEN}`));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const err = await new DatomsHttp(testConfig, impl).request('GET', '/assets').catch((e) => e);
    expect(err).toBeInstanceOf(DatomsNetworkError);
    expect(String(err.message)).not.toContain(TEST_TOKEN);
  });
});

describe('L1: redirects', () => {
  it('fetch is called with redirect: "error"', async () => {
    let init: RequestInit | undefined;
    const impl = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response('{}');
    }) as unknown as typeof fetch;
    await new DatomsHttp(testConfig, impl).request('GET', '/assets');
    expect(init?.redirect).toBe('error');
  });

  it('a redirect refusal is an unexpected DatomsApiError and is not retried', async () => {
    let n = 0;
    const impl = (async () => {
      n++;
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    }) as unknown as typeof fetch;
    const r = rig(impl);
    const err = await r.api.bulkByIds(['1']).catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).kind).toBe('unexpected');
    expect(n).toBe(1);
  });

  it('a 3xx answer is an unexpected DatomsApiError and is not retried', async () => {
    const s = fakeFetch(() => ({ status: 302, body: {} }));
    const err = await rig(s.impl)
      .api.bulkByIds(['1'])
      .catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).kind).toBe('unexpected');
    expect(s.calls).toHaveLength(1);
  });
});

describe('L2: fetch error text is not echoed; token is trimmed and validated', () => {
  it('uses the error name and cause code only', async () => {
    const impl = (async () => {
      throw new TypeError(`fetch failed for https://x/?key=${TEST_TOKEN}`, {
        cause: Object.assign(new Error('secret text'), { code: 'ECONNRESET' }),
      });
    }) as unknown as typeof fetch;
    const err = await new DatomsHttp(testConfig, impl).request('GET', '/assets').catch((e) => e);
    expect(err.message).toContain('TypeError (ECONNRESET)');
    expect(err.message).not.toContain('secret text');
    expect(err.message).not.toContain('https://x');
  });

  it('trims the token and rejects characters that are not header-safe', () => {
    expect(loadDatomsConfig({ DATOMS_TOKEN: `  ${TEST_TOKEN}\n` }).token).toBe(TEST_TOKEN);
    for (const bad of ['abc def', 'abc\r\nX-Evil: 1', 'tokén']) {
      let message = '';
      try {
        loadDatomsConfig({ DATOMS_TOKEN: bad });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/DATOMS_TOKEN/);
      expect(message).not.toContain(bad);
    }
  });
});

describe('L3: the env file cannot turn the live gate on', () => {
  it('restores the shell value after loading', () => {
    const env: NodeJS.ProcessEnv = {};
    loadEnvFileKeepingLiveGate('x', env, () => {
      env['DATOMS_LIVE'] = 'true';
      env['OTHER'] = '1';
    });
    expect(env['DATOMS_LIVE']).toBeUndefined();
    expect(env['OTHER']).toBe('1'); // the rest of the file still loads
    const env2: NodeJS.ProcessEnv = { DATOMS_LIVE: 'true' };
    loadEnvFileKeepingLiveGate('x', env2, () => {
      env2['DATOMS_LIVE'] = 'false';
    });
    expect(env2['DATOMS_LIVE']).toBe('true');
  });
});

describe('L4: CLI ids and fixture names', () => {
  it('ids: letters, digits and dash, 1 to 64', () => {
    expect(assertValidId('42485')).toBe('42485');
    expect(assertValidId('a1b2-c3')).toBe('a1b2-c3');
    for (const bad of ['', '../x', 'a b', 'a/b', 'a?b', 'x'.repeat(65), 'é']) {
      expect(() => assertValidId(bad)).toThrow();
    }
  });

  it('latest takes at most 10 ids and encodes the path', () => {
    expect(validateIds(['1', '2', '2'], 10)).toEqual(['1', '2']);
    expect(() =>
      validateIds(
        Array.from({ length: 11 }, (_, i) => String(i)),
        10,
      ),
    ).toThrow();
    expect(() => validateIds([], 10)).toThrow();
    expect(latestPath('abc-1')).toBe('/assets/abc-1/data' + '/latest');
    expect(() => latestPath('../x')).toThrow();
  });

  it('saveFixture rejects bad names and paths outside fixtures/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    for (const bad of ['../x.json', 'a/b.json', '..\\x.json', 'x.txt', '.json', '', '/abs.json']) {
      expect(() => fixturePath(bad, dir)).toThrow();
    }
    expect(fixturePath('ok-1.json', dir)).toContain('ok-1.json');
  });
});

describe('L5: the recorder redacts and refuses credentials', () => {
  const res = (body: unknown): DatomsResponse => ({
    status: 200,
    ok: true,
    body,
    rateLimit: {},
    durationMs: 1,
  });

  it('removes the token from the written text', () => {
    const text = serializeFixture('GET', '/assets', res({ note: `x ${TEST_TOKEN} y` }), TEST_TOKEN);
    expect(text).not.toContain(TEST_TOKEN);
    expect(text).toContain('[redacted]');
  });

  it('refuses to write anything that looks like an auth header', () => {
    expect(() => serializeFixture('GET', '/a', res({ h: 'Bearer abc' }))).toThrow(/credential/);
    expect(() => serializeFixture('GET', '/a', res({ Authorization: 'x' }))).toThrow(/credential/);
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    expect(() => saveFixture('bad.json', 'GET', '/a', res({ h: 'bearer x' }), '', dir)).toThrow();
    expect(readdirSync(dir)).toEqual([]); // nothing was written
  });
});

describe('L6: Retry-After cap, non-finite waits, timer clamp', () => {
  const res429 = (retryAfter: string): DatomsResponse => ({
    status: 429,
    ok: false,
    rateLimit: { retryAfter },
    durationMs: 1,
  });

  it('withRetry gives up at once when Retry-After is above the cap', async () => {
    const waits: number[] = [];
    let n = 0;
    const out = await withRetry(
      () => {
        n++;
        return Promise.resolve(res429(String(MAX_RETRY_AFTER_MS / 1000 + 1)));
      },
      {
        sleep: (ms) => (waits.push(ms), Promise.resolve()),
      },
    );
    expect(out.status).toBe(429);
    expect(n).toBe(1);
    expect(waits).toEqual([]);
  });

  it('a Retry-After at the cap is still waited for', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetry(
      () => Promise.resolve(n++ === 0 ? res429('120') : { ...res429('0'), status: 200, ok: true }),
      { sleep: (ms) => (waits.push(ms), Promise.resolve()) },
    );
    expect(waits).toEqual([120_000]);
  });

  it('the api skips the tick on a Retry-After above the cap', async () => {
    const s = fakeFetch(() => errorReply(429, 'RATE', { 'Retry-After': '3600' }));
    const r = rig(s.impl);
    await expect(r.api.bulkByIds(['1'])).rejects.toBeInstanceOf(BudgetSkippedError);
    expect(s.calls).toHaveLength(1);
  });

  it('a non-finite budget wait always throws BudgetSkippedError', async () => {
    const s = fakeFetch(() => ({ body: { data: [] } }));
    const budget = {
      check: () => ({ allowed: false, waitMs: Number.NaN, reason: 'x' }),
      record() {},
      applyHeaders() {},
      slowdownFactor: () => 1,
      allowanceWarning: () => false,
    } as unknown as BudgetTracker;
    const api = new DatomsApi({
      client: new DatomsClient(testConfig, s.impl),
      budget,
      pageSizes: new InMemoryPageSizeStore(),
      sleep: () => Promise.resolve(),
      maxBudgetWaitMs: Number.POSITIVE_INFINITY,
    });
    await expect(api.bulkByIds(['1'])).rejects.toBeInstanceOf(BudgetSkippedError);
    expect(s.calls).toHaveLength(0);
  });

  it('defaultSleep clamps to 2^31-1 ms', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const p = defaultSleep(Number.POSITIVE_INFINITY);
    expect(spy.mock.calls[0]?.[1]).toBe(2 ** 31 - 1);
    await vi.advanceTimersByTimeAsync(2 ** 31 - 1);
    await p;
  });
});

describe('QA L3: unusable Retry-After values', () => {
  it.each(['', '   ', '-5', 'soon'])('%j is unusable', (v) => {
    expect(parseRetryAfter(v)).toBeUndefined();
  });

  it('a 429 with a blank Retry-After waits the default', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetry(
      () =>
        Promise.resolve(
          n++ === 0
            ? ({
                status: 429,
                ok: false,
                rateLimit: { retryAfter: ' ' },
                durationMs: 1,
              } as DatomsResponse)
            : ({ status: 200, ok: true, rateLimit: {}, durationMs: 1 } as DatomsResponse),
        ),
      { sleep: (ms) => (waits.push(ms), Promise.resolve()) },
    );
    expect(waits).toEqual([5000]);
  });
});

describe('L7: the budget fails closed on bad inputs', () => {
  const ok = { fleetSize: 10, maxShare: 1 };
  it.each([
    ['fleetSize NaN', { ...ok, fleetSize: Number.NaN }],
    ['fleetSize negative', { ...ok, fleetSize: -1 }],
    ['fleetSize Infinity', { ...ok, fleetSize: Number.POSITIVE_INFINITY }],
    ['maxShare 0', { ...ok, maxShare: 0 }],
    ['maxShare > 1', { ...ok, maxShare: 1.5 }],
    ['maxShare NaN', { ...ok, maxShare: Number.NaN }],
    ['allowance 0', { ...ok, monthlyAllowance: 0 }],
    ['allowance NaN', { ...ok, monthlyAllowance: Number.NaN }],
    ['allowance Infinity', { ...ok, monthlyAllowance: Number.POSITIVE_INFINITY }],
  ])('%s throws', (_n, o) => {
    expect(() => new BudgetTracker(o)).toThrow(RangeError);
  });

  it('valid inputs, including fleetSize 0, are accepted', () => {
    expect(() => new BudgetTracker({ fleetSize: 0, maxShare: 0.1 })).not.toThrow();
    expect(() => new BudgetTracker({ ...ok, monthlyAllowance: 1000 })).not.toThrow();
  });
});

describe('L8 and QA L1/L4: the catalogue walk', () => {
  const page = (n: number) => ({
    body: {
      data: syntheticAssets(n),
      pagination: { total: n, page: 1, limit: 1000, total_pages: 1 },
    },
  });

  it('GET /assets counts against its own 60 per 60 s window and waits', async () => {
    const s = fakeFetch(() => page(3));
    const r = rig(s.impl);
    for (let i = 0; i < 54; i++) r.budget.record(r.clock.t, 0, 1, 'assets'); // 90% of 60
    await r.api.collectAssets();
    expect(r.waits.length).toBeGreaterThan(0);
    expect(s.calls).toHaveLength(1);
    const u = r.budget.usage().find((w) => w.name === 'assets-requests-1m')!;
    expect(u.cap).toBe(60);
  });

  it('the catalogue window is separate from the bulk request window', () => {
    const b = new BudgetTracker({ fleetSize: 500, maxShare: 1 });
    for (let i = 0; i < 54; i++) b.record(Date.now(), 0, 1, 'assets');
    expect(b.check(10, 'bulk').allowed).toBe(true);
    expect(b.check(0, 'assets').allowed).toBe(false);
  });

  it('a catalogue call is skipped when max_share leaves no room', async () => {
    const s = fakeFetch(() => page(3));
    const r = rig(s.impl, { maxShare: 0.01 }); // 0.6 requests per minute
    await expect(r.api.collectAssets()).rejects.toBeInstanceOf(BudgetSkippedError);
    expect(s.calls).toHaveLength(0);
  });

  it('stops at ceil(20000/limit)+2 pages and reports complete:false', async () => {
    const s = fakeFetch((call) => {
      const p = Number(new URL('https://x' + call.path).searchParams.get('page'));
      return {
        body: {
          data: syntheticAssets(1).map((a) => ({ ...a, id: `p${p}` })),
          pagination: { total: 5, page: p, limit: 1000, total_pages: 1_000_000 },
        },
      };
    });
    const r = rig(s.impl);
    const out = await r.api.collectAssets(1000);
    expect(s.calls).toHaveLength(22);
    expect(out.complete).toBe(false);
  });

  it('QA L4: a catalogue page without pagination is not complete', async () => {
    const s = fakeFetch(() => ({ body: { data: syntheticAssets(4) } }));
    const out = await rig(s.impl).api.collectAssets();
    expect(out.assets).toHaveLength(4);
    expect(out.complete).toBe(false);
  });

  it('QA L4: fleet mode without pagination is an error, not a one-page walk', async () => {
    const s = fakeFetch(() => ({ body: { data: syntheticRows(3) } }));
    const r = rig(s.impl);
    const gen = r.api.walkFleet();
    const err = await gen.next().catch((e) => e);
    expect(err).toBeInstanceOf(DatomsApiError);
    expect((err as DatomsApiError).code).toBe('MISSING_PAGINATION');
  });
});

describe('L9: per-asset latest is unreachable from the product', () => {
  const latest = '/assets/1/data' + '/latest';

  it('DatomsHttp is not exported from the package index', () => {
    expect('DatomsHttp' in pkg).toBe(false);
  });

  it('DatomsHttp refuses the path unless the CLI flag is set', async () => {
    const s = fakeFetch(() => ({ body: { data: {} } }));
    const plain = new DatomsHttp(testConfig, s.impl);
    await expect(plain.request('GET', latest)).rejects.toThrow(/CLI-only/);
    await expect(plain.request('GET', latest + '?x=1')).rejects.toThrow(/CLI-only/);
    expect(s.calls).toHaveLength(0);
    const cli = new DatomsHttp(testConfig, s.impl, undefined, { allowPerAssetLatest: true });
    await cli.request('GET', latest);
    expect(s.calls).toHaveLength(1);
  });

  it('the CLI builds into a git-ignored .cli-build/, never dist/', () => {
    const ts = JSON.parse(readFileSync(join(PKG, 'tsconfig.scripts.json'), 'utf8')) as {
      compilerOptions: { outDir: string };
    };
    expect(ts.compilerOptions.outDir).toBe('.cli-build');
    expect(readFileSync(join(PKG, '.gitignore'), 'utf8')).toContain('.cli-build/');
    const build = JSON.parse(readFileSync(join(PKG, 'tsconfig.build.json'), 'utf8')) as {
      include: string[];
    };
    expect(build.include).toEqual(['src']);
  });
});

describe('QA L2: null asset_info is absent, not {}', () => {
  it('maps null and missing asset_info to undefined', () => {
    expect(mapAsset({ id: '1', asset_info: null }).nameplate).toBeUndefined();
    expect(mapAsset({ id: '1' }).nameplate).toBeUndefined();
    expect(mapAsset({ id: '1', asset_info: {} }).nameplate).toEqual({});
  });
});
