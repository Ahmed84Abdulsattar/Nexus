import { isIP } from 'node:net';
import {
  assertDirectConnection,
  DatabaseConfigError,
  isLocalHost,
  requireTlsUnlessLocal,
} from '@nexus/db';
import { z } from 'zod';
import { devModeProblems } from './dev-mode-guards.js';

/**
 * Environment of the API, validated once at startup (docs/04 "Environment variables").
 * Only the variables the API uses today are listed; later tasks add their own.
 * Secrets never come from here: Key Vault is wired in a later task.
 */
/** `VAR=` in a copied .env.example means "not set". */
const blankToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

/** The one JWKS endpoint of a tenant. Outside local development nothing else is accepted. */
function derivedJwksUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId.toLowerCase()}/discovery/v2.0/keys`;
}

/** One CORS origin: scheme + host (+ port), nothing else, no wildcard. */
function parseOrigins(raw: string, appEnv: string): { origins: string[]; problems: string[] } {
  const origins: string[] = [];
  const problems: string[] = [];
  for (const item of raw.split(',').map((o) => o.trim())) {
    if (item === '') continue;
    let url: URL | undefined;
    try {
      url = new URL(item);
    } catch {
      /* reported below */
    }
    if (item.includes('*') || url === undefined || url.origin !== item) {
      problems.push(
        `"${item}" is not a plain origin like https://nexus.example (no wildcard, path or trailing slash)`,
      );
    } else if (url.protocol !== 'https:' && !(appEnv === 'local' && url.protocol === 'http:')) {
      problems.push(`"${item}" must be https (http is allowed only when APP_ENV=local)`);
    } else {
      origins.push(item);
    }
  }
  return { origins, problems };
}

/**
 * TRUST_PROXY (Q46, answered 2026-10-19): off, a hop count of exactly 1 or 2, or the addresses/CIDRs
 * of the proxies in front of the API.
 * - 1 = Azure Container Apps ingress with nothing in front of it; 2 = Front Door or App Gateway
 *   added later. Unset locally.
 * - Fastify 5 itself treats a number as "trust nobody" (it fails closed). A hop count is therefore
 *   turned into a trust function in createHttpAdapter (security.ts): the connecting peer and the
 *   next N-1 addresses in X-Forwarded-For are proxies; the next one is the client. It is only safe
 *   when the ingress is the one way in, which holds on Container Apps.
 * - "true" is refused (any client could choose its address through X-Forwarded-For).
 */
function parseTrustProxy(raw: string | undefined): { value: TrustProxy; problem?: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'false') return { value: false };
  if (v === '1' || v === '2') return { value: v === '1' ? 1 : 2 };
  const list = v.split(',').map((a) => a.trim());
  const ok = list.every((a) => {
    const [addr, bits, ...rest] = a.split('/');
    if (rest.length > 0 || addr === undefined || isIP(addr) === 0) return false;
    // IPv4-mapped notation hides an IPv4 range inside IPv6; write the IPv4 range instead.
    if (/^::ffff:/i.test(addr)) return false;
    if (bits === undefined) return true;
    // Wide ranges would trust (nearly) every address, which is the same as "true": at least /8
    // for IPv4 and /32 for IPv6. A proxy network is never wider than that.
    const min = isIP(addr) === 4 ? 8 : 32;
    return (
      /^\d{1,3}$/.test(bits) && Number(bits) >= min && Number(bits) <= (isIP(addr) === 4 ? 32 : 128)
    );
  });
  return ok
    ? { value: list }
    : {
        value: false,
        problem:
          'use false, a hop count of 1 or 2, or a comma-separated list of proxy IP addresses or CIDRs (IPv4 not wider than /8, IPv6 not wider than /32, no ::ffff: notation; not true, no other number)',
      };
}

