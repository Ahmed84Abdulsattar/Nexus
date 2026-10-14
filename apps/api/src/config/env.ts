import { isIP } from 'node:net';
import { z } from 'zod';

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
 * TRUST_PROXY: off, or the addresses/CIDRs of the proxies in front of the API. A hop count is not
 * accepted: Fastify 5 treats a number as "trust nobody" (it cannot check the immediate peer), and
 * "true" would let any client choose its address through X-Forwarded-For.
 */
function parseTrustProxy(raw: string | undefined): { value: TrustProxy; problem?: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'false') return { value: false };
  const list = v.split(',').map((a) => a.trim());
  const ok = list.every((a) => {
    const [addr, bits, ...rest] = a.split('/');
    if (rest.length > 0 || addr === undefined || isIP(addr) === 0) return false;
    if (bits === undefined) return true;
    // /0 would trust every address, which is the same as "true".
    return (
      /^\d{1,3}$/.test(bits) && Number(bits) >= 1 && Number(bits) <= (isIP(addr) === 4 ? 32 : 128)
    );
  });
  return ok
    ? { value: list }
    : {
        value: false,
        problem:
          'use false, or a comma-separated list of proxy IP addresses or CIDRs (not true, not /0, not a hop count)',
      };
}

export type TrustProxy = false | string[];

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
    TRUST_PROXY: z.preprocess(blankToUndefined, z.string().optional()),
  })
  .superRefine((env, ctx) => {
    for (const message of parseOrigins(env.CORS_ALLOWED_ORIGINS ?? '', env.APP_ENV).problems) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message });
    }
    const proxy = parseTrustProxy(env.TRUST_PROXY);
    if (proxy.problem)
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: proxy.problem });
    if (env.AUTH_MODE === 'dev' && env.APP_ENV !== 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is allowed only when APP_ENV=local (docs/04)',
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
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
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
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
