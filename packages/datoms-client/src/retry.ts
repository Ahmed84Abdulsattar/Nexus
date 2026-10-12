import { DatomsNetworkError, type DatomsResponse } from './http.js';

export interface RetryOptions {
  /** Maximum tries in total, including the first. Default 5. */
  maxTries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Returns [0, 1). Injected so tests are deterministic. */
  random?: () => number;
  /** Called before each wait (for logging). */
  onWait?: (info: { attempt: number; waitMs: number; why: string }) => void;
}

export const BACKOFF_BASE_MS = [1_000, 2_000, 4_000, 8_000];
/** Used when a 429 comes without a usable Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 5_000;

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After in seconds (the form DATOMS sends); an HTTP date is also accepted. */
export function parseRetryAfter(value: string | undefined, nowMs = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

/** 1 s, 2 s, 4 s, 8 s with jitter (50% to 100% of the base). */
export function backoffMs(attempt: number, random: () => number): number {
  const base = BACKOFF_BASE_MS[Math.min(attempt - 1, BACKOFF_BASE_MS.length - 1)] ?? 8_000;
  return Math.round(base * (0.5 + random() * 0.5));
}

/**
 * docs/07 section 4 item 4.
 * - 429: wait `Retry-After`, then retry.
 * - 500, 502, 503, 504 and network errors or timeouts: back off with jitter, at most `maxTries`.
 * - 400, 401, 403 and every other status (including 422 and 404): returned at once, never retried.
 * After the last try the last response is returned (or the last network error is thrown).
 */
export async function withRetry<T>(
  fn: () => Promise<DatomsResponse<T>>,
  opts: RetryOptions = {},
): Promise<DatomsResponse<T>> {
  const maxTries = opts.maxTries ?? 5;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    let res: DatomsResponse<T>;
    try {
      res = await fn();
    } catch (err) {
      if (!(err instanceof DatomsNetworkError) || attempt >= maxTries) throw err;
      const waitMs = backoffMs(attempt, random);
      opts.onWait?.({ attempt, waitMs, why: 'network error' });
      await sleep(waitMs);
      continue;
    }
    const retryable = res.status === 429 || [500, 502, 503, 504].includes(res.status);
    if (!retryable || attempt >= maxTries) return res;
    const waitMs =
      res.status === 429
        ? (parseRetryAfter(res.rateLimit.retryAfter) ?? DEFAULT_RETRY_AFTER_MS)
        : backoffMs(attempt, random);
    opts.onWait?.({ attempt, waitMs, why: `HTTP ${res.status}` });
    await sleep(waitMs);
  }
}
