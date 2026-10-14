import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import {
  AccessContextService,
  InactiveUserError,
  type SignedInIdentity,
} from './access-context.js';
import { resolveAccessPolicy } from './access-policy.js';
import type { AuthRequest } from './request.js';

export const JWT_KEY_RESOLVER = Symbol('JWT_KEY_RESOLVER');

/** Allowed clock difference between Entra and this server, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Global guard, first step of docs/08 section 2. It
 *  1. refuses handlers without exactly one of @Public / @AnySignedIn / @RequirePermission,
 *  2. lets @Public handlers through without a token,
 *  3. validates the Entra access token (signature against the JWKS, iss, aud, exp, nbf, tid, scp),
 *  4. loads the user and the AccessContext and puts them on the request.
 * Permission checks are in PermissionGuard, which runs next.
 */
@Injectable()
export class EntraJwtGuard implements CanActivate {
  private readonly logger = new Logger(EntraJwtGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessContextService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JWT_KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = resolveAccessPolicy(this.reflector, context.getHandler(), context.getClass());
    if (policy.kind === 'none' || policy.kind === 'conflict') {
      this.logger.error(
        `Refusing ${context.getClass().name}.${context.getHandler().name}: ` +
          (policy.kind === 'none'
            ? 'no @RequirePermission / @AnySignedIn / @Public (default deny)'
            : 'more than one access decorator'),
      );
      throw new ForbiddenException('Access to this endpoint is not configured.');
    }
    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const payload = await this.verifyToken(bearerToken(request));
    const identity = this.identityFrom(payload, request);

    let access;
    try {
      access = await this.access.resolve(identity);
    } catch (err) {
      if (err instanceof InactiveUserError) throw new ForbiddenException('User is inactive.');
      throw err;
    }
    request.auth = {
      oid: identity.oid,
      userId: access.userId,
      displayName: identity.displayName,
      email: identity.email,
      access,
    };
    return true;
  }

  private async verifyToken(token: string): Promise<JWTPayload> {
    const { auth } = this.config;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256'],
        issuer: auth.issuer,
        audience: auth.audiences,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp'],
      }));
    } catch (err) {
      if (err instanceof errors.JOSEError) {
        // Detail is for our logs only; the client just learns the token is not acceptable.
        this.logger.debug(`Token rejected: ${err.code}`);
        throw new UnauthorizedException('Invalid or expired token.');
      }
      // KeySetUnavailableError or anything unexpected: not the caller's fault.
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new ServiceUnavailableException('Token keys are temporarily unavailable.');
    }

    if (typeof payload['tid'] !== 'string' || payload['tid'].toLowerCase() !== auth.tenantId) {
      throw new UnauthorizedException('Token is from another tenant.');
    }
    // Only tokens issued to the Nexus SPA. Other apps of the tenant must not reach the API even
    // if they obtained the scope. (S0-04 also sets "assignment required" on the enterprise app.)
    const azp = payload['azp'];
    if (typeof azp !== 'string' || azp.toLowerCase() !== auth.webClientId) {
      throw new ForbiddenException('Token was not issued to the Nexus web app.');
    }
    // A valid token without the delegated scope (for example an app-only token) is not for users.
    const scopes = typeof payload['scp'] === 'string' ? payload['scp'].split(' ') : [];
    if (!scopes.includes(auth.requiredScope)) {
      throw new ForbiddenException(`Token lacks the ${auth.requiredScope} scope.`);
    }
    return payload;
  }

  private identityFrom(payload: JWTPayload, request: AuthRequest): SignedInIdentity {
    const oid = payload['oid'];
    if (typeof oid !== 'string' || !GUID.test(oid)) {
      throw new UnauthorizedException('Token has no valid user object id.');
    }
    // verifyToken already proved tid equals the configured tenant, which is validated as a GUID.
    const tenantId = this.config.auth.tenantId;

    // ADR 0008: groups come only from the "groups assigned to the application" claim. A token
    // with an overage marker instead of `groups` is refused and logged for an admin. No Graph call.
    const claimNames = payload['_claim_names'];
    const overage =
      (typeof claimNames === 'object' && claimNames !== null && 'groups' in claimNames) ||
      (payload['hasgroups'] === true && payload['groups'] === undefined);
    if (overage) {
      this.logger.warn(
        `Group overage in token of user ${oid}: refused (403). Assign fewer groups to the app registration (ADR 0008).`,
      );
      throw new ForbiddenException('Token carries a group overage marker instead of groups.');
    }

    const rawGroups = payload['groups'];
    if (
      rawGroups !== undefined &&
      !(Array.isArray(rawGroups) && rawGroups.every((g) => typeof g === 'string'))
    ) {
      throw new UnauthorizedException('Malformed groups claim.');
    }
    const email = firstString(payload['email'], payload['preferred_username'], payload['upn']);
    const displayName = firstString(payload['name']);
    const userAgent = request.headers['user-agent'];
    return {
      oid,
      tenantId,
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {}),
      groupIds: (rawGroups as string[] | undefined) ?? [],
      request: {
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof userAgent === 'string' ? { userAgent } : {}),
        ...(request.id ? { correlationId: String(request.id) } : {}),
      },
    };
  }
}

/** The oid becomes a uuid column: a token claim that is not a GUID is refused, not sent to SQL. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearerToken(request: AuthRequest): string {
  const header = request.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value) : null;
  if (!match?.[1]) throw new UnauthorizedException('Missing bearer token.');
  return match[1];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === 'string' && v !== '');
}
