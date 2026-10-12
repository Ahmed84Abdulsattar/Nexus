import { expect, it } from 'vitest';
import { ApiError, createApiClient, setAccessTokenProvider } from '../src/api/client';

const json = (body: unknown, status: number, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

it('calls a typed path and sends the bearer token from the provider', async () => {
  let seen: Request | undefined;
  const client = createApiClient({
    baseUrl: 'http://api.test',
    fetch: (input) => {
      seen = input as Request;
      return Promise.resolve(json({ status: 'ok' }, 200));
    },
  });
  setAccessTokenProvider(() => Promise.resolve('tok'));
  const { data } = await client.GET('/health/live');
  expect(data).toEqual({ status: 'ok' });
  expect(seen?.url).toBe('http://api.test/health/live');
  expect(seen?.headers.get('authorization')).toBe('Bearer tok');
  setAccessTokenProvider(() => Promise.resolve(undefined));
});

it('throws ApiError carrying the problem+json body on a non-2xx response', async () => {
  const problem = { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Nope.' };
  const client = createApiClient({
    baseUrl: 'http://api.test',
    fetch: () => Promise.resolve(json(problem, 404, 'application/problem+json')),
  });
  const error = await client.GET('/health/live').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
  expect((error as ApiError).problem).toEqual(problem);
});
