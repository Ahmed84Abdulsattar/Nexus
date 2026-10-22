import type { JWTVerifyGetKey } from 'jose';

/**
 * Where AuthModule gets the verification keys when AUTH_MODE=dev. Only a token and a type live here;
 * the implementation is in src/dev/, which is imported only in that mode (see createAppModule).
 */
export const DEV_KEY_SOURCE = Symbol('DEV_KEY_SOURCE');

export interface DevKeySource {
  /** Verifies against the in-memory public key, through the same jwtVerify call as Entra tokens. */
  readonly resolver: JWTVerifyGetKey;
}
