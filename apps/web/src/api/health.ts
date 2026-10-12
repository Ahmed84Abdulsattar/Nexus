import { createApiClient, resolveApiBase } from './client';

/**
 * Health is the one area outside /v1 (docs/10), so it is called on the API origin, not on
 * VITE_API_BASE_URL (which ends in /v1). The client never sends the token to /health/*.
 */
export async function getHealthLive() {
  const client = createApiClient({ baseUrl: resolveApiBase().origin });
  const { data } = await client.GET('/health/live');
  return data; // typed { status: 'ok' } | undefined, from the OpenAPI contract
}
