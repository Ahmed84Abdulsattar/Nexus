import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@nexus/shared';

/**
 * Method-only on purpose (docs/08 step 4: every controller method). A class-level decorator would
 * be silently replaced by a method one, so class-level access metadata is refused at runtime.
 */
/** Metadata keys read by the guards and by the default-deny test. */
export const PUBLIC_KEY = 'nexus:public';
export const ANY_SIGNED_IN_KEY = 'nexus:any-signed-in';
export const REQUIRE_PERMISSION_KEY = 'nexus:require-permission';

/** No token needed. Only /health/* (docs/10). */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);

/** Any valid, active Nexus user: /me, /config, /live/token, /live/subscriptions (docs/10). */
export const AnySignedIn = (): MethodDecorator => SetMetadata(ANY_SIGNED_IN_KEY, true);

/** The user needs every listed permission. */
export const RequirePermission = (...keys: [PermissionKey, ...PermissionKey[]]): MethodDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, keys);
