import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiError, createApiClient } from '../src/api/client';
import { describeError, retryDelay, shouldRetry } from '../src/api/errors';
import { ErrorState, Value } from '../src/components/feedback';

const problem = (status: number, extra: Record<string, unknown> = {}) => ({
  type: 'about:blank',
  title: 'T',
  status,
  detail: 'd',
  ...extra,
});

it('QA: a real 0 renders as 0, not a dash', () => {
  const { container } = render(<Value value={0} unit="kW" />);
  expect(container.textContent).toContain('0 kW');
  expect(container.textContent).not.toContain('—');
});

it('QA: null with a timestamp shows a dash, "No data yet" and the last-known time', () => {
  const { container } = render(<Value value={null} updatedAt="2026-10-14T08:05:00Z" />);
  expect(container.textContent).toContain('—');
  expect(screen.getByText('No data yet')).toBeTruthy();
  expect(container.textContent).toContain('12:05'); // Asia/Dubai = UTC+4
});

it('QA: problem+json text is rendered escaped and truncated, with no HTML', () => {
  const html = '<img src=x onerror=alert(1)>' + 'a'.repeat(1000);
  const { container } = render(
    <ErrorState error={new ApiError(500, problem(500, { detail: html }))} />,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent!.length).toBeLessThan(700);
});

it('QA: 404 view is identical whatever the API detail, so existence is not revealed by our text', () => {
  const a = describeError(new ApiError(404, undefined));
  expect(a.message).toBe('This does not exist, or it is not available to you.');
});

it('QA: retry policy has no storm: 4xx/429 never, 5xx/network at most twice, 1s then 2s', () => {
  for (const s of [400, 401, 403, 404, 422, 429]) {
    expect(shouldRetry(0, new ApiError(s, undefined))).toBe(false);
  }
  expect(shouldRetry(0, new ApiError(503, undefined))).toBe(true);
  expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true);
  expect(shouldRetry(2, new ApiError(503, undefined))).toBe(false);
  expect(shouldRetry(0, new Error('render bug'))).toBe(false);
  expect([retryDelay(0), retryDelay(1)]).toEqual([1000, 2000]);
});

it('QA: 403 and 404 hide the retry button; 500 shows it', () => {
  const retry = () => undefined;
  const { rerender } = render(<ErrorState error={new ApiError(403, undefined)} onRetry={retry} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<ErrorState error={new ApiError(404, undefined)} onRetry={retry} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<ErrorState error={new ApiError(500, undefined)} onRetry={retry} />);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

async function retryAfterFor(value: string) {
  const client = createApiClient({
    baseUrl: 'http://localhost/v1',
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify(problem(429)), {
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'Retry-After': value },
        }),
      ),
  });
  try {
    await client.GET('/health/live' as never);
  } catch (e) {
    return (e as ApiError).retryAfterSeconds;
  }
  return undefined;
}

it('QA: Retry-After in seconds is parsed', async () => {
  expect(await retryAfterFor('7')).toBe(7);
});

// BUG (S1-07-QA-1): the HTTP-date form of Retry-After is ignored.
it('QA: Retry-After as an HTTP-date is converted to seconds', async () => {
  const date = new Date(Date.now() + 30_000).toUTCString();
  const secs = await retryAfterFor(date);
  expect(secs).toBeGreaterThan(20);
  expect(secs).toBeLessThanOrEqual(30);
});

// BUG (S1-07-QA-2): NaN renders as the text "NaN" instead of a dash.
it('QA: Value treats NaN as missing', () => {
  const { container } = render(<Value value={Number.NaN} />);
  expect(container.textContent).not.toContain('NaN');
  expect(container.textContent).toContain('—');
});

// BUG (S1-07-QA-3): whitespace-only string renders blank, not a dash.
it('QA: Value treats a whitespace-only string as missing', () => {
  const { container } = render(<Value value="   " />);
  expect(container.textContent).toContain('—');
});
