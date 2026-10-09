import { createRemoteJWKSet, errors, type JWTVerifyGetKey } from 'jose';

/** The key set could not be fetched or understood. The guard answers 503, not 401. */
export class KeySetUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`JWKS unavailable: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

/** Keys are kept for 6 h; an unknown kid still triggers a refetch (jose's 30 s cooldown applies). */
export const JWKS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Remote JWKS resolver. "No key for this token" stays a JOSE error (the token is bad: 401); every
 * other failure (non-200, non-JSON, invalid key set, network, timeout) becomes KeySetUnavailableError.
 */
export function createKeyResolver(url: URL): JWTVerifyGetKey {
  const remote = createRemoteJWKSet(url, { cacheMaxAge: JWKS_CACHE_MAX_AGE_MS });
  return async (header, token) => {
    try {
      return await remote(header, token);
    } catch (err) {
      if (
        err instanceof errors.JWKSNoMatchingKey ||
        err instanceof errors.JWKSMultipleMatchingKeys
      ) {
        throw err;
      }
      throw new KeySetUnavailableError(err);
    }
  };
}
