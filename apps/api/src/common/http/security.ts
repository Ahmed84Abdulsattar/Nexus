import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../config/env.js';
import { DOCS_PATH } from '../../openapi/setup.js';

/**
 * The Fastify instance options that cannot be changed after creation: the request body limit
 * and how the client address is derived (trustProxy). Used by main.ts and the test app.
 */
export function createHttpAdapter(config: AppConfig): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: config.http.bodyLimitBytes,
    trustProxy: config.http.trustProxy,
  });
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
