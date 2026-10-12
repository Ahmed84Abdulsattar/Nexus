import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { PermissionKey } from '@nexus/shared';

/**
 * Method-only on purpose (docs/08 step 4: every controller method). A class-level decorator would
 * be silently replaced by a method one, so class-level access metadata is refused at runtime.
 */
/** Metadata keys read by the guards and by the default-deny test. */
export const PUBLIC_KEY = 'nexus:public';
export const ANY_SIGNED_IN_KEY = 'nexus:any-signed-in';
export const REQUIRE_PERMISSION_KEY = 'nexus:require-permission';

/** The OpenAPI security scheme name (see openapi/setup.ts). */
export const BEARER_AUTH = 'entra';

/** No token needed. Only /health/* (docs/10). */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);

/** Any valid, active Nexus user: /me, /config, /live/token, /live/subscriptions (docs/10). */
export const AnySignedIn = (): MethodDecorator =>
  applyDecorators(SetMetadata(ANY_SIGNED_IN_KEY, true), ApiBearerAuth(BEARER_AUTH));

/** The user needs every listed permission. */
export const RequirePermission = (...keys: [PermissionKey, ...PermissionKey[]]): MethodDecorator =>
  applyDecorators(SetMetadata(REQUIRE_PERMISSION_KEY, keys), ApiBearerAuth(BEARER_AUTH));
