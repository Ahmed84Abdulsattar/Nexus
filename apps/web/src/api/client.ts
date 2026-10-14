import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

/** The RFC 9457 error body every non-2xx response carries (docs/10 "Errors"). */
export type ProblemDetails = components['schemas']['ProblemDetails'];

/** Thrown for any non-2xx response, with the parsed problem body when the API sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | undefined,
    /** Seconds from the `Retry-After` header (429), when the API sent a valid one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(problem?.detail ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

type AccessTokenProvider = () => Promise<string | undefined>;

let accessTokenProvider: AccessTokenProvider = () => Promise.resolve(undefined);

/**
 * Hook point for MSAL (the auth/ task): call once at sign-in with a function that returns a fresh
 * Entra access token for the `access_as_user` scope (acquireTokenSilent). Until then requests go
 * out without a token, which only /health/* accepts.
 */
export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  accessTokenProvider = provider;
}

/**
 * Resolves the API base URL once. A relative value (`/v1`) is resolved against the page origin.
 * A production build must set VITE_API_BASE_URL; there is no silent fallback to the page origin.
 */
export function resolveApiBase(
  configured: string | undefined = import.meta.env.VITE_API_BASE_URL,
  isProd: boolean = import.meta.env.PROD,
  pageOrigin: string = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): URL {
  if (!configured) {
    if (isProd) throw new Error('VITE_API_BASE_URL is required in a production build.');
    return new URL('/v1', pageOrigin);
  }
  return new URL(configured, pageOrigin);
}

/**
 * Whether the Entra token may be sent to this request URL: only the API origin, and never to
 * /health/* (public, and a token there would be pointless exposure).
 */
export function shouldSendToken(requestUrl: string, apiOrigin: string): boolean {
  const url = new URL(requestUrl);
  return url.origin === apiOrigin && !/^\/health(\/|$)/.test(url.pathname);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

function authMiddleware(apiOrigin: string): Middleware {
  return {
    async onRequest({ request }) {
      if (!shouldSendToken(request.url, apiOrigin)) return request;
      const token = await accessTokenProvider();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.ok) return undefined;
      const problem = (await response
        .clone()
        .json()
        .catch(() => undefined)) as ProblemDetails | undefined;
      throw new ApiError(
        response.status,
        problem,
        parseRetryAfter(response.headers.get('Retry-After')),
      );
    },
  };
}

/**
 * The typed API client. Every path, parameter and response type comes from `schema.d.ts`, which is
 * generated from apps/api/openapi.json (`pnpm openapi:generate`), so a contract change that breaks
 * a call site fails `pnpm typecheck`. Non-2xx responses throw `ApiError`. The bearer token is
 * attached only to requests for the API origin (not /health/*, not any other origin).
 * `baseUrl` defaults to VITE_API_BASE_URL (e.g. https://host/v1). `apiOrigin` is the only origin
 * that receives the token; it defaults to the origin of VITE_API_BASE_URL.
 */
export function createApiClient(
  options: { baseUrl?: string; apiOrigin?: string; fetch?: typeof fetch } = {},
) {
  const configured = resolveApiBase();
  const base = options.baseUrl ? new URL(options.baseUrl, configured.origin) : configured;
  const client = createClient<paths>({
    baseUrl: base.href.replace(/\/$/, ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(authMiddleware(options.apiOrigin ?? configured.origin));
  return client;
}

/** The app-wide client (base URL from VITE_API_BASE_URL, docs/04). Throws in a prod build without it. */
export const api = createApiClient();
