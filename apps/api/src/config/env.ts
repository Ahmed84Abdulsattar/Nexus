import { DatabaseConfigError, requireTlsUnlessLocal } from '@nexus/db';
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
  })
  .superRefine((env, ctx) => {
    // The API holds a LISTEN connection for access-cache invalidation. Through a pooler in transaction
    // mode (Azure's built-in PgBouncer, port 6432) LISTEN is silently deaf, so refuse to start.
    try {
      if (new URL(env.DATABASE_URL).port === '6432') {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message:
            'port 6432 is the PgBouncer pooler; the API needs a direct connection (port 5432) for LISTEN',
        });
      }
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
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
