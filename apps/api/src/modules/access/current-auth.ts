import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthPrincipal, AuthRequest } from '../../common/auth/request.js';

/** The verified caller (set by EntraJwtGuard). Handlers behind the guard always have one. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

export type CurrentAuthValue = AuthPrincipal;
