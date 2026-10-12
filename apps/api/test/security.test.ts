import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyResolver } from '../src/common/auth/key-resolver.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import {
  createTestApp,
  makeKeys,
  signToken,
  TENANT_ID,
  type TestApp,
  TEST_ENV,
} from './helpers/auth.js';

const PROJECT_A = 'cccccccc-0000-4000-8000-00000000000a';
const PROJECT_B = 'cccccccc-0000-4000-8000-00000000000b';

describe('token hardening', () => {
  let t: TestApp;
  beforeAll(async () => {
    const rs512 = await makeKeys('key-rs512', 'RS512');
    const ps256 = await makeKeys('key-ps256', 'PS256');
    t = await createTestApp({ withTestRoutes: true, extraKeys: [rs512, ps256] });
    (t as TestApp & { rs512: typeof rs512; ps256: typeof ps256 }).rs512 = rs512;
    (t as TestApp & { rs512: typeof rs512; ps256: typeof ps256 }).ps256 = ps256;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('refuses a token whose azp is not the Nexus web app (403)', async () => {
    const other = '00000000-0000-4000-8000-000000000001';
    expect(
      (await t.get('/test-auth/any', await t.token({ claims: { azp: other } }))).statusCode,
    ).toBe(403);
  });

  it('refuses a token without azp (403)', async () => {
    expect(
      (await t.get('/test-auth/any', await t.token({ claims: { azp: undefined } }))).statusCode,
    ).toBe(403);
  });

  it('refuses HS256 signed with the RSA public JWK as the secret (algorithm confusion)', async () => {
    const secret = new TextEncoder().encode(JSON.stringify(t.keys.publicJwk));
    const token = await signToken({ keys: t.keys, alg: 'HS256', signWith: secret });
    expect((await t.get('/test-auth/any', token)).statusCode).toBe(401);
  });

  it('refuses RS512 and PS256 tokens even when their keys are in the JWKS', async () => {
    const { rs512, ps256 } = t as unknown as Record<string, Awaited<ReturnType<typeof makeKeys>>>;
    const a = await signToken({ keys: rs512!, alg: 'RS512', signWith: rs512!.privateKey });
    const b = await signToken({ keys: ps256!, alg: 'PS256', signWith: ps256!.privateKey });
    expect((await t.get('/test-auth/any', a)).statusCode).toBe(401);
    expect((await t.get('/test-auth/any', b)).statusCode).toBe(401);
  });

  it.each([
    ['jwk', (k: { publicJwk: object }) => ({ jwk: k.publicJwk })],
    ['jku', () => ({ jku: 'http://127.0.0.1:1/attacker-keys' })],
    ['x5u', () => ({ x5u: 'http://127.0.0.1:1/attacker.pem' })],
  ])('ignores a header-embedded %s that points at an attacker key', async (_name, header) => {
    const attacker = await makeKeys('test-key-1'); // same kid as the real key
    const token = await signToken({ keys: attacker, header: header(attacker) });
    expect((await t.get('/test-auth/any', token)).statusCode).toBe(401);
  });
});

describe('project scope applies to every :projectId route without opting in', () => {
  let t: TestApp;
  const oid = 'aaaaaaaa-0000-4000-8000-0000000000b1';
  beforeAll(async () => {
    t = await createTestApp({ withTestRoutes: true });
    t.directory.assignUserRole(oid, 'site_user');
    t.directory.grantProjectToUser(oid, PROJECT_A);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('404 for a project outside the scope', async () => {
    expect(
      (await t.get(`/test-auth/projects/${PROJECT_B}`, await t.token({ claims: { oid } })))
        .statusCode,
    ).toBe(404);
  });

  it.each(['not-a-uuid', '123', 'cccccccc-0000-4000-8000-00000000000'])(
    '404 for the malformed id %s, even for an all-projects admin',
    async (bad) => {
      const admin = 'aaaaaaaa-0000-4000-8000-0000000000b2';
      t.directory.assignUserRole(admin, 'admin');
      expect(
        (await t.get(`/test-auth/projects/${bad}`, await t.token({ claims: { oid } }))).statusCode,
      ).toBe(404);
      expect(
        (await t.get(`/test-auth/projects/${bad}`, await t.token({ claims: { oid: admin } })))
          .statusCode,
      ).toBe(404);
    },
  );

  it('matches ids case-insensitively', async () => {
    const res = await t.get(
      `/test-auth/projects/${PROJECT_A.toUpperCase()}`,
      await t.token({ claims: { oid } }),
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('JWKS unavailable gives 503, not 401', () => {
  let server: Server;
  let mode: 'status500' | 'html';
  let base: string;
  let closedUrl: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      if (mode === 'status500') {
        res.statusCode = 500;
        res.end('boom');
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('<html><body>Sign in to your network</body></html>');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/keys`;
    await new Promise<void>((r) => closed.close(() => r()));
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function answerFor(url: string): Promise<number> {
    const t = await createTestApp({
      withTestRoutes: true,
      resolver: createKeyResolver(new URL(url)),
    });
    try {
      return (await t.get('/test-auth/any', await t.token())).statusCode;
    } finally {
      await t.app.close();
    }
  }

  it('JWKS endpoint answers 500', async () => {
    mode = 'status500';
    expect(await answerFor(`${base}/keys`)).toBe(503);
  });

  it('JWKS endpoint answers HTML with status 200', async () => {
    mode = 'html';
    expect(await answerFor(`${base}/keys`)).toBe(503);
  });

  it('JWKS endpoint refuses the connection', async () => {
    expect(await answerFor(closedUrl)).toBe(503);
  });
});

describe('ENTRA_JWKS_URL is restricted outside local', () => {
  const derived = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

  it('refuses an http URL in prod', () => {
    expect(() =>
      loadConfig({ ...TEST_ENV, APP_ENV: 'prod', ENTRA_JWKS_URL: 'http://127.0.0.1:9/keys' }),
    ).toThrow(/ENTRA_JWKS_URL/);
  });

  it('refuses a foreign https host in prod and dev', () => {
    for (const APP_ENV of ['prod', 'dev']) {
      expect(() =>
        loadConfig({ ...TEST_ENV, APP_ENV, ENTRA_JWKS_URL: 'https://evil.example/keys' }),
      ).toThrow(ConfigError);
    }
  });

  it('refuses another tenant JWKS URL in prod', () => {
    const other =
      'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/discovery/v2.0/keys';
    expect(() => loadConfig({ ...TEST_ENV, APP_ENV: 'prod', ENTRA_JWKS_URL: other })).toThrow(
      /ENTRA_JWKS_URL/,
    );
  });

  it('accepts exactly the derived URL, or none, in prod', () => {
    expect(loadConfig({ ...TEST_ENV, APP_ENV: 'prod', ENTRA_JWKS_URL: derived }).auth.jwksUrl).toBe(
      derived,
    );
    expect(loadConfig({ ...TEST_ENV, APP_ENV: 'prod' }).auth.jwksUrl).toBe(derived);
  });

  it('accepts any URL when APP_ENV=local', () => {
    expect(
      loadConfig({ ...TEST_ENV, ENTRA_JWKS_URL: 'http://127.0.0.1:9/keys' }).auth.jwksUrl,
    ).toBe('http://127.0.0.1:9/keys');
  });

  it('treats empty strings as unset (cp .env.example .env)', () => {
    const c = loadConfig({ ...TEST_ENV, APP_ENV: 'prod', AUTH_MODE: '', ENTRA_JWKS_URL: '' });
    expect(c.auth.mode).toBe('entra');
    expect(c.auth.jwksUrl).toBe(derived);
  });

  it('validates the Entra ids and the audience form', () => {
    expect(() => loadConfig({ ...TEST_ENV, ENTRA_API_CLIENT_ID: 'nope' })).toThrow(
      /ENTRA_API_CLIENT_ID/,
    );
    expect(() => loadConfig({ ...TEST_ENV, ENTRA_API_AUDIENCE: 'nexus-api' })).toThrow(
      /ENTRA_API_AUDIENCE/,
    );
    expect(() => loadConfig({ ...TEST_ENV, ENTRA_WEB_CLIENT_ID: '' })).toThrow(
      /ENTRA_WEB_CLIENT_ID/,
    );
  });
});
