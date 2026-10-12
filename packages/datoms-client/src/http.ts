import { inspect } from 'node:util';
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

/** Matches the per-asset latest endpoint. CLI-only (ADR 0010). Escaped so a text search for the path finds only the CLI. */
const PER_ASSET_LATEST = /\/data\/latest(\?|$)/;

export interface HttpOptions {
  /** Only the CLI sets this. The product can never reach the per-asset latest endpoint. */
  allowPerAssetLatest?: boolean;
}

/** Name and `cause.code` only: fetch error messages can carry URLs or header text. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? `${err.name} (${code})` : err.name;
}

function isRedirectError(err: unknown): boolean {
  const cause = (err as { cause?: { message?: unknown } } | undefined)?.cause;
  return typeof cause?.message === 'string' && /redirect/i.test(cause.message);
}

export class DatomsHttp {
  // True private fields: not visible to JSON, util.inspect, spread or heap-style dumps of the object.
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #orgId: string;
  readonly #config: DatomsConfig;

  constructor(
    config: DatomsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
    private readonly options: HttpOptions = {},
  ) {
    this.#config = config;
    this.#token = config.token;
    this.#baseUrl = config.baseUrl;
    this.#orgId = config.orgId;
  }

  toJSON(): object {
    return { baseUrl: this.#baseUrl, orgId: this.#orgId };
  }

  [inspect.custom](): string {
    return `DatomsHttp ${JSON.stringify(this.toJSON())}`;
  }

  /** `path` starts with "/" and is relative to `{baseUrl}/orgs/{orgId}`. */
  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    json?: unknown,
  ): Promise<DatomsResponse<T>> {
    assertLive(this.#config);
    if (!this.options.allowPerAssetLatest && PER_ASSET_LATEST.test(path)) {
      throw new Error('Per-asset latest is CLI-only (ADR 0010).');
    }
    const url = `${this.#baseUrl}/orgs/${encodeURIComponent(this.#orgId)}${path}`;
    const started = Date.now();
    let res: Response;
    let text: string;
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        redirect: 'error', // the bearer token must never follow a redirect
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (json !== undefined) init.body = JSON.stringify(json);
      res = await this.fetchImpl(url, init);
      // The body phase is inside the try: a timeout or stream error here is a network error too.
      text = await res.text();
    } catch (err) {
      if (isRedirectError(err)) {
        // Unexpected redirect: not retryable, surfaces as an unexpected DatomsApiError.
        return {
          status: 302,
          ok: false,
          error: { code: 'UNEXPECTED_REDIRECT' },
          rateLimit: {},
          durationMs: Date.now() - started,
        };
      }
      throw new DatomsNetworkError(
        redact(`${method} ${path} failed: ${describeError(err)}`, this.#token),
      );
    }
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
