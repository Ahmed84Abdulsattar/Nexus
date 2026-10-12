import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  makeKeys,
  signToken,
  type TestApp,
  TENANT_ID,
  USER_OID,
} from './helpers/auth.js';

const GROUP_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const PROJECT_A = 'cccccccc-0000-4000-8000-00000000000a';
const PROJECT_B = 'cccccccc-0000-4000-8000-00000000000b';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ withTestRoutes: true });
});
afterAll(async () => {
  await t.app.close();
});

/** Asserts a problem+json answer of the given status. */
function expectProblem(
  res: { statusCode: number; headers: Record<string, unknown>; json(): unknown },
  status: number,
) {
  expect(res.statusCode).toBe(status);
  expect(String(res.headers['content-type'])).toContain('application/problem+json');
  expect(res.json()).toMatchObject({ type: 'about:blank', status, title: expect.any(String) });
}

describe('token validation (EntraJwtGuard)', () => {
  it('accepts a valid token', async () => {
    const res = await t.get('/v1/test-auth/any', await t.token());
    expect(res.statusCode).toBe(200);
  });

  it('accepts the API client id as audience (v2 tokens)', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ audience: t.config.auth.audiences[1] }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('rejects a missing token with 401 and a Bearer challenge', async () => {
    const res = await t.get('/v1/test-auth/any');
    expectProblem(res, 401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects a non-bearer or garbage Authorization header with 401', async () => {
    const basic = await t.app.inject({
      method: 'GET',
      url: '/v1/test-auth/any',
      headers: { authorization: 'Basic abc' },
    });
    expectProblem(basic, 401);
    expectProblem(await t.get('/v1/test-auth/any', 'not-a-jwt'), 401);
  });

  it('rejects the wrong issuer', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ issuer: 'https://evil.example/v2.0' }),
    );
    expectProblem(res, 401);
  });

  it('rejects an issuer of another tenant', async () => {
    const other = 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0';
    expectProblem(await t.get('/v1/test-auth/any', await t.token({ issuer: other })), 401);
  });

  it('rejects the wrong audience', async () => {
    const res = await t.get('/v1/test-auth/any', await t.token({ audience: 'api://someone-else' }));
    expectProblem(res, 401);
  });

  it('rejects the wrong tid even when iss and signature are fine', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ claims: { tid: '00000000-0000-4000-8000-000000000000' } }),
    );
    expectProblem(res, 401);
  });

  it('rejects a missing tid', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { tid: undefined } })),
      401,
    );
  });

  it('accepts the tid in upper case', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ claims: { tid: TENANT_ID.toUpperCase() } }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses a token without scp with 403', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { scp: undefined } })),
      403,
    );
  });

  it('refuses a token with another scope with 403', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { scp: 'other.scope' } })),
      403,
    );
  });

  it('accepts access_as_user among several scopes', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ claims: { scp: 'foo access_as_user bar' } }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('does not treat a scope that only contains the name as a match', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ claims: { scp: 'access_as_user_admin' } }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('rejects an expired token', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ expiresIn: Math.floor(Date.now() / 1000) - 3600 }),
    );
    expectProblem(res, 401);
  });

  it('rejects a token that is not valid yet (nbf in the future)', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({ notBefore: Math.floor(Date.now() / 1000) + 3600 }),
    );
    expectProblem(res, 401);
  });

  it('rejects a token signed by a key that is not in the JWKS (bad signature)', async () => {
    const stranger = await makeKeys('test-key-1'); // same kid, different key
    const token = await signToken({ keys: stranger });
    expectProblem(await t.get('/v1/test-auth/any', token), 401);
  });

  it('rejects an unknown kid', async () => {
    expectProblem(await t.get('/v1/test-auth/any', await t.token({ kid: 'unknown-kid' })), 401);
  });

  it('rejects an unsigned (alg none) token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: t.config.auth.issuer, aud: 'api://nexus-api', tid: TENANT_ID, oid: USER_OID, scp: 'access_as_user', exp: 9999999999 })}.`;
    expectProblem(await t.get('/v1/test-auth/any', token), 401);
  });

  it('rejects a token without an oid', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { oid: undefined } })),
      401,
    );
  });
});

describe('groups claim (ADR 0008)', () => {
  it('refuses a token with a group overage marker with 403 and no Graph call', async () => {
    const res = await t.get(
      '/v1/test-auth/any',
      await t.token({
        claims: {
          _claim_names: { groups: 'src1' },
          _claim_sources: { src1: { endpoint: 'https://graph.example/users/x/getMemberObjects' } },
        },
      }),
    );
    expectProblem(res, 403);
  });

  it('refuses hasgroups=true without a groups claim with 403', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { hasgroups: true } })),
      403,
    );
  });

  it('rejects a malformed groups claim', async () => {
    expectProblem(
      await t.get('/v1/test-auth/any', await t.token({ claims: { groups: 'not-an-array' } })),
      401,
    );
  });

  it('maps token groups to roles', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    t.directory.assignGroupRole(GROUP_A, 'viewer');
    const token = await t.token({ claims: { oid, groups: [GROUP_A] } });
    expect((await t.get('/v1/test-auth/asset', token)).statusCode).toBe(200);
  });
});

