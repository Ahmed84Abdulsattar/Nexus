import 'reflect-metadata';
import { configResponseSchema, meResponseSchema, PERMISSION_KEYS } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createTestApp, storedConfig, storedProfiles, type TestApp } from './helpers/auth.js';
import { scanHandlers } from './helpers/routes.js';

const ALICE = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const BOB = 'aaaaaaaa-0000-4000-8000-0000000000b2';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';

const ARCGIS_KEY = 'AAPK-test-key-not-real';
const OTHER_SECRET = 'datoms-secret-token-value';

describe('GET /v1/me', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    t.directory.assignUserRole(ALICE, 'site_user');
    t.directory.grantProjectToUser(ALICE, P1);
    t.directory.assignUserRole(BOB, 'admin');
    storedProfiles.set(t.directory.ensureUser(ALICE).id, {
      name: 'Alice A',
      email: 'alice@innovo.example',
    });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('is registered as @AnySignedIn', () => {
    const h = scanHandlers(t.app).find((x) => x.path === '/v1/me' || x.path === '/me');
    expect(h?.policy.kind).toBe('any-signed-in');
  });

  it('returns 401 without a token', async () => {
    const res = await t.get('/v1/me');
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['content-type'])).toContain('application/problem+json');
  });

  it('returns 403 for a deactivated user', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-0000000000c3';
    t.directory.assignUserRole(oid, 'admin');
    t.directory.setActive(oid, false);
    expect((await t.get('/v1/me', await t.token({ claims: { oid } }))).statusCode).toBe(403);
  });

  it('returns the caller own id, profile, roles, permissions and project scope, and nothing else', async () => {
    const res = await t.get('/v1/me', await t.token({ claims: { oid: ALICE } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = meResponseSchema.parse(res.json());
    expect(Object.keys(res.json() as object).sort()).toEqual([
      'email',
      'id',
      'name',
      'permissions',
      'projectScope',
      'roles',
    ]);
    expect(body).toEqual({
      id: t.directory.ensureUser(ALICE).id,
      name: 'Alice A',
      email: 'alice@innovo.example',
      roles: ['site_user'],
      permissions: [
        'asset.read',
        'events.read',
        'portfolio.read',
        'project.read',
        'telemetry.history',
      ],
      projectScope: { all: false, projectIds: [P1] },
    });
  });

  it('returns null name and email when none is stored', async () => {
    const res = await t.get('/v1/me', await t.token({ claims: { oid: BOB } }));
    const body = meResponseSchema.parse(res.json());
    expect(body.name).toBeNull();
    expect(body.email).toBeNull();
  });

  it('an all-projects role gets all=true and an empty list', async () => {
    const res = await t.get('/v1/me', await t.token({ claims: { oid: BOB } }));
    const body = meResponseSchema.parse(res.json());
    expect(body.roles).toEqual(['admin']);
    expect(body.permissions).toEqual([...PERMISSION_KEYS].sort());
    expect(body.projectScope).toEqual({ all: true, projectIds: [] });
  });

  it("never shows another user's data (scope and profile)", async () => {
    t.directory.grantProjectToUser(BOB, P2); // ignored for an all-projects role, but must not reach Alice
    const alice = meResponseSchema.parse(
      (await t.get('/v1/me', await t.token({ claims: { oid: ALICE } }))).json(),
    );
    expect(alice.projectScope.projectIds).not.toContain(P2);
    expect(JSON.stringify(alice)).not.toContain('admin');
  });

  it('has no project route to scope: a project id in the query string changes nothing', async () => {
    const res = await t.get(`/v1/me?projectId=${P2}`, await t.token({ claims: { oid: ALICE } }));
    expect(meResponseSchema.parse(res.json()).projectScope.projectIds).toEqual([P1]);
  });
});

describe('GET /v1/config', () => {
  describe('with a key configured', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({
        env: {
          ARCGIS_API_KEY: ARCGIS_KEY,
          // Look-alike secrets that must never be echoed (the app does not read these names).
          DATOMS_API_TOKEN: OTHER_SECRET,
          AZURE_STORAGE_KEY: OTHER_SECRET,
        },
      });
      t.directory.assignUserRole(ALICE, 'viewer');
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('is registered as @AnySignedIn', () => {
      const h = scanHandlers(t.app).find((x) => x.path === '/v1/config' || x.path === '/config');
      expect(h?.policy.kind).toBe('any-signed-in');
    });

    it('returns 401 without a token', async () => {
      expect((await t.get('/v1/config')).statusCode).toBe(401);
    });

    it('returns 403 for a deactivated user', async () => {
      const oid = 'aaaaaaaa-0000-4000-8000-0000000000d4';
      t.directory.setActive(oid, false);
      expect((await t.get('/v1/config', await t.token({ claims: { oid } }))).statusCode).toBe(403);
    });

    it('serves the ArcGIS key to any signed-in user, never cached', async () => {
      const res = await t.get('/v1/config', await t.token({ claims: { oid: ALICE } }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = configResponseSchema.parse(res.json());
      expect(body.arcgis.apiKey).toBe(ARCGIS_KEY);
    });

    it('also answers a user without any role (any signed-in user)', async () => {
      const res = await t.get(
        '/v1/config',
        await t.token({ claims: { oid: 'aaaaaaaa-0000-4000-8000-0000000000e5' } }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('returns only allow-listed keys and no other env value or secret', async () => {
      const res = await t.get('/v1/config', await t.token({ claims: { oid: ALICE } }));
      const json = res.json() as Record<string, Record<string, unknown>>;
      expect(Object.keys(json).sort()).toEqual(['arcgis', 'enums', 'featureFlags']);
      expect(Object.keys(json['arcgis']!).sort()).toEqual([
        'apiKey',
        'basemaps',
        'extent',
        'initialView',
      ]);
      expect(Object.keys(json['enums']!).sort()).toEqual(['displayStatuses', 'projectStates']);

      const text = res.body;
      expect(text).not.toContain(OTHER_SECRET);
      expect(text).not.toContain(t.config.database.url);
      for (const forbidden of [
        t.config.auth.tenantId,
        t.config.auth.webClientId,
        ...t.config.auth.audiences,
        'postgres://',
        'DATABASE_URL',
      ])
        expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      // The key appears exactly once, in arcgis.apiKey.
      expect(text.split(ARCGIS_KEY)).toHaveLength(2);
    });

    it('gets enums and flags from data, labels made from the keys', async () => {
      storedConfig.displayStatusKeys = ['maintenance', 'running'];
      const body = configResponseSchema.parse(
        (await t.get('/v1/config', await t.token({ claims: { oid: ALICE } }))).json(),
      );
      expect(body.featureFlags).toEqual({ 'project.weather': false, 'explorer.csv_export': true });
      expect(body.enums.displayStatuses).toEqual([
        { key: 'maintenance', label: 'Maintenance' },
        { key: 'running', label: 'Running' },
        { key: 'unknown', label: 'Unknown' },
      ]);
      expect(body.enums.projectStates.map((s) => s.key)).toContain('central_store');
      expect(body.enums.projectStates.find((s) => s.key === 'central_store')?.label).toBe(
        'Central store',
      );
      storedConfig.displayStatusKeys = ['running', 'idle'];
    });

    it('returns the UAE extent and basemap ids', async () => {
      const body = configResponseSchema.parse(
        (await t.get('/v1/config', await t.token({ claims: { oid: ALICE } }))).json(),
      );
      expect(body.arcgis.basemaps.map2d).toBe('arcgis/light-gray');
      expect(body.arcgis.extent.xmin).toBeLessThan(body.arcgis.initialView.longitude);
      expect(body.arcgis.extent.xmax).toBeGreaterThan(body.arcgis.initialView.longitude);
      expect(body.arcgis.extent.ymin).toBeLessThan(body.arcgis.initialView.latitude);
      expect(body.arcgis.extent.ymax).toBeGreaterThan(body.arcgis.initialView.latitude);
    });
  });

  describe('without a key', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ env: { ARCGIS_API_KEY: '' } });
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('returns an empty key (the web shows "Map key not configured")', async () => {
      const res = await t.get('/v1/config', await t.token());
      expect(res.statusCode).toBe(200);
      expect(configResponseSchema.parse(res.json()).arcgis.apiKey).toBe('');
    });
  });

  it('treats a blank or whitespace key as not configured', () => {
    const base = {
      APP_ENV: 'local',
      ENTRA_TENANT_ID: '11111111-2222-4333-8444-555555555555',
      ENTRA_API_CLIENT_ID: '99999999-8888-4777-8666-555555555555',
      ENTRA_WEB_CLIENT_ID: '77777777-6666-4555-8444-333333333333',
      ENTRA_API_AUDIENCE: 'api://nexus-api',
      DATABASE_URL: 'postgres://x@127.0.0.1:1/x',
    };
    expect(loadConfig({ ...base, ARCGIS_API_KEY: '' }).arcgis.apiKey).toBeUndefined();
    expect(loadConfig({ ...base, ARCGIS_API_KEY: '   ' }).arcgis.apiKey).toBeUndefined();
    expect(loadConfig(base).arcgis.apiKey).toBeUndefined();
    expect(loadConfig({ ...base, ARCGIS_API_KEY: ' k ' }).arcgis.apiKey).toBe('k');
  });
});
