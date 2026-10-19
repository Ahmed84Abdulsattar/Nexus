import { describe, expect, it } from 'vitest';
import {
  DatomsNetworkError,
  backoffMs,
  parseRetryAfter,
  withRetry,
  type DatomsResponse,
} from '../src/index.js';

const res = (status: number, retryAfter?: string): DatomsResponse => ({
  status,
  ok: status < 300,
  rateLimit: retryAfter ? { retryAfter } : {},
  durationMs: 1,
});

function run(statuses: (number | Error)[], retryAfter?: string) {
  const waits: number[] = [];
  let i = 0;
  const fn = () => {
    const s = statuses[Math.min(i++, statuses.length - 1)]!;
    if (s instanceof Error) return Promise.reject(s);
    return Promise.resolve(res(s, s === 429 ? retryAfter : undefined));
  };
  const result = withRetry(fn, {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    random: () => 1, // top of the jitter range
  });
  return { result, waits, calls: () => i };
}

describe('retry', () => {
  it('429 waits Retry-After seconds, then retries', async () => {
    const r = run([429, 200], '7');
    expect((await r.result).status).toBe(200);
    expect(r.waits).toEqual([7000]);
  });

  it('429 without Retry-After falls back to a default wait', async () => {
    const r = run([429, 200]);
    await r.result;
    expect(r.waits).toEqual([5000]);
  });

  it('5xx backs off 1 s, 2 s, 4 s, 8 s and stops after 5 tries', async () => {
    const r = run([503]);
    expect((await r.result).status).toBe(503);
    expect(r.calls()).toBe(5);
    expect(r.waits).toEqual([1000, 2000, 4000, 8000]);
  });

  it('jitter keeps the wait between 50% and 100% of the base', () => {
    expect(backoffMs(1, () => 0)).toBe(500);
    expect(backoffMs(1, () => 0.999)).toBeGreaterThanOrEqual(999);
    expect(backoffMs(3, () => 0)).toBe(2000);
  });

  it('retries network errors, then succeeds', async () => {
    const r = run([new DatomsNetworkError('boom'), 200]);
    expect((await r.result).status).toBe(200);
    expect(r.waits).toEqual([1000]);
  });

  it('throws the network error after 5 tries', async () => {
    const r = run([new DatomsNetworkError('boom')]);
    await expect(r.result).rejects.toThrow('boom');
    expect(r.calls()).toBe(5);
  });

  it.each([400, 401, 403, 404, 422])('%i is never retried', async (status) => {
    const r = run([status, 200]);
    expect((await r.result).status).toBe(status);
    expect(r.calls()).toBe(1);
    expect(r.waits).toEqual([]);
  });

  it('parses Retry-After as seconds or as an HTTP date', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(
      parseRetryAfter('Mon, 12 Oct 2026 12:00:10 GMT', Date.parse('2026-10-12T12:00:00Z')),
    ).toBe(10_000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
