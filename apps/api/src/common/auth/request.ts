import type { AccessContext } from './access-context.js';

/** Set by EntraJwtGuard on authenticated requests. */
export interface AuthPrincipal {
  oid: string;
  userId: string;
  displayName?: string;
  email?: string;
  access: AccessContext;
}

/** The parts of the (Fastify) request the auth code touches. */
export interface AuthRequest {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  auth?: AuthPrincipal;
}
