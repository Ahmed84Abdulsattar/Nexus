import { BlockList, isIP } from 'node:net';
import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../config/env.js';
import { IpRateLimiter, sanitizeClientIp } from '../rate-limit/rate-limit.js';
import { DOCS_PATH } from '../../openapi/setup.js';

/**
 * The Fastify instance options that cannot be changed after creation: the request body limit
 * and how the client address is derived (trustProxy). Used by main.ts and the test app.
 */
export function createHttpAdapter(config: AppConfig): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: config.http.bodyLimitBytes,
    trustProxy: toFastifyTrustProxy(config.http.trustProxy),
  });
}

/**
 * Addresses a platform proxy connects from: private ranges, carrier-grade NAT (Container Apps
 * infrastructure uses 100.64/10 in some regions) and loopback. A direct client from the internet is
 * not in this list, so it can never make us believe its own X-Forwarded-For.
 */
const INTERNAL_PEERS = new BlockList();
for (const [net, bits] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
] as const)
  INTERNAL_PEERS.addSubnet(net, bits, 'ipv4');
INTERNAL_PEERS.addSubnet('fc00::', 7, 'ipv6');
INTERNAL_PEERS.addAddress('::1', 'ipv6');

/** Exported for the tests. */
export function isInternalPeer(address: string): boolean {
  const plain = address.replace(/^::ffff:/i, ''); // IPv4-mapped
  const family = isIP(plain);
  if (family === 0) return false;
  return INTERNAL_PEERS.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Fastify 5 treats a numeric trustProxy as "trust nobody" because a bare count never checks who
 * connected, so a hop count becomes a function. proxy-addr calls it with the hop index: 0 is the
 * connecting socket, 1 the last X-Forwarded-For entry, and so on.
 * - Hop 0 is trusted only when the peer is a platform-internal address (INTERNAL_PEERS). Anyone
 *   reaching the container directly from outside is not, so their header is ignored and they are
 *   keyed by their own address. Forwarded host and proto get the same protection.
 * - Hops 1 to N-1 are further proxies; the first address beyond them is the client.
 */
export function toFastifyTrustProxy(
  value: AppConfig['http']['trustProxy'],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof value === 'number')
    return (address, hop) => (hop === 0 ? isInternalPeer(address) : hop < value);
  return value;
}

/** For the startup log: trust_proxy=off, hops:1 or list:2 entries (never the addresses). */
export function describeTrustProxy(value: AppConfig['http']['trustProxy']): string {
  if (value === false) return 'trust_proxy=off';
  return typeof value === 'number'
    ? `trust_proxy=hops:${value}`
    : `trust_proxy=list:${value.length}`;
}

/** Swagger UI needs its own scripts, styles and images from this origin. Nothing else. */
const DOCS_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "frame-ancestors 'none'; base-uri 'none'";

/**
 * Secure headers and CORS (docs/08 section 6). Call before app.init().
 * - helmet on every response, including errors and 404s. The API serves JSON only, so the CSP is
 *   `default-src 'none'`; only /docs (mounted outside prod) gets the looser CSP above.
 * - CORS answers only for the configured Nexus web origins; any other origin gets no CORS headers.
 *   No credentials: the SPA sends a bearer token, not cookies.
 */
export async function applySecurity(app: NestFastifyApplication, config: AppConfig): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Per-address flood guard, before routing, body parsing and any guard, so it also covers unknown
  // paths, oversized bodies and bad tokens. The thrown 429 goes through ProblemJsonFilter.
  const ipLimiter = new IpRateLimiter(config.http.rateLimit.ipPerMinute);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request) => {
      // Replace request.ip by the cleaned address (port removed, garbage -> socket peer), so the
      // limiter, the sign-in audit row and every log see the same value.
      const ip = sanitizeClientIp(request.ip, request.raw.socket.remoteAddress);
      Object.defineProperty(request, 'ip', { value: ip, configurable: true, enumerable: true });
      ipLimiter.check(ip);
    });

  if (config.appEnv === 'local' || config.appEnv === 'dev') {
    // Same allow-list as mountDocs(). onSend runs after helmet's onRequest, so this wins.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onSend', async (request, reply) => {
        const path = request.url.split('?')[0];
        if (path === `/${DOCS_PATH}` || path?.startsWith(`/${DOCS_PATH}/`)) {
          void reply.header('content-security-policy', DOCS_CSP);
        }
      });
  }

  // Options are decided per request so that a foreign origin gets no CORS header of any kind
  // (not even Expose-Headers), instead of a list that merely omits it.
  const allowed = new Set(config.http.corsOrigins);
  const nexusOptions = {
    origin: true, // reflect the (already checked) request origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'],
    exposedHeaders: ['Retry-After', 'X-Correlation-Id', 'X-Data-Lag-Seconds'],
    credentials: false,
    maxAge: 600,
  };
  // The "delegator" option of @fastify/cors (not in Nest's CorsOptions type). A function passed to
  // enableCors itself would be taken by Fastify's register() as an options factory.
  const delegator = (
    request: { headers: Record<string, string | string[] | undefined> },
    callback: (error: Error | null, options: object) => void,
  ): void => {
    const origin = request.headers['origin'];
    callback(
      null,
      typeof origin === 'string' && allowed.has(origin) ? nexusOptions : { origin: false },
    );
  };
  app.enableCors({ delegator } as never);
}
