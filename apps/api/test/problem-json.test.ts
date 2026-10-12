import { problemDetailsSchema } from '@nexus/shared';
import { HttpException, Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProblemJsonFilter } from '../src/common/http/problem-json.filter.js';
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

describe('error details do not leak', () => {
  it('gives out-of-scope and malformed project ids identical 404 bodies', async () => {
    const token = await t.token({ claims: { oid: SITE_USER } });
    const a = await t.get(`/v1/test-auth/projects/${OTHER_PROJECT}`, token);
    const b = await t.get('/v1/test-auth/projects/not-a-uuid', token);
    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    const strip = (r: Res) => ({ ...r.json<object>(), correlationId: undefined });
    expect(strip(a)).toEqual(strip(b));
    expect(a.json<{ detail: string }>().detail).toBe('Not found.');
  });

  it('does not echo the requested path on an unknown route', async () => {
    const res = await t.get('/v1/secret-probe-xyz');
    expect(res.json<{ detail: string }>().detail).toBe('Not found.');
    expect(res.body).not.toContain('secret-probe-xyz');
  });

  it('answers 500 with fixed text and logs status, correlationId and stack', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logs.push(String(m));
    });
    try {
      const filter = new ProblemJsonFilter();
      const sent: unknown[] = [];
      const reply = {
        status: () => reply,
        header: () => reply,
        send: (b: unknown) => (sent.push(b), reply),
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => reply,
          getRequest: () => ({ headers: { 'x-correlation-id': 'cid-1' } }),
        }),
      };
      filter.catch(new Error('db password is hunter2'), host as never);
      filter.catch(new HttpException('internal detail', 503), host as never);
      expect(JSON.stringify(sent)).not.toContain('hunter2');
      expect(JSON.stringify(sent)).not.toContain('internal detail');
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatch(/status=500 correlationId=cid-1 Error: db password/);
      expect(logs[1]).toMatch(/status=503 correlationId=cid-1/);
    } finally {
      spy.mockRestore();
    }
  });

  it('turns malformed JSON into a 400 problem, not a 500', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-auth/echo',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await t.token()}`,
      },
      payload: '{ not json',
    });
    expectProblem(res, 400);
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

  it('caps the 422 errors list at 20 and says how many were left out', async () => {
    const res = await t.post(
      '/v1/test-auth/many',
      { items: Array.from({ length: 30 }, () => 'x') },
      await t.token(),
    );
    expectProblem(res, 422);
    const body = problemDetailsSchema.parse(res.json());
    expect(body.errors).toHaveLength(20);
    expect(body.detail).toContain('10 more errors not shown');
  });

  it('checks authentication before validation (401 beats 422)', async () => {
    expectProblem(await t.post('/v1/test-auth/echo', { name: '' }), 401);
  });
});
