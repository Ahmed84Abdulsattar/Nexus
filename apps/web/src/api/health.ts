import { api } from './client';

/** GET /health/live. The reference call that shows how to use the typed client. */
export async function getHealthLive() {
  const { data } = await api.GET('/health/live');
  return data; // typed { status: 'ok' } | undefined, from the OpenAPI contract
}
