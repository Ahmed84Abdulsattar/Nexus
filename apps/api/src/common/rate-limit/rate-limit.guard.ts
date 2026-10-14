import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import type { AuthRequest } from '../auth/request.js';
import { FixedWindowLimiter } from './fixed-window-limiter.js';

/** 429 carrying the Retry-After seconds; ProblemJsonFilter turns it into the header. */
export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Retry later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Runs before EntraJwtGuard, so it also covers requests with bad or missing tokens. Keyed on the
 * client address (`request.ip`, which is the real client only when TRUST_PROXY is set right).
 * Deliberately generous: many users share one office address. It is a flood guard, not the
 * per-user limit.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly limiter: FixedWindowLimiter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limiter = new FixedWindowLimiter(config.http.rateLimit.ipPerMinute);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const result = this.limiter.hit(`ip:${request.ip ?? 'unknown'}`);
    if (!result.allowed) throw new TooManyRequestsException(result.retryAfterSeconds);
    return true;
  }
}

/**
 * Runs right after EntraJwtGuard. The key is the `oid` of the already validated token
 * (`request.auth`), never a header or claim the client could choose. Handlers without a
 * token (@Public) have no `auth` and are only limited by the IP guard.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly limiter: FixedWindowLimiter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limiter = new FixedWindowLimiter(config.http.rateLimit.userPerMinute);
  }

  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
    if (auth === undefined) return true;
    const result = this.limiter.hit(`user:${auth.oid.toLowerCase()}`);
    if (!result.allowed) throw new TooManyRequestsException(result.retryAfterSeconds);
    return true;
  }
}
