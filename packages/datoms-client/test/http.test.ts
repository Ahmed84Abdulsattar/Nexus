import { describe, expect, it } from 'vitest';
import {
  DatomsClient,
  DatomsHttp,
  DatomsNetworkError,
  REQUEST_TIMEOUT_MS,
  loadDatomsConfig,
} from '../src/index.js';
import { TEST_TOKEN, errorReply, fakeFetch, testConfig } from './helpers.js';

describe('http layer', () => {
  it('default timeout is 30 s', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('sends bearer auth and gzip, and builds the org URL', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const impl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await new DatomsHttp(testConfig, impl).request('GET', '/assets?page=1&limit=1000');
    expect(seen?.url).toBe('https://datoms.test/v4/orgs/20283/assets?page=1&limit=1000');
    expect(seen?.headers['Authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    expect(seen?.headers['Accept-Encoding']).toBe('gzip');
  });

  it('captures every rate-limit header, Unit included', async () => {
    const { impl } = fakeFetch(() => ({
      body: { data: [] },
      headers: {
        'X-RateLimit-Unit': 'asset-read-credits',
        'X-RateLimit-Limit': '2000',
        'X-RateLimit-Remaining': '1996',
        'X-RateLimit-Reset': '61',
        'Retry-After': '3',
      },
    }));
    const r = await new DatomsClient(testConfig, impl).bulkLatestById(['1']);
    expect(r.rateLimit).toEqual({
      unit: 'asset-read-credits',
      limit: '2000',
      remaining: '1996',
      reset: '61',
      retryAfter: '3',
    });
  });

  it('a missing Unit header stays missing (GET /assets sends none)', async () => {
    const { impl } = fakeFetch(() => ({
      body: {},
      headers: {
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '59',
        'X-RateLimit-Reset': '60',
      },
    }));
    const r = await new DatomsClient(testConfig, impl).listAssets(1, 1000);
    expect(r.rateLimit.unit).toBeUndefined();
    expect(r.rateLimit.limit).toBe('60');
  });

  it('parses the DATOMS error envelope', async () => {
    const { impl } = fakeFetch(() => errorReply(422, 'PAGE_RESPONSE_TOO_LARGE'));
    const r = await new DatomsClient(testConfig, impl).bulkLatestFleet(1, 500);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error?.code).toBe('PAGE_RESPONSE_TOO_LARGE');
  });

  it('tolerates a non-JSON error body', async () => {
    const impl = (async () =>
      new Response('<html>bad gateway</html>', { status: 502 })) as typeof fetch;
    const r = await new DatomsHttp(testConfig, impl).request('GET', '/assets');
    expect(r.status).toBe(502);
    expect(r.error).toEqual({});
  });

  it('times out and aborts (timeout is injectable; the default is 30 s)', async () => {
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const http = new DatomsHttp(testConfig, impl, 20);
    await expect(http.request('GET', '/assets')).rejects.toBeInstanceOf(DatomsNetworkError);
  });

  it('never puts the token in an error message', async () => {
    const impl = (async () => {
      throw new Error(`connect failed for Bearer ${TEST_TOKEN}`);
    }) as typeof fetch;
    const err = await new DatomsHttp(testConfig, impl).request('GET', '/assets').catch((e) => e);
    expect(err).toBeInstanceOf(DatomsNetworkError);
    expect(String(err.message)).not.toContain(TEST_TOKEN);
  });

  it('refuses to call unless DATOMS_LIVE=true', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: {} }));
    const http = new DatomsHttp({ ...testConfig, live: false }, impl);
    await expect(http.request('GET', '/assets')).rejects.toThrow(/DATOMS_LIVE/);
    expect(calls).toHaveLength(0);
  });

  it('reads config from the environment', () => {
    const c = loadDatomsConfig({
      DATOMS_BASE_URL: 'https://x/v4/',
      DATOMS_ORG_ID: '1',
      DATOMS_TOKEN: 't',
      DATOMS_LIVE: 'true',
    });
    expect(c).toEqual({ baseUrl: 'https://x/v4', orgId: '1', token: 't', live: true });
    expect(loadDatomsConfig({}).live).toBe(false);
  });
});
