import { assertLive, type DatomsConfig } from './config.js';

export const REQUEST_TIMEOUT_MS = 30_000;

/** Rate-limit response headers, exactly as the server sent them (strings; absent when not sent). */
export interface RateLimitHeaders {
  unit?: string;
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfter?: string;
}

export interface DatomsErrorBody {
  code?: string;
  message?: string;
}

export interface DatomsResponse<T = unknown> {
  status: number;
  ok: boolean;
  /** Parsed JSON body of a 2xx response. */
  body?: T;
  /** Parsed `error` of the DATOMS error envelope on a non-2xx response. */
  error?: DatomsErrorBody;
  rateLimit: RateLimitHeaders;
  durationMs: number;
}

/** Network failure or timeout. The message never contains the token. */
export class DatomsNetworkError extends Error {
  override name = 'DatomsNetworkError';
}

export function readRateLimit(headers: Headers): RateLimitHeaders {
  const out: RateLimitHeaders = {};
  // Unit first: it tells what Limit/Remaining count (credits or requests).
  const pairs: [keyof RateLimitHeaders, string][] = [
    ['unit', 'x-ratelimit-unit'],
    ['limit', 'x-ratelimit-limit'],
    ['remaining', 'x-ratelimit-remaining'],
    ['reset', 'x-ratelimit-reset'],
    ['retryAfter', 'retry-after'],
  ];
  for (const [key, name] of pairs) {
    const v = headers.get(name);
    if (v !== null) out[key] = v;
  }
  return out;
}

export function redact(text: string, token: string): string {
  return token ? text.split(token).join('[redacted]') : text;
}

export class DatomsHttp {
  constructor(
    private readonly config: DatomsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {}

  /** `path` starts with "/" and is relative to `{baseUrl}/orgs/{orgId}`. */
  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    json?: unknown,
  ): Promise<DatomsResponse<T>> {
    assertLive(this.config);
    const url = `${this.config.baseUrl}/orgs/${encodeURIComponent(this.config.orgId)}${path}`;
    const started = Date.now();
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (json !== undefined) init.body = JSON.stringify(json);
      res = await this.fetchImpl(url, init);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
      throw new DatomsNetworkError(`${method} ${path} failed: ${redact(msg, this.config.token)}`);
    }
    const text = await res.text();
    const durationMs = Date.now() - started;
    const rateLimit = readRateLimit(res.headers);
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (res.ok) {
      return { status: res.status, ok: true, body: parsed as T, rateLimit, durationMs };
    }
    const env = parsed as { error?: DatomsErrorBody } | undefined;
    const error: DatomsErrorBody = env?.error ?? {};
    return { status: res.status, ok: false, error, rateLimit, durationMs };
  }
}
