import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { makeKeys, signToken, TEST_ENV, TENANT_ID } from './helpers/auth.js';

describe('loadConfig', () => {
  it('derives issuer, audiences and the JWKS url from the environment', () => {
    const c = loadConfig({ ...TEST_ENV });
    expect(c.auth.issuer).toBe(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`);
    expect(c.auth.audiences).toEqual(['api://nexus-api', TEST_ENV.ENTRA_API_CLIENT_ID]);
    expect(c.auth.jwksUrl).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
    );
    expect(c.auth.requiredScope).toBe('access_as_user');
  });

  it('takes the JWKS url from ENTRA_JWKS_URL when set', () => {
    const c = loadConfig({ ...TEST_ENV, ENTRA_JWKS_URL: 'http://localhost:9999/keys' });
    expect(c.auth.jwksUrl).toBe('http://localhost:9999/keys');
  });

  it('refuses to start without the Entra variables', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ...TEST_ENV, ENTRA_TENANT_ID: 'not-a-guid' })).toThrow(
      /ENTRA_TENANT_ID/,
    );
    expect(() => loadConfig({ ...TEST_ENV, ENTRA_API_AUDIENCE: '' })).toThrow(/ENTRA_API_AUDIENCE/);
  });

  it('refuses AUTH_MODE=dev outside APP_ENV=local', () => {
    expect(() => loadConfig({ ...TEST_ENV, AUTH_MODE: 'dev', APP_ENV: 'dev' })).toThrow(
      /AUTH_MODE/,
    );
    expect(() => loadConfig({ ...TEST_ENV, AUTH_MODE: 'dev', APP_ENV: 'prod' })).toThrow(
      /AUTH_MODE/,
    );
    expect(loadConfig({ ...TEST_ENV, AUTH_MODE: 'dev', APP_ENV: 'local' }).auth.mode).toBe('dev');
  });

  describe('DATABASE_URL', () => {
    const plain = 'postgres://nexus_api@db.example:5432/nexus';

    it('is required and must be a postgres URL', () => {
      const env: Record<string, string> = { ...TEST_ENV };
      delete env['DATABASE_URL'];
      expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
      expect(() => loadConfig({ ...TEST_ENV, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    });

    it('needs no TLS locally but requires it in dev and prod (L9)', () => {
      expect(loadConfig({ ...TEST_ENV, APP_ENV: 'local', DATABASE_URL: plain }).database.url).toBe(
        plain,
      );
      for (const appEnv of ['dev', 'prod']) {
        expect(() => loadConfig({ ...TEST_ENV, APP_ENV: appEnv, DATABASE_URL: plain })).toThrow(
          /must use TLS/,
        );
        expect(
          loadConfig({ ...TEST_ENV, APP_ENV: appEnv, DATABASE_URL: plain + '?sslmode=verify-full' })
            .database.poolMax,
        ).toBe(10);
      }
    });

    it('refuses the PgBouncer port, where LISTEN is deaf (M4)', () => {
      expect(() =>
        loadConfig({ ...TEST_ENV, DATABASE_URL: 'postgres://nexus_api@db.example:6432/nexus' }),
      ).toThrow(/6432/);
    });

    it('never puts the URL in an error', () => {
      try {
        loadConfig({ ...TEST_ENV, APP_ENV: 'prod', DATABASE_URL: 'postgres://u:hunter2@h:5432/d' });
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain('hunter2');
      }
    });
  });

  it('defaults AUTH_MODE to entra', () => {
    const env: Record<string, string> = { ...TEST_ENV };
    delete env['AUTH_MODE'];
    expect(loadConfig(env).auth.mode).toBe('entra');
  });
});

describe('remote JWKS from config', () => {
  let server: Server;
  let url: string;
  let keys: Awaited<ReturnType<typeof makeKeys>>;

  beforeAll(async () => {
    keys = await makeKeys();
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [keys.publicJwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/keys`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('verifies a token against the JWKS served at the configured url', async () => {
    const config = loadConfig({ ...TEST_ENV, ENTRA_JWKS_URL: url });
    const jwks = createRemoteJWKSet(new URL(config.auth.jwksUrl));
    const { payload } = await jwtVerify(await signToken({ keys }), jwks, {
      issuer: config.auth.issuer,
      audience: config.auth.audiences,
    });
    expect(payload['tid']).toBe(TENANT_ID);
  });
});
