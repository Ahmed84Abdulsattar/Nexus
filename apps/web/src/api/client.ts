import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

/** The RFC 9457 error body every non-2xx response carries (docs/10 "Errors"). */
export type ProblemDetails = components['schemas']['ProblemDetails'];

/** Thrown for any non-2xx response, with the parsed problem body when the API sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | undefined,
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

const authMiddleware: Middleware = {
  async onRequest({ request }) {
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
    throw new ApiError(response.status, problem);
  },
};

/**
 * The typed API client. Every path, parameter and response type comes from `schema.d.ts`, which is
 * generated from apps/api/openapi.json (`pnpm openapi:generate`), so a contract change that breaks
 * a call site fails `pnpm typecheck`. Non-2xx responses throw `ApiError`.
 */
export function createApiClient(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(authMiddleware);
  return client;
}

/** The app-wide client (base URL from VITE_API_BASE_URL, docs/04). */
export const api = createApiClient();
