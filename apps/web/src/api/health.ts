import { createApiClient } from './client';

/**
 * Health is the one area outside /v1 (docs/10), so it is called on the API origin, not on
 * VITE_API_BASE_URL (which ends in /v1).
 */
const origin = (): string => {
  const base = import.meta.env.VITE_API_BASE_URL;
  return base ? new URL(base).origin : '';
};

/** GET /health/live. The reference call that shows how to use the typed client. */
export async function getHealthLive() {
  const { data } = await createApiClient({ baseUrl: origin() }).GET('/health/live');
  return data; // typed { status: 'ok' } | undefined, from the OpenAPI contract
}