/** false, a hop count (1 or 2), or proxy addresses/CIDRs. */
export type TrustProxy = false | 1 | 2 | string[];

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'prod']),
    AUTH_MODE: z.preprocess(blankToUndefined, z.enum(['entra', 'dev']).default('entra')),
    ENTRA_TENANT_ID: z.guid(),
    ENTRA_API_CLIENT_ID: z.guid(),
    /** The SPA (nexus-web) app id; tokens must come from it (azp). */
    ENTRA_WEB_CLIENT_ID: z.guid(),
    /** Identifier URI of nexus-api, e.g. api://nexus-api. */
    ENTRA_API_AUDIENCE: z.string().regex(/^api:\/\/.+/, 'must start with api://'),
    /**
     * Optional override, for tests and local development only. Outside APP_ENV=local it must be
     * unset or exactly the tenant's own JWKS URL, so the key source cannot be redirected.
     */
    ENTRA_JWKS_URL: z.preprocess(blankToUndefined, z.url().optional()),
    /**
     * The API's own database login (nexus_api role, docs/06 section 9). Never falls back to another
     * variable. The pool connects lazily, so the app starts without a reachable database.
     */
    DATABASE_URL: z
      .string()
      .refine((v) => /^postgres(ql)?:\/\/.+/.test(v), 'must be a postgres:// or postgresql:// URL'),
    DATABASE_POOL_MAX: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(100).default(10),
    ),
    /** Comma-separated browser origins allowed by CORS (docs/04). Unset: local gets the Vite dev server, elsewhere none. */
    CORS_ALLOWED_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
    /** Requests per user (Entra oid) per minute, and per client address per minute (flood guard). */
    RATE_LIMIT_USER_PER_MINUTE: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(100_000).default(600),
    ),
    RATE_LIMIT_IP_PER_MINUTE: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(1_000_000).default(3000),
    ),
    /** Largest accepted request body in bytes. */
    BODY_LIMIT_BYTES: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1024).max(50_000_000).default(1_048_576),
    ),
    // Whitespace-only counts as unset, so it cannot satisfy the required-outside-local check.
    TRUST_PROXY: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional(),
    ),
    /**
     * The referrer-restricted ArcGIS browser key (docs/09 section 1), served to signed-in users by
     * GET /v1/config. Optional: unset means the web shows "Map key not configured". The only
     * credential the API ever returns to a browser. Key Vault in Azure.
     */
    ARCGIS_API_KEY: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().optional(),
    ),
  })
  .superRefine((env, ctx) => {
    for (const message of parseOrigins(env.CORS_ALLOWED_ORIGINS ?? '', env.APP_ENV).problems) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message });
    }
    const proxy = parseTrustProxy(env.TRUST_PROXY);
    if (proxy.problem)
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: proxy.problem });
    // Behind Azure ingress, an unset TRUST_PROXY makes every user share the ingress address, so a
    // flood of junk tokens would trip the per-address limit for everybody (Q46). Setting it to
    // "false" is an explicit decision and still allowed.
    if (env.APP_ENV !== 'local' && env.TRUST_PROXY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'required when APP_ENV is dev or prod: set it to 1 (Azure Container Apps ingress; 2 if Front Door or App Gateway is added), to proxy CIDRs, or to "false" to decide explicitly that no proxy is trusted (Q46)',
      });
    }
    // The API holds a LISTEN connection for access-cache invalidation. Through a pooler in transaction
    // mode (Azure's built-in PgBouncer, port 6432) LISTEN is silently deaf, so refuse to start.
    try {
      assertDirectConnection(env.DATABASE_URL, 'DATABASE_URL');
      // TLS outside local (never prints the URL).
      requireTlsUnlessLocal(env.DATABASE_URL, 'DATABASE_URL', env.APP_ENV);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          error instanceof DatabaseConfigError
            ? error.message
            : 'is not a valid URL (value not shown)',
      });
    }
    if (env.AUTH_MODE === 'dev' && env.APP_ENV !== 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is allowed only when APP_ENV=local (docs/04)',
      });
    }
    // Local sign-in mints its own tokens: it must never be pointed at a shared database (docs/08).
    if (env.AUTH_MODE === 'dev' && !isLocalHost(env.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is allowed only with a database on this machine (localhost)',
      });
    }
    if (
      env.ENTRA_JWKS_URL !== undefined &&
      env.APP_ENV !== 'local' &&
      env.ENTRA_JWKS_URL !== derivedJwksUrl(env.ENTRA_TENANT_ID)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENTRA_JWKS_URL'],
        message: 'outside APP_ENV=local it must be unset or the tenant JWKS URL over https',
      });
    }
  });

