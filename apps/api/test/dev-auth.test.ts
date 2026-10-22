import 'reflect-metadata';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import { DEV_USERS } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, createAppModule } from '../src/app.module.js';
import { AccessChangeListener } from '../src/common/auth/access-change-listener.js';
import { ACCESS_DIRECTORY } from '../src/common/auth/access-context.js';
import { InMemoryAccessDirectory } from '../src/common/auth/in-memory-access-directory.js';
import { configureApp } from '../src/common/http/configure-app.js';
import { applySecurity, createHttpAdapter } from '../src/common/http/security.js';
import { APP_CONFIG, ConfigError, loadConfig, type AppConfig } from '../src/config/env.js';
import { createTestApp, makeKeys, signToken, TEST_ENV } from './helpers/auth.js';
import { scanHandlers } from './helpers/routes.js';

const LOCAL_DB = 'postgres://nexus_api_local@localhost:5432/nexus';
const devEnv = (extra: Record<string, string> = {}) => ({
  APP_ENV: 'local',
  AUTH_MODE: 'dev',
  DATABASE_URL: LOCAL_DB,
  ...extra,
});

interface DevApp {
  app: NestFastifyApplication;
  config: AppConfig;
  post: (
    url: string,
    payload: object,
    token?: string,
  ) => ReturnType<NestFastifyApplication['inject']>;
  get: (url: string, token?: string) => ReturnType<NestFastifyApplication['inject']>;
}

