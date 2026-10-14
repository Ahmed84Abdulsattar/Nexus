import createClient from 'openapi-fetch';
import { authMiddleware, resolveApiBase } from '../client';

/**
 * Endpoints the web app already calls but that are not in the generated `schema.d.ts` yet (the API
 * builds them in S1-02 and S1-04). Remove an entry, and use `api` from ../client, when the endpoint
 * appears in apps/api/openapi.json. Responses are validated with the zod schemas in @nexus/shared.
 */
interface PendingPaths {
  '/config': { get: { responses: { 200: { content: { 'application/json': unknown } } } } };
  '/projects': { get: { responses: { 200: { content: { 'application/json': unknown } } } } };
}

/** Same base URL and token rules as `api`; created lazily so tests can set env first. */
export function createPendingClient() {
  const base = resolveApiBase();
  const client = createClient<PendingPaths>({ baseUrl: base.href.replace(/\/$/, '') });
  client.use(authMiddleware(base.origin));
  return client;
}
