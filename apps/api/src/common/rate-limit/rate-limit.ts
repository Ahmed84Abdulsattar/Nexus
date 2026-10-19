import { isIP } from 'node:net';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { FixedWindowLimiter } from './fixed-window-limiter.js';

/** 429 carrying the Retry-After seconds; ProblemJsonFilter turns it into the header. */
export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Retry later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * The key a client address is counted under. An IPv4-mapped IPv6 address (::ffff:1.2.3.4) is the
 * same client as the IPv4 address. IPv6 clients are keyed by their /64, because one device or site
 * owns a whole /64 and could otherwise rotate addresses to dodge the limit.
 */
export function clientAddressKey(ip: string | undefined): string {
  if (ip === undefined || ip === '') return 'unknown';
  const bare = ip.split('%')[0] ?? ip; // zone id
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped?.[1]) return mapped[1];
  if (isIP(bare) !== 6) return bare.toLowerCase();
  return expandIPv6(bare).slice(0, 4).join(':') + '::/64';
}

function expandIPv6(address: string): string[] {
  let text = address.toLowerCase();
  // A trailing dotted IPv4 part becomes two hex groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text =
      text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head = '', tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => g.padStart(4, '0'));
}

/** Flood guard per client address. Run by the onRequest hook in applySecurity(). */
export class IpRateLimiter {
  private readonly limiter: FixedWindowLimiter;
  constructor(perMinute: number) {
    this.limiter = new FixedWindowLimiter(perMinute);
  }
  check(ip: string | undefined): void {
    const result = this.limiter.hit(`ip:${clientAddressKey(ip)}`);
    if (!result.allowed) throw new TooManyRequestsException(result.retryAfterSeconds);
  }
}

/**
 * Per-user limit. EntraJwtGuard calls check() with the oid of the validated token, before any
 * database work, so a deactivated or abusive user costs no queries. The key is never a value the
 * client chose.
 */
@Injectable()
export class UserRateLimiter {
  private readonly limiter: FixedWindowLimiter;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limiter = new FixedWindowLimiter(config.http.rateLimit.userPerMinute);
  }
  check(oid: string): void {
    const result = this.limiter.hit(`user:${oid.toLowerCase()}`);
    if (!result.allowed) throw new TooManyRequestsException(result.retryAfterSeconds);
  }
}
