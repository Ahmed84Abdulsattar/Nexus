import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { apiAuthMiddleware, resolveApiBase, setAccessTokenProvider } from '../src/api/client';
import { fetchConfig } from '../src/api/queries';
import { configBody } from '../src/test/handlers';
import { server } from '../src/test/server';

afterEach(() => setAccessTokenProvider(() => Promise.resolve(undefined)));

async function tokenFor(url: string): Promise<string | null> {
  const middleware = apiAuthMiddleware();
  const request = new Request(url);
  await middleware.onRequest?.({ request } as never);
  return request.headers.get('authorization');
}

it('derives the token origin from the configured API base', async () => {
  setAccessTokenProvider(() => Promise.resolve('tok'));
  const api = resolveApiBase().origin;
  expect(await tokenFor(`${api}/v1/config`)).toBe('Bearer tok');
});

it('sends no token to another origin or to /health/*', async () => {
  setAccessTokenProvider(() => Promise.resolve('tok'));
  const api = resolveApiBase().origin;
  expect(await tokenFor('https://evil.test/v1/config')).toBeNull();
  expect(await tokenFor(`${api}/health/live`)).toBeNull();
  expect(await tokenFor('https://api.arcgis.com/x')).toBeNull();
});

it('the pending client sends the token only on its own API requests', async () => {
  setAccessTokenProvider(() => Promise.resolve('tok'));
  let auth: string | null = 'unset';
  server.use(
    http.get('*/v1/config', ({ request }) => {
      auth = request.headers.get('authorization');
      return HttpResponse.json(configBody(''));
    }),
  );
  await fetchConfig();
  expect(auth).toBe('Bearer tok');
});

it('a production build rejects a non-https API base', () => {
  expect(() => resolveApiBase('http://api.test/v1', true, 'https://app.test')).toThrow(/https/);
  expect(resolveApiBase('https://api.test/v1', true, 'https://app.test').protocol).toBe('https:');
  expect(resolveApiBase('http://localhost:3000/v1', false, 'http://localhost:5173').protocol).toBe(
    'http:',
  );
});