/** The real application in dev mode, built the way main.ts builds it. `inMemory` skips PostgreSQL. */
async function createDevApp(config: AppConfig, inMemory: boolean): Promise<DevApp> {
  let builder = Test.createTestingModule({ imports: [await createAppModule(config)] })
    .overrideProvider(APP_CONFIG)
    .useValue(config);
  if (inMemory) {
    builder = builder
      .overrideProvider(ACCESS_DIRECTORY)
      .useClass(InMemoryAccessDirectory)
      .overrideProvider(AccessChangeListener)
      .useValue({});
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(config));
  configureApp(app);
  await applySecurity(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const auth = (token?: string) => (token ? { headers: { authorization: `Bearer ${token}` } } : {});
  return {
    app,
    config,
    post: (url, payload, token) => app.inject({ method: 'POST', url, payload, ...auth(token) }),
    get: (url, token) => app.inject({ method: 'GET', url, ...auth(token) }),
  };
}

describe('startup refusals (docs/04 AUTH_MODE)', () => {
  it.each(['dev', 'prod'])('refuses AUTH_MODE=dev with APP_ENV=%s', (appEnv) => {
    expect(() =>
      loadConfig(
        devEnv({
          APP_ENV: appEnv,
          TRUST_PROXY: '1',
          DATABASE_URL: `${LOCAL_DB}?sslmode=require`,
          ENTRA_TENANT_ID: '11111111-2222-4333-8444-555555555555',
          ENTRA_API_CLIENT_ID: '99999999-8888-4777-8666-555555555555',
          ENTRA_WEB_CLIENT_ID: '77777777-6666-4555-8444-333333333333',
          ENTRA_API_AUDIENCE: 'api://nexus-api',
        }),
      ),
    ).toThrow(/AUTH_MODE=dev is allowed only when APP_ENV=local/);
  });

  it('refuses AUTH_MODE=dev with a database that is not on this machine', () => {
    expect(() =>
      loadConfig(devEnv({ DATABASE_URL: 'postgres://u@db.example.com:5432/nexus' })),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(devEnv({ DATABASE_URL: 'postgres://u@db.example.com:5432/nexus' })),
    ).toThrow(/database on this machine/);
  });

  it('accepts AUTH_MODE=dev locally without any ENTRA_ values (fake defaults)', () => {
    const config = loadConfig(devEnv());
    expect(config.auth.mode).toBe('dev');
    expect(config.auth.audiences).toContain('api://nexus-api');
  });

  it('leaves AUTH_MODE=entra without the defaults: ENTRA_ values stay required', () => {
    expect(() => loadConfig({ APP_ENV: 'local', DATABASE_URL: LOCAL_DB })).toThrow(
      /ENTRA_TENANT_ID/,
    );
  });
});

describe('POST /v1/dev/token exists only in dev mode', () => {
  it('is absent (404) with AUTH_MODE=entra', async () => {
    const t = await createTestApp();
    try {
      const res = await t.post('/v1/dev/token', { user: 'admin' });
      expect(res.statusCode).toBe(404);
    } finally {
      await t.app.close();
    }
  });

  it('is not part of the Entra application module graph', async () => {
    const config = loadConfig(TEST_ENV);
    expect(await createAppModule(config)).toBe(AppModule);
  });
});

describe('dev mode (no database)', () => {
  let t: DevApp;
  beforeAll(async () => {
    t = await createDevApp(loadConfig(devEnv()), true);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('is @Public, and the only public routes are /health/live and /dev/token', () => {
    const publicPaths = scanHandlers(t.app)
      .filter((h) => h.policy.kind === 'public')
      .map((h) => h.path)
      .sort();
    expect(publicPaths).toEqual(['/dev/token', '/health/live']);
  });

  it('is not in the OpenAPI contract', async () => {
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const doc = SwaggerModule.createDocument(t.app, new DocumentBuilder().build());
    expect(Object.keys(doc.paths).some((p) => p.includes('dev'))).toBe(false);
  });

  it('answers an unknown user with 400 and a missing user with 422', async () => {
    const bad = await t.post('/v1/dev/token', { user: 'root' });
    expect(bad.statusCode).toBe(400);
    expect(String(bad.headers['content-type'])).toContain('application/problem+json');
    expect((await t.post('/v1/dev/token', {})).statusCode).toBe(422);
  });

  it('refuses a caller that is not on this machine', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/dev/token',
      payload: { user: 'admin' },
      remoteAddress: '203.0.113.9',
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns an Entra-shaped token for each demo user', async () => {
    for (const u of DEV_USERS) {
      const res = await t.post('/v1/dev/token', { user: u.key });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accessToken: string; expiresIn: number; user: { name: string } }>();
      expect(body.expiresIn).toBe(3600);
      const claims = JSON.parse(
        Buffer.from(body.accessToken.split('.')[1] as string, 'base64url').toString(),
      ) as Record<string, unknown>;
      expect(claims).toMatchObject({
        oid: u.oid,
        tid: t.config.auth.tenantId,
        iss: t.config.auth.issuer,
        aud: t.config.auth.audiences[0],
        scp: 'access_as_user',
        groups: [u.groupId],
        name: u.name,
        preferred_username: u.email,
      });
    }
  });

  it('rejects a token signed with any other key', async () => {
    const other = await makeKeys('nexus-dev-other');
    const token = await signToken({
      keys: other,
      issuer: t.config.auth.issuer,
      audience: t.config.auth.audiences[0] as string,
      claims: {
        tid: t.config.auth.tenantId,
        azp: t.config.auth.webClientId,
        groups: [DEV_USERS[0].groupId],
      },
    });
    expect((await t.get('/v1/me', token)).statusCode).toBe(401);
  });

  it('rejects a token with the right key id but another signature', async () => {
    const res = await t.post('/v1/dev/token', { user: 'admin' });
    const [h, p] = res.json<{ accessToken: string }>().accessToken.split('.');
    expect((await t.get('/v1/me', `${h}.${p}.AAAA`)).statusCode).toBe(401);
  });
});

describe.skipIf(testDatabaseAdminUrl === undefined)('dev sign-in against PostgreSQL', () => {
  let testDb: TestDatabase;
  let t: DevApp;
  beforeAll(async () => {
    testDb = await createTestDatabase({ seed: true });
    t = await createDevApp(loadConfig(devEnv({ DATABASE_URL: testDb.adminUrl })), false);
  }, 60_000);
  afterAll(async () => {
    await t?.app.close();
    await testDb?.drop();
  });

  it.each(DEV_USERS.map((u) => [u.key, u] as const))(
    'GET /v1/me for %s returns that user, roles and permissions from the database',
    async (_key, u) => {
      const token = (await t.post('/v1/dev/token', { user: u.key })).json<{ accessToken: string }>()
        .accessToken;
      const res = await t.get('/v1/me', token);
      expect(res.statusCode).toBe(200);
      const me = res.json<{ name: string; roles: string[]; permissions: string[] }>();
      expect(me.name).toBe(u.name);
      expect(me.roles).toEqual([u.key]);
      expect(me.permissions.length).toBeGreaterThan(0);
    },
  );

  it('gives the admin more permissions than the viewer', async () => {
    const perms = async (user: string) => {
      const token = (await t.post('/v1/dev/token', { user })).json<{ accessToken: string }>()
        .accessToken;
      return t.get('/v1/me', token).then((r) => r.json<{ permissions: string[] }>().permissions);
    };
    expect((await perms('admin')).length).toBeGreaterThan((await perms('viewer')).length);
  });
});
