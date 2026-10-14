import { useQuery } from '@tanstack/react-query';
import { configResponseSchema, type ConfigResponse } from '@nexus/shared';
import { createPendingClient } from './pendingClient';

export const configQueryKey = ['config'] as const;

export async function fetchConfig(): Promise<ConfigResponse> {
  const { data } = await createPendingClient().GET('/config');
  return configResponseSchema.parse(data);
}

/**
 * GET /v1/config: the ArcGIS key, enums and feature flags. Held in the query cache (memory) only.
 * Never log this value and never write it to storage.
 */
export function useConfig() {
  return useQuery({
    queryKey: configQueryKey,
    queryFn: fetchConfig,
    staleTime: 10 * 60_000,
  });
}
