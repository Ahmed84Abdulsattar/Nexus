import 'reflect-metadata';
import { DEV_USERS } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createTestApp } from './helpers/auth.js';
import { createInMemoryDevApp, devEnv, type DevApp } from './helpers/dev-app.js';

// Security review of S1-02: H1 (forwarding headers, listen address), M1 (Host/Origin), M3 (platform
// markers), L4 (negative tests).

describe('config refusals', () => {
  it.each(['1', '2', '10.0.0.0/8', '192.168.0.0/16'])(
    'refuses AUTH_MODE=dev with TRUST_PROXY=%s',
    (proxy) => {
      expect(() => loadConfig(devEnv({ TRUST_PROXY: proxy }))).toThrow(/TRUST_PROXY/);
    },
  );
  it('accepts TRUST_PROXY=false with AUTH_MODE=dev', () => {
    expect(() => loadConfig(devEnv({ TRUST_PROXY: 'false' }))).not.toThrow();
  });
  it.each([
    'CONTAINER_APP_NAME',
    'CONTAINER_APP_REPLICA_NAME',
    'KUBERNETES_SERVICE_HOST',
    'WEBSITE_INSTANCE_ID',
    'IDENTITY_ENDPOINT',
    'CODESPACES',
  ])('refuses AUTH_MODE=dev when %s is set', (marker) => {
    expect(() => loadConfig(devEnv({ [marker]: 'x' }))).toThrow(new RegExp(marker));
  });
  it.each([
    'https://nexus.ngrok.io',
    'http://192.168.1.5:5173',
    'http://localhost:5173,https://evil.example.com',
  ])('refuses AUTH_MODE=dev with CORS_ALLOWED_ORIGINS=%s', (origins) => {
    expect(() => loadConfig(devEnv({ CORS_ALLOWED_ORIGINS: origins }))).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });
  it('accepts local CORS origins with AUTH_MODE=dev', () => {
    expect(() =>
      loadConfig(devEnv({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' })),
    ).not.toThrow();
  });
  it.each(['DEV', ' dev', 'Dev', 'dev '])('rejects AUTH_MODE=%j', (mode) => {
    expect(() => loadConfig(devEnv({ AUTH_MODE: mode }))).toThrow(ConfigError);
  });
  it.each([
    'postgres://u@localhost/n?host=db.example.com',
    'postgres://u@localhost/n?host=localhost&host=db.example.com',
    'postgres://u@localhost/n?hostaddr=10.0.0.4',
  ])('refuses AUTH_MODE=dev with the database URL %s', (url) => {
    expect(() => loadConfig(devEnv({ DATABASE_URL: url }))).toThrow(/database on this machine/);
  });
});

describe('module guards', () => {
  it('the DevAuthModule key factory throws on an entra or non-local config', async () => {
    const { DevAuthModule } = await import('../src/dev/dev-auth.module.js');
    const { DEV_KEY_SOURCE } = await import('../src/common/auth/dev-key-source.js');
    const providers = Reflect.getMetadata('providers', DevAuthModule) as {
      provide: symbol;
      useFactory?: (config: unknown) => unknown;
    }[];
    const factory = providers.find((p) => p.provide === DEV_KEY_SOURCE)!.useFactory!;
    const dev = loadConfig(devEnv());
    expect(() => factory({ ...dev, auth: { ...dev.auth, mode: 'entra' } })).toThrow();
    expect(() => factory({ ...dev, appEnv: 'dev' })).toThrow();
    expect(() =>
      factory({ ...dev, database: { ...dev.database, url: 'postgres://u@db.example.com/n' } }),
    ).toThrow();
    expect(() => factory({ ...dev, http: { ...dev.http, trustProxy: 1 } })).toThrow();
    expect(() => factory({ ...dev, http: { ...dev.http, trustProxy: ['10.0.0.0/8'] } })).toThrow();
    expect(factory(dev)).toBeInstanceOf(Promise);
  });

  it('AuthModule throws in dev mode without a key source', async () => {
    const { AuthModule } = await import('../src/common/auth/auth.module.js');
    const { JWT_KEY_RESOLVER } = await import('../src/common/auth/entra-jwt.guard.js');
    const providers = Reflect.getMetadata('providers', AuthModule) as {
      provide: symbol;
      useFactory?: (config: unknown, keys: unknown) => unknown;
    }[];
    const factory = providers.find((p) => p.provide === JWT_KEY_RESOLVER)!.useFactory!;
    expect(() => factory(loadConfig(devEnv()), undefined)).toThrow(/dev key source/);
  });
});

describe('a dev token on an entra-mode app', () => {
  it('is rejected with 401', async () => {
    const dev = await createInMemoryDevApp(loadConfig(devEnv()));
    const entra = await createTestApp();
    try {
      const token = (await dev.post('/v1/dev/token', { user: 'admin' })).json<{
        accessToken: string;
      }>().accessToken;
      expect((await entra.get('/v1/me', token)).statusCode).toBe(401);
    } finally {
      await dev.app.close();
      await entra.app.close();
    }
  });
});

describe('the request hook is dev-only', () => {
  it('an entra-mode app does not answer 403 to a foreign Host plus X-Forwarded-For', async () => {
    const entra = await createTestApp();
    try {
      const res = await entra.app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { host: 'api.example', 'x-forwarded-for': '1.2.3.4' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await entra.app.close();
    }
  });
});

describe('request checks in dev mode', () => {
  let t: DevApp;
  beforeAll(async () => {
    t = await createInMemoryDevApp(loadConfig(devEnv()));
  });
  afterAll(async () => {
    await t.app.close();
  });
  const tokenCall = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
    t.app.inject({
      method: 'POST',
      url: '/v1/dev/token',
      payload: { user: 'admin' },
      headers,
      remoteAddress,
    });

  it('accepts localhost hosts and the configured web origin', async () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost']) {
      expect((await tokenCall({ host })).statusCode).toBe(200);
    }
    expect((await tokenCall({ origin: 'http://localhost:5173' })).statusCode).toBe(200);
  });

  it.each(['evil.example.com', 'localhost.evil.example.com', '10.0.0.4:3000', 'abc.ngrok.io'])(
    'refuses Host %s with 403',
    async (host) => {
      expect((await tokenCall({ host })).statusCode).toBe(403);
    },
  );

  it('refuses a foreign Origin with 403', async () => {
    expect((await tokenCall({ origin: 'https://evil.example.com' })).statusCode).toBe(403);
    expect((await tokenCall({ origin: 'http://localhost:9999' })).statusCode).toBe(403);
  });

  it.each([
    'x-forwarded-for',
    'forwarded',
    'x-real-ip',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'via',
    'cf-connecting-ip',
    'true-client-ip',
    'x-client-ip',
    'x-original-forwarded-for',
  ])('refuses %s from a loopback peer with 403', async (header) => {
    expect((await tokenCall({ [header]: '127.0.0.1' })).statusCode).toBe(403);
  });

  it('refuses X-Forwarded-For: 127.0.0.1 from a non-loopback peer', async () => {
    expect((await tokenCall({ 'x-forwarded-for': '127.0.0.1' }, '203.0.113.9')).statusCode).toBe(
      403,
    );
  });

  it('applies the checks to every route, not only the token route', async () => {
    const health = await t.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { host: 'evil.example.com' },
    });
    expect(health.statusCode).toBe(403);
    const unknown = await t.app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(unknown.statusCode).toBe(403);
  });

  it('ignores extra fields in the body: a viewer stays a viewer', async () => {
    const res = await t.post('/v1/dev/token', {
      user: 'viewer',
      groups: [DEV_USERS[0].groupId],
      roles: ['admin'],
      oid: DEV_USERS[0].oid,
      scp: 'anything',
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json<{ accessToken: string }>().accessToken.split('.')[1] as string;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const viewer = DEV_USERS.find((u) => u.key === 'viewer')!;
    expect(claims['groups']).toEqual([viewer.groupId]);
    expect(claims['oid']).toBe(viewer.oid);
    expect(claims['scp']).toBe('access_as_user');
  });
});