/** The Vite dev server (apps/web, strictPort 5173): the CORS default when APP_ENV=local. */
const LOCAL_WEB_ORIGIN = 'http://localhost:5173';

/** The delegated scope the SPA asks for (docs/08 section 1). */
export const REQUIRED_SCOPE = 'access_as_user';

export interface AppConfig {
  appEnv: 'local' | 'dev' | 'prod';
  auth: {
    /** The nexus-web app id; the token azp must equal it. */
    webClientId: string;
    mode: 'entra' | 'dev';
    tenantId: string;
    /** Entra v2.0 issuer for the tenant. */
    issuer: string;
    /** Accepted `aud` values: the API identifier URI and the API client id (v2 tokens carry the latter). */
    audiences: string[];
    jwksUrl: string;
    requiredScope: string;
  };
  database: {
    /** Contains credentials when the URL has them: never log it. */
    url: string;
    poolMax: number;
  };
  http: {
    /** Exact origins CORS answers for. Empty means no cross-origin browser access. */
    corsOrigins: string[];
    bodyLimitBytes: number;
    /** Fastify trustProxy: how the client address is read from X-Forwarded-For. */
    trustProxy: TrustProxy;
    rateLimit: { userPerMinute: number; ipPerMinute: number };
  };
  arcgis: {
    /** A credential (referrer-restricted, but still): never log it. Undefined when not configured. */
    apiKey: string | undefined;
  };
}

export class ConfigError extends Error {}

/**
 * Fake identifiers for AUTH_MODE=dev with APP_ENV=local, used when the real ENTRA_* values are not
 * set, so a developer needs no Entra tenant. Only dev tokens are checked against them.
 */
export const DEV_ENTRA_DEFAULTS = {
  ENTRA_TENANT_ID: '00000000-0000-4000-8000-0000000000e1',
  ENTRA_API_CLIENT_ID: '00000000-0000-4000-8000-0000000000e2',
  ENTRA_WEB_CLIENT_ID: '00000000-0000-4000-8000-0000000000e3',
  ENTRA_API_AUDIENCE: 'api://nexus-api',
} as const;

export function loadConfig(rawEnv: NodeJS.ProcessEnv): AppConfig {
  const env: NodeJS.ProcessEnv = { ...rawEnv };
  if (env['AUTH_MODE'] === 'dev' && env['APP_ENV'] === 'local') {
    for (const [name, value] of Object.entries(DEV_ENTRA_DEFAULTS)) {
      if (env[name] === undefined || env[name] === '') env[name] = value;
    }
  }
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  if (parsed.data.AUTH_MODE === 'dev') {
    const problems = devModeProblems(env);
    if (problems.length > 0) {
      throw new ConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
    }
  }
  const e = parsed.data;
  const tenant = e.ENTRA_TENANT_ID.toLowerCase();
  return {
    appEnv: e.APP_ENV,
    auth: {
      mode: e.AUTH_MODE,
      webClientId: e.ENTRA_WEB_CLIENT_ID.toLowerCase(),
      tenantId: tenant,
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      audiences: [...new Set([e.ENTRA_API_AUDIENCE, e.ENTRA_API_CLIENT_ID])],
      jwksUrl: e.ENTRA_JWKS_URL ?? derivedJwksUrl(tenant),
      requiredScope: REQUIRED_SCOPE,
    },
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    http: {
      corsOrigins:
        e.CORS_ALLOWED_ORIGINS === undefined
          ? e.APP_ENV === 'local'
            ? [LOCAL_WEB_ORIGIN]
            : []
          : parseOrigins(e.CORS_ALLOWED_ORIGINS, e.APP_ENV).origins,
      bodyLimitBytes: e.BODY_LIMIT_BYTES,
      trustProxy: parseTrustProxy(e.TRUST_PROXY).value,
      rateLimit: {
        userPerMinute: e.RATE_LIMIT_USER_PER_MINUTE,
        ipPerMinute: e.RATE_LIMIT_IP_PER_MINUTE,
      },
    },
    arcgis: { apiKey: e.ARCGIS_API_KEY },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
