import { expect, it } from 'vitest';
import { ApiError, createApiClient } from '../src/api/client';
import { describeError, retryDelay, shouldRetry } from '../src/api/errors';

const problem = (status: number, detail = 'd') => ({
  type: 'about:blank',
  title: 'T',
  status,
  detail,
});

it.each([
  [401, 'unauthenticated', 'Sign-in needed'],
  [403, 'forbidden', 'No access'],
  [404, 'not-found', 'Not found'],
  [422, 'invalid', 'Request not accepted'],
  [429, 'rate-limited', 'Too many requests'],
  [500, 'server', 'Service problem'],
  [503, 'server', 'Service problem'],
])('maps HTTP %i to %s', (status, kind, title) => {
  const view = describeError(new ApiError(status, problem(status)));
  expect(view.kind).toBe(kind);
  expect(view.title).toBe(title);
});

it('maps a network failure (fetch TypeError) to a retryable network error', () => {
  expect(describeError(new TypeError('Failed to fetch')).kind).toBe('network');
});

it('never exposes the message of an unknown error (could be a stack or internals)', () => {
  const view = describeError(new Error('secret stack at /src/x.ts:1'));
  expect(JSON.stringify(view)).not.toContain('secret');
});

it('puts the Retry-After seconds in the 429 message', () => {
  const view = describeError(new ApiError(429, problem(429), 17));
  expect(view.message).toContain('17 s');
  expect(view.retryAfterSeconds).toBe(17);
});

it('reads Retry-After from the response header through the client', async () => {
  const fetcher = (() =>
    Promise.resolve(
      new Response(JSON.stringify(problem(429)), {
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'Retry-After': '12' },
      }),
    )) as typeof fetch;
  const client = createApiClient({ baseUrl: 'http://api.test/v1', fetch: fetcher });
  const error = await client.GET('/health/live').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).retryAfterSeconds).toBe(12);
});

it('ignores an invalid Retry-After', () => {
  expect(describeError(new ApiError(429, problem(429), undefined)).message).not.toContain('NaN');
});

it('truncates long API text and strips control characters', () => {
  const view = describeError(new ApiError(500, problem(500, `a\u0000b${'x'.repeat(500)}`)));
  expect(view.problemDetail).not.toContain('\u0000');
  expect(view.problemDetail!.length).toBeLessThanOrEqual(301);
});

it('retries 5xx and network errors but never 4xx', () => {
  expect(shouldRetry(0, new ApiError(503, undefined))).toBe(true);
  expect(shouldRetry(0, new TypeError('x'))).toBe(true);
  expect(shouldRetry(2, new ApiError(503, undefined))).toBe(false);
  for (const status of [400, 401, 403, 404, 422, 429]) {
    expect(shouldRetry(0, new ApiError(status, undefined))).toBe(false);
  }
  expect(shouldRetry(0, new Error('x'))).toBe(false);
});

it('backs off exponentially with a cap', () => {
  expect([0, 1, 2].map(retryDelay)).toEqual([1000, 2000, 4000]);
  expect(retryDelay(10)).toBe(10_000);
});
