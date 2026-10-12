import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from './access-context.js';
import { resolveAccessPolicy } from './access-policy.js';
import type { AuthRequest } from './request.js';

/** Second global guard: enforces @RequirePermission using the AccessContext set by EntraJwtGuard. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = resolveAccessPolicy(this.reflector, context.getHandler(), context.getClass());
    if (policy.kind === 'public' || policy.kind === 'any-signed-in') return true;
    if (policy.kind !== 'permission') throw new ForbiddenException(); // default deny

    const access = context.switchToHttp().getRequest<AuthRequest>().auth?.access;
    if (!access) throw new UnauthorizedException('Not signed in.');
    const missing = policy.keys.filter((k) => !hasPermission(access, k));
    if (missing.length > 0)
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
