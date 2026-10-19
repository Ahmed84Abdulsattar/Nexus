import { QueryClient } from '@tanstack/react-query';
import { retryDelay, shouldRetry } from '../api/errors';

/** `retry: false` is for tests, where back-off delays would only slow things down. */
export function createQueryClient(overrides: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: overrides.retry === false ? false : shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
    },
  });
}
