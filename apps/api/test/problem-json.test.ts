import { problemDetailsSchema } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/auth.js';

const SITE_USER = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const OTHER_PROJECT = 'cccccccc-0000-4000-8000-00000000000b';
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ withTestRoutes: true });
  t.directory.assignUserRole(SITE_USER, 'site_user');
});
afterAll(async () => {
  await t.app.close();
});

type Res = Awaited<ReturnType<TestApp['get']>>;
function expectProblem(res: Res, status: number): void {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toContain('application/problem+json');
  const body = problemDetailsSchema.parse(res.json());
  expect(body.status).toBe(status);
  expect(body.type).toBe('about:blank');
}

describe('errors are application/problem+json matching problemDetailsSchema', () => {
  it('401 without a token', async () => {
    const res = await t.get('/v1/test-auth/any');
    expectProblem(res, 401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('403 for a valid token without the permission', async () => {
    expectProblem(await t.get('/v1/test-auth/admin', await t.token()), 403);
  });

  it('404 for a project outside the scope (not 403)', async () => {
    expectProblem(
      await t.get(
        `/v1/test-auth/projects/${OTHER_PROJECT}`,
        await t.token({ claims: { oid: SITE_USER } }),
      ),
      404,
    );
  });

  it('404 for an unknown route', async () => {
    expectProblem(await t.get('/nope'), 404);
  });

  it('422 for an invalid body, with field errors', async () => {
    const res = await t.post('/v1/test-auth/echo', { name: '', count: 1.5 }, await t.token());
    expectProblem(res, 422);
    const paths = problemDetailsSchema.parse(res.json()).errors?.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'count']));
  });

  it('echoes a safe X-Correlation-Id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/test-auth/any',
      headers: { 'x-correlation-id': 'abc-123' },
    });
    expect(problemDetailsSchema.parse(res.json()).correlationId).toBe('abc-123');
  });
});

describe('zod DTO validation', () => {
  it('accepts a valid body', async () => {
    const res = await t.post('/v1/test-auth/echo', { name: 'x', count: 2 }, await t.token());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ name: 'x', count: 2 });
  });

  it('applies the shared cursor paging query: coerces and defaults', async () => {
    const token = await t.token();
    expect((await t.get('/v1/test-auth/page?limit=10&cursor=abc', token)).json()).toEqual({
      limit: 10,
      cursor: 'abc',
    });
    expect((await t.get('/v1/test-auth/page', token)).json()).toEqual({ limit: 50 });
  });

  it.each(['limit=0', 'limit=501', 'limit=abc', 'cursor='])('rejects ?%s with 422', async (q) => {
    expectProblem(await t.get(`/v1/test-auth/page?${q}`, await t.token()), 422);
  });

  it('checks authentication before validation (401 beats 422)', async () => {
    expectProblem(await t.post('/v1/test-auth/echo', { name: '' }), 401);
  });
});
