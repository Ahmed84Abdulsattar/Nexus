import { afterEach, expect, it } from 'vitest';
import {
  ApiError,
  createApiClient,
  resolveApiBase,
  setAccessTokenProvider,
  shouldSendToken,
} from '../src/api/client';

const json = (body: unknown, status: number, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

function recorder(response: () => Response = () => json({ status: 'ok' }, 200)) {
  const seen: Request[] = [];
  const fetcher = (input: RequestInfo | URL) => {
    seen.push(input as Request);
    return Promise.resolve(response());
  };
  return { seen, fetcher: fetcher as typeof fetch };
}

afterEach(() => setAccessTokenProvider(() => Promise.resolve(undefined)));

it('sends the bearer token to the API origin under /v1', async () => {
  const { seen, fetcher } = recorder();
  const client = createApiClient({
    baseUrl: 'http://api.test/v1',
    apiOrigin: 'http://api.test',
    fetch: fetcher,
  });
  setAccessTokenProvider(() => Promise.resolve('tok'));
  const { data } = await client.GET('/health/live');
  expect(data).toEqual({ status: 'ok' });
  expect(seen[0]?.url).toBe('http://api.test/v1/health/live');
  // Under /v1 on the API origin: the token is sent. (The typed path is reused only as a stand-in.)
  expect(seen[0]?.headers.get('authorization')).toBe('Bearer tok');
});

it('sends no token to /health/live, even on the API origin', async () => {
  const { seen, fetcher } = recorder();
  const client = createApiClient({
    baseUrl: 'http://api.test',
    apiOrigin: 'http://api.test',
    fetch: fetcher,
  });
  setAccessTokenProvider(() => Promise.resolve('tok'));
  await client.GET('/health/live');
  expect(seen[0]?.url).toBe('http://api.test/health/live');
  expect(seen[0]?.headers.get('authorization')).toBeNull();
});

it('decides per request: API origin yes, other origin no, /health no', () => {
  const api = 'http://api.test';
  expect(shouldSendToken('http://api.test/v1/projects', api)).toBe(true);
  expect(shouldSendToken('http://api.test/health/live', api)).toBe(false);
  expect(shouldSendToken('http://api.test/health', api)).toBe(false);
  expect(shouldSendToken('http://api.test/healthy', api)).toBe(true);
  expect(shouldSendToken('http://evil.test/v1/projects', api)).toBe(false);
  expect(shouldSendToken('https://api.test/v1/projects', api)).toBe(false);
  expect(shouldSendToken('http://api.test:8080/v1/projects', api)).toBe(false);
});

it('does not send the token to a client built for another origin', async () => {
  const { seen, fetcher } = recorder();
  const client = createApiClient({
    baseUrl: 'http://other.test/v1',
    apiOrigin: 'http://api.test',
    fetch: fetcher,
  });
  setAccessTokenProvider(() => Promise.resolve('tok'));
  await client.GET('/health/live');
  expect(seen[0]?.url).toBe('http://other.test/v1/health/live');
  expect(seen[0]?.headers.get('authorization')).toBeNull();
});

it('resolves a relative base against the page origin and requires it in prod', () => {
  expect(resolveApiBase('/v1', true, 'https://app.test').href).toBe('https://app.test/v1');
  expect(resolveApiBase('https://api.test/v1', true, 'https://app.test').origin).toBe(
    'https://api.test',
  );
  expect(() => resolveApiBase(undefined, true, 'https://app.test')).toThrow(/VITE_API_BASE_URL/);
  expect(resolveApiBase(undefined, false, 'http://localhost:5173').href).toBe(
    'http://localhost:5173/v1',
  );
});

it('throws ApiError carrying the problem+json body on a non-2xx response', async () => {
  const problem = { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Nope.' };
  const { fetcher } = recorder(() => json(problem, 404, 'application/problem+json'));
  const client = createApiClient({ baseUrl: 'http://api.test/v1', fetch: fetcher });
  const error = await client.GET('/health/live').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
  expect((error as ApiError).problem).toEqual(problem);
});