describe('decorators', () => {
  it('@Public allows anonymous callers', async () => {
    const res = await t.get('/v1/test-auth/public');
    expect(res.statusCode).toBe(200);
  });

  it('@Public also works when a bad token is sent (no token is read)', async () => {
    expect((await t.get('/v1/test-auth/public', 'garbage')).statusCode).toBe(200);
  });

  it('GET /health/live is public', async () => {
    const res = await t.get('/health/live');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('@AnySignedIn requires a token', async () => {
    expect((await t.get('/v1/test-auth/any')).statusCode).toBe(401);
  });

  it('@AnySignedIn allows a valid user with no roles at all', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-000000000002';
    expect((await t.get('/v1/test-auth/any', await t.token({ claims: { oid } }))).statusCode).toBe(
      200,
    );
  });

  it('@RequirePermission requires a token', async () => {
    expect((await t.get('/v1/test-auth/asset')).statusCode).toBe(401);
  });

  it('@RequirePermission denies a user without the permission (403)', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-000000000003';
    const res = await t.get('/v1/test-auth/asset', await t.token({ claims: { oid } }));
    expectProblem(res, 403);
  });

  it('@RequirePermission allows a user with the permission', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-000000000004';
    t.directory.assignUserRole(oid, 'viewer');
    const token = await t.token({ claims: { oid } });
    expect((await t.get('/v1/test-auth/asset', token)).statusCode).toBe(200);
    // viewer has asset.read but not admin.users.manage
    expectProblem(await t.get('/v1/test-auth/admin', token), 403);
  });

  it('admin has every permission', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-000000000005';
    t.directory.assignUserRole(oid, 'admin');
    expect(
      (await t.get('/v1/test-auth/admin', await t.token({ claims: { oid } }))).statusCode,
    ).toBe(200);
  });

  it('an inactive user gets 403', async () => {
    const oid = 'aaaaaaaa-0000-4000-8000-000000000006';
    t.directory.assignUserRole(oid, 'admin');
    t.directory.setActive(oid, false);
    expectProblem(await t.get('/v1/test-auth/any', await t.token({ claims: { oid } })), 403);
  });
});

describe('project scope (404, never 403)', () => {
  const oid = 'aaaaaaaa-0000-4000-8000-000000000007';
  beforeEach(() => {
    t.directory.assignUserRole(oid, 'site_user');
    t.directory.grantProjectToUser(oid, PROJECT_A);
  });

  it('allows a project in scope', async () => {
    const res = await t.get(
      `/v1/test-auth/projects/${PROJECT_A}`,
      await t.token({ claims: { oid } }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('answers 404 for a project outside the scope', async () => {
    const res = await t.get(
      `/v1/test-auth/projects/${PROJECT_B}`,
      await t.token({ claims: { oid } }),
    );
    expectProblem(res, 404);
  });

  it('answers 404 (not 403) for a project that does not exist', async () => {
    const res = await t.get(
      '/v1/test-auth/projects/not-a-project',
      await t.token({ claims: { oid } }),
    );
    expect(res.statusCode).toBe(404);
  });

  it('lets all-projects roles reach any project', async () => {
    const lead = 'aaaaaaaa-0000-4000-8000-000000000008';
    t.directory.assignUserRole(lead, 'leadership');
    const res = await t.get(
      `/v1/test-auth/projects/${PROJECT_B}`,
      await t.token({ claims: { oid: lead } }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('applies project grants made to a group in the token', async () => {
    const member = 'aaaaaaaa-0000-4000-8000-000000000009';
    const group = 'bbbbbbbb-0000-4000-8000-00000000000b';
    t.directory.assignUserRole(member, 'site_user'); // role comes from the user, scope from the group
    t.directory.grantProjectToGroup(group, PROJECT_B);
    const inGroup = await t.token({ claims: { oid: member, groups: [group] } });
    const noGroup = await t.token({ claims: { oid: member } });
    expect((await t.get(`/v1/test-auth/projects/${PROJECT_B}`, inGroup)).statusCode).toBe(200);
    expect((await t.get(`/v1/test-auth/projects/${PROJECT_B}`, noGroup)).statusCode).toBe(404);
  });

  it('checks the permission before the scope: no permission is 403 even in scope', async () => {
    const noRole = 'aaaaaaaa-0000-4000-8000-00000000000a';
    t.directory.grantProjectToUser(noRole, PROJECT_A);
    const res = await t.get(
      `/v1/test-auth/projects/${PROJECT_A}`,
      await t.token({ claims: { oid: noRole } }),
    );
    expect(res.statusCode).toBe(403);
  });
});
