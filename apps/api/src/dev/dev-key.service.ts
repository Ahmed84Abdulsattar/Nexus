import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import type { DevKeySource } from '../common/auth/dev-key-source.js';

/** Dev tokens live for one hour. */
export const DEV_TOKEN_TTL_SECONDS = 3600;

/**
 * The signing key of local sign-in: generated at startup, held in memory, never written to disk.
 * A new process means a new key, so tokens of an earlier run stop working.
 */
export class DevKeyService implements DevKeySource {
  private constructor(
    private readonly privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
    private readonly kid: string,
    readonly resolver: JWTVerifyGetKey,
  ) {}

  static async create(): Promise<DevKeyService> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: false });
    const kid = `nexus-dev-${Date.now().toString(36)}`;
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
    return new DevKeyService(privateKey, kid, createLocalJWKSet({ keys: [jwk] }));
  }

  sign(claims: JWTPayload, issuer: string, audience: string): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${DEV_TOKEN_TTL_SECONDS}s`)
      .sign(this.privateKey);
  }
}
