import { afterAll, describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../src/common/rate-limit/fixed-window-limiter.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createTestApp, type TestApp, TEST_ENV } from './helpers/auth.js';

const OID_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const OID_B = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const WEB = 'https://nexus-web.example';
const PROBLEM = 'application/problem+json';

const apps: TestApp[] = [];
async function app(env: Record<string, string> = {}, docs = false): Promise<TestApp> {
  const t = await createTestApp({ withTestRoutes: true, env, docs });
  apps.push(t);
  return t;
}
afterAll(async () => {
  await Promise.all(apps.map((t) => t.app.close()));
});

function expectSecureHeaders(headers: Record<string, unknown>): void {
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(String(headers['strict-transport-security'])).toMatch(/max-age=\d+/);
  expect(String(headers['content-security-policy'])).toContain("default-src 'none'");
  expect(String(headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBeDefined();
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-powered-by']).toBeUndefined();
}

describe('secure headers', () => {
  it('are on success, 401, 403, 404, 413 and 429 responses', async () => {
    const t = await app({
      BODY_LIMIT_BYTES: '1024',
      RATE_LIMIT_USER_PER_MINUTE: '1',
    });
    const token = await t.token();
    const ok = await t.get('/v1/test-auth/any', token);
    expect(ok.statusCode).toBe(200);
    expectSecureHeaders(ok.headers);

    const limited = await t.get('/v1/test-auth/any', token);
    expect(limited.statusCode).toBe(429);
    expectSecureHeaders(limited.headers);

    const unauth = await t.get('/v1/test-auth/any');
    expect(unauth.statusCode).toBe(401);
    expectSecureHeaders(unauth.headers);

    const forbidden = await t.get('/v1/test-auth/admin', await t.token({ claims: { oid: OID_B } }));
    expect(forbidden.statusCode).toBe(403);
    expectSecureHeaders(forbidden.headers);

    const missing = await t.get('/v1/does-not-exist');
    expect(missing.statusCode).toBe(404);
    expectSecureHeaders(missing.headers);

    const big = await t.post('/v1/test-auth/echo', { name: 'x'.repeat(5000), count: 1 }, token);
    expect(big.statusCode).toBe(413);
    expectSecureHeaders(big.headers);
  });
});

describe('CORS', () => {
  it('answers the configured Nexus origin and nobody else', async () => {
    const t = await app({ CORS_ALLOWED_ORIGINS: `${WEB}, https://second.example` });
    const ok = await t.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: WEB },
    });
    expect(ok.headers['access-control-allow-origin']).toBe(WEB);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    for (const origin of [
      'https://evil.example',
      'https://nexus-web.example.evil.example',
      'null',
    ]) {
      const res = await t.app.inject({ method: 'GET', url: '/health/live', headers: { origin } });
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
      expect(
        Object.keys(res.headers).filter((h) => h.startsWith('access-control-')),
        origin,
      ).toEqual([]);
    }
  });

  it('refuses a preflight from another origin and allows one from Nexus', async () => {
    const t = await app({ CORS_ALLOWED_ORIGINS: WEB });
    const preflight = (origin: string) =>
      t.app.inject({
        method: 'OPTIONS',
        url: '/v1/test-auth/any',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
    const good = await preflight(WEB);
    expect(good.headers['access-control-allow-origin']).toBe(WEB);
    expect(String(good.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization',
    );
    const bad = await preflight('https://evil.example');
    expect(Object.keys(bad.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('allows nobody when no origin is configured outside local', async () => {
    const t = await app({ APP_ENV: 'prod' });
    expect(t.config.http.corsOrigins).toEqual([]);
    const res = await t.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: WEB },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('defaults to the Vite dev server in local', async () => {
    const t = await app();
    expect(t.config.http.corsOrigins).toEqual(['http://localhost:5173']);
  });
});

describe('CORS_ALLOWED_ORIGINS validation', () => {
  const load = (APP_ENV: string, CORS_ALLOWED_ORIGINS: string) =>
    loadConfig({ ...TEST_ENV, APP_ENV, CORS_ALLOWED_ORIGINS });

  it.each([
    ['prod', '*'],
    ['local', '*'],
    ['dev', 'https://*.example.com'],
    ['prod', 'http://nexus.example'],
    ['dev', 'http://nexus.example'],
    ['prod', 'https://nexus.example/'],
    ['prod', 'https://nexus.example/app'],
    ['prod', 'nexus.example'],
    ['prod', 'https://ok.example,*'],
  ])('refuses %s %s', (env, value) => {
    expect(() => load(env, value)).toThrow(ConfigError);
  });

  it('accepts https origins, and http only in local', () => {
    expect(load('prod', 'https://a.example, https://b.example:8443').http.corsOrigins).toEqual([
      'https://a.example',
      'https://b.example:8443',
    ]);
    expect(load('local', 'http://localhost:5173').http.corsOrigins).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('treats an empty value as unset', () => {
    expect(load('prod', '').http.corsOrigins).toEqual([]);
  });
});

describe('per-user rate limit', () => {
  it('returns 429 problem+json with Retry-After, per user and not shared', async () => {
    const t = await app({ RATE_LIMIT_USER_PER_MINUTE: '3' });
    const a = await t.token({ claims: { oid: OID_A } });
    const b = await t.token({ claims: { oid: OID_B } });
    for (let i = 0; i < 3; i++) expect((await t.get('/v1/test-auth/any', a)).statusCode).toBe(200);

    const over = await t.get('/v1/test-auth/any', a);
    expect(over.statusCode).toBe(429);
    expect(over.headers['content-type']).toContain(PROBLEM);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(over.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(over.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });

    // Another user is not affected by A's traffic.
    expect((await t.get('/v1/test-auth/any', b)).statusCode).toBe(200);
  });

  it('counts the oid of a validated token only: forged tokens cannot use up a victim budget', async () => {
    const t = await app({ RATE_LIMIT_USER_PER_MINUTE: '2' });
    const forged = await t.token({ claims: { oid: OID_A }, audience: 'api://someone-else' });
    for (let i = 0; i < 5; i++)
      expect((await t.get('/v1/test-auth/any', forged)).statusCode).toBe(401);
    const a = await t.token({ claims: { oid: OID_A } });
    expect((await t.get('/v1/test-auth/any', a)).statusCode).toBe(200);
    expect((await t.get('/v1/test-auth/any', a)).statusCode).toBe(200);
    expect((await t.get('/v1/test-auth/any', a)).statusCode).toBe(429);
  });

  it('applies to every guarded route, including 403 answers', async () => {
    const t = await app({ RATE_LIMIT_USER_PER_MINUTE: '2' });
    const a = await t.token({ claims: { oid: OID_A } });
    expect((await t.get('/v1/test-auth/admin', a)).statusCode).toBe(403);
    expect((await t.get('/v1/test-auth/admin', a)).statusCode).toBe(403);
    expect((await t.get('/v1/test-auth/admin', a)).statusCode).toBe(429);
  });
});

describe('per-address flood guard and trustProxy', () => {
  const hit = (t: TestApp, remoteAddress: string, xff?: string) =>
    t.app.inject({
      method: 'GET',
      url: '/health/live',
      remoteAddress,
      ...(xff ? { headers: { 'x-forwarded-for': xff } } : {}),
    });

  it('limits by address before sign-in, and ignores a spoofed X-Forwarded-For by default', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '3' });
    expect(t.config.http.trustProxy).toBe(false);
    for (let i = 0; i < 3; i++)
      expect((await hit(t, '10.0.0.1', `1.1.1.${i}`)).statusCode).toBe(200);
    const over = await hit(t, '10.0.0.1', '9.9.9.9');
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    expect(over.headers['content-type']).toContain(PROBLEM);
    // A different caller address has its own budget.
    expect((await hit(t, '10.0.0.2')).statusCode).toBe(200);
  });

  it('limits bad-token requests too', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '2' });
    expect((await t.get('/v1/test-auth/any', 'junk')).statusCode).toBe(401);
    expect((await t.get('/v1/test-auth/any', 'junk')).statusCode).toBe(401);
    expect((await t.get('/v1/test-auth/any', 'junk')).statusCode).toBe(429);
  });

  it('with TRUST_PROXY set the client is the last X-Forwarded-For entry not added by a trusted proxy', async () => {
    const t = await app({ RATE_LIMIT_IP_PER_MINUTE: '2', TRUST_PROXY: '10.0.0.0/8' });
    // Both calls come through the same proxy; the client addresses differ.
    expect((await hit(t, '10.0.0.1', '8.8.8.1')).statusCode).toBe(200);
    expect((await hit(t, '10.0.0.1', '8.8.8.1')).statusCode).toBe(200);
    expect((await hit(t, '10.0.0.1', '8.8.8.1')).statusCode).toBe(429);
    expect((await hit(t, '10.0.0.1', '8.8.8.2')).statusCode).toBe(200);
    // A client-supplied leading entry cannot choose the key.
    expect((await hit(t, '10.0.0.1', '1.2.3.4, 8.8.8.1')).statusCode).toBe(429);
    // A peer that is not a trusted proxy cannot set its address at all.
    expect((await hit(t, '192.168.1.1', '8.8.8.1')).statusCode).toBe(200);
    expect((await hit(t, '192.168.1.1', '8.8.8.2')).statusCode).toBe(200);
    expect((await hit(t, '192.168.1.1', '8.8.8.3')).statusCode).toBe(429);
  });
});

describe('TRUST_PROXY validation', () => {
  const load = (TRUST_PROXY: string) => loadConfig({ ...TEST_ENV, TRUST_PROXY });
  it('accepts off and address lists', () => {
    expect(load('').http.trustProxy).toBe(false);
    expect(load('false').http.trustProxy).toBe(false);
    expect(load('10.0.0.0/8, 127.0.0.1').http.trustProxy).toEqual(['10.0.0.0/8', '127.0.0.1']);
  });
  it.each(['true', '0.0.0.0/0', '::/0', '0', '1', '2', 'banana', '10.0.0.0/33'])(
    'refuses %s',
    (v) => {
      expect(() => load(v)).toThrow(/TRUST_PROXY/);
    },
  );
});

describe('rate limit settings', () => {
  it('come from config with defaults', () => {
    const c = loadConfig(TEST_ENV);
    expect(c.http.rateLimit).toEqual({ userPerMinute: 600, ipPerMinute: 3000 });
    expect(c.http.bodyLimitBytes).toBe(1_048_576);
    expect(() => loadConfig({ ...TEST_ENV, RATE_LIMIT_USER_PER_MINUTE: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...TEST_ENV, BODY_LIMIT_BYTES: 'big' })).toThrow(ConfigError);
  });
});

describe('FixedWindowLimiter', () => {
  it('resets after the window and reports the remaining seconds', () => {
    let now = 1_000_000;
    const l = new FixedWindowLimiter(2, 60_000, () => now);
    expect(l.hit('k').allowed).toBe(true);
    expect(l.hit('k').allowed).toBe(true);
    now += 20_000;
    const third = l.hit('k');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(40);
    expect(l.hit('other').allowed).toBe(true);
    now += 40_000;
    expect(l.hit('k').allowed).toBe(true);
  });
});

describe('request size limit', () => {
  it('answers 413 problem+json for a body over BODY_LIMIT_BYTES, and accepts one under it', async () => {
    const t = await app({ BODY_LIMIT_BYTES: '2048' });
    const token = await t.token();
    const small = await t.post('/v1/test-auth/echo', { name: 'ok', count: 1 }, token);
    expect(small.statusCode).toBe(201);
    const big = await t.post('/v1/test-auth/echo', { name: 'x'.repeat(4000), count: 1 }, token);
    expect(big.statusCode).toBe(413);
    expect(big.headers['content-type']).toContain(PROBLEM);
    expect(big.json()).toMatchObject({ status: 413, title: 'Content Too Large' });
  });
});

describe('Swagger UI', () => {
  it('is 404 when APP_ENV=prod (UI and spec)', async () => {
    const t = await app({ APP_ENV: 'prod' }, true);
    for (const url of ['/docs', '/docs/', '/openapi.json', '/docs/swagger-ui-init.js']) {
      expect((await t.get(url)).statusCode, url).toBe(404);
    }
  });

  it('works outside prod, with a CSP that allows only its own assets', async () => {
    const t = await app({}, true);
    const page = await t.get('/docs');
    expect(page.statusCode).toBe(200);
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    // The page has no inline script that the CSP would block.
    expect(page.body).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    // The API itself keeps default-src 'none'.
    expect(String((await t.get('/v1/missing')).headers['content-security-policy'])).toContain(
      "default-src 'none'",
    );
  });
});
