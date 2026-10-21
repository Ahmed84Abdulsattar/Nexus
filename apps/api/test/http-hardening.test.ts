import { Readable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { clientAddressKey } from '../src/common/rate-limit/rate-limit.js';
import { loadConfig } from '../src/config/env.js';
import { createTestApp, type TestApp, TEST_ENV } from './helpers/auth.js';

// Security review of S1-09 (M1, M2, L1, L2, L3 and the info items).
const OID_A = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const WEB = 'https://nexus-web.example';
const PROBLEM = 'application/problem+json';

const apps: TestApp[] = [];
async function app(env: Record<string, string> = {}): Promise<TestApp> {
  const t = await createTestApp({ withTestRoutes: true, env });
  apps.push(t);
  return t;
}
afterAll(async () => {
  await Promise.all(apps.map((t) => t.app.close()));
});

describe('TRUST_PROXY is required outside local (M1)', () => {
  const without = (APP_ENV: string) => loadConfig({ ...TEST_ENV, APP_ENV, TRUST_PROXY: undefined });

  it.each(['dev', 'prod'])('refuses to start in %s when it is unset, naming the subnet', (env) => {
    expect(() => without(env)).toThrow(/TRUST_PROXY.*set it to 1/s);
    expect(() => loadConfig({ ...TEST_ENV, APP_ENV: env, TRUST_PROXY: '' })).toThrow(/TRUST_PROXY/);
  });

  it('accepts an explicit "false", a hop count of 1 or 2, or a subnet, in prod; unset is fine in local', () => {
    expect(loadConfig({ ...TEST_ENV, APP_ENV: 'prod', TRUST_PROXY: 'false' }).http.trustProxy).toBe(
      false,
    );
    expect(
      loadConfig({ ...TEST_ENV, APP_ENV: 'prod', TRUST_PROXY: '100.100.0.0/16' }).http.trustProxy,
    ).toEqual(['100.100.0.0/16']);
    expect(loadConfig({ ...TEST_ENV, APP_ENV: 'prod', TRUST_PROXY: '1' }).http.trustProxy).toBe(1);
    expect(loadConfig({ ...TEST_ENV, APP_ENV: 'dev', TRUST_PROXY: '2' }).http.trustProxy).toBe(2);
    expect(without('local').http.trustProxy).toBe(false);
  });
});

describe('deactivated users are rate limited before any database work (M2)', () => {
  it('answers 403, then 429, and makes no further upserts', async () => {
    const t = await app({ RATE_LIMIT_USER_PER_MINUTE: '3' });
    t.directory.setActive(OID_A, false);
    const upserts = vi.spyOn(t.directory, 'upsertUser');
    const token = await t.token({ claims: { oid: OID_A } });
    for (let i = 0; i < 3; i++) {
      expect((await t.get('/v1/test-auth/any', token)).statusCode).toBe(403);
    }
    const calls = upserts.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      expect((await t.get('/v1/test-auth/any', token)).statusCode).toBe(429);
    }
    expect(upserts.mock.calls.length).toBe(calls);
  });
});

describe('address limit runs before routing (L1)', () => {
  it('answers 429 problem+json for an unknown path over the limit', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '2' });
    expect((await t.get('/v1/nothing-here')).statusCode).toBe(404);
    expect((await t.get('/v1/nothing-here')).statusCode).toBe(404);
    const over = await t.get('/v1/nothing-here');
    expect(over.statusCode).toBe(429);
    expect(over.headers['content-type']).toContain(PROBLEM);
    expect(over.headers['retry-after']).toBeDefined();
  });

  it('counts an oversized body against the address too', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '1', BODY_LIMIT_BYTES: '1024' });
    const big = { name: 'x'.repeat(3000), count: 1 };
    expect((await t.post('/v1/test-auth/echo', big)).statusCode).toBe(413);
    expect((await t.post('/v1/test-auth/echo', big)).statusCode).toBe(429);
  });
});

describe('clientAddressKey (L3)', () => {
  it('maps IPv4-mapped IPv6 to IPv4 and keys IPv6 by /64', () => {
    expect(clientAddressKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(clientAddressKey('1.2.3.4')).toBe('1.2.3.4');
    const a = clientAddressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(clientAddressKey('2001:db8:1:2::1')).toBe(a);
    expect(clientAddressKey('2001:DB8:1:2:0:0:0:9')).toBe(a);
    expect(clientAddressKey('2001:db8:1:3::1')).not.toBe(a);
    expect(clientAddressKey('fe80::1%eth0')).toBe(clientAddressKey('fe80::2'));
    expect(clientAddressKey(undefined)).toBe('unknown');
  });

  it('shares one budget between the mapped and plain forms of an address', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '2' });
    const hit = (remoteAddress: string) =>
      t.app.inject({ method: 'GET', url: '/health/live', remoteAddress });
    expect((await hit('203.0.113.9')).statusCode).toBe(200);
    expect((await hit('::ffff:203.0.113.9')).statusCode).toBe(200);
    expect((await hit('203.0.113.9')).statusCode).toBe(429);
  });
});

describe('request body limit and CORS Vary (info items)', () => {
  it('answers 413 for a chunked body without Content-Length', async () => {
    const t = await app({ BODY_LIMIT_BYTES: '1024' });
    const token = await t.token();
    const chunks = Array.from({ length: 6 }, () => Buffer.alloc(500, 'a'));
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-auth/echo',
      payload: Readable.from(chunks),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(413);
    expect(res.headers['content-type']).toContain(PROBLEM);
  });

  it('sends Vary: Origin so a cache cannot hand one origin the answer meant for another', async () => {
    const t = await app({ CORS_ALLOWED_ORIGINS: WEB });
    for (const origin of [WEB, 'https://evil.example', undefined]) {
      const res = await t.app.inject({
        method: 'GET',
        url: '/health/live',
        ...(origin ? { headers: { origin } } : {}),
      });
      expect(String(res.headers['vary']).toLowerCase(), String(origin)).toContain('origin');
    }
  });
});
