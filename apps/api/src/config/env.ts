import { z } from 'zod';

/**
 * Environment of the API, validated once at startup (docs/04 "Environment variables").
 * Only the variables the API uses today are listed; later tasks add their own.
 * Secrets never come from here: Key Vault is wired in a later task.
 */
const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'prod']),
    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_TENANT_ID: z.guid(),
    ENTRA_API_CLIENT_ID: z.string().min(1),
    /** Identifier URI of nexus-api, e.g. api://nexus-api. */
    ENTRA_API_AUDIENCE: z.string().min(1),
    /** Optional override. Default: the tenant v2.0 JWKS endpoint derived from ENTRA_TENANT_ID. */
    ENTRA_JWKS_URL: z.url().optional(),
  })
  .refine((env) => env.AUTH_MODE !== 'dev' || env.APP_ENV === 'local', {
    path: ['AUTH_MODE'],
    message: 'AUTH_MODE=dev is allowed only when APP_ENV=local (docs/04)',
  });

/** The delegated scope the SPA asks for (docs/08 section 1). */
export const REQUIRED_SCOPE = 'access_as_user';

export interface AppConfig {
  appEnv: 'local' | 'dev' | 'prod';
  auth: {
    mode: 'entra' | 'dev';
    tenantId: string;
    /** Entra v2.0 issuer for the tenant. */
    issuer: string;
    /** Accepted `aud` values: the API identifier URI and the API client id (v2 tokens carry the latter). */
    audiences: string[];
    jwksUrl: string;
    requiredScope: string;
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
      tenantId: tenant,
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      audiences: [...new Set([e.ENTRA_API_AUDIENCE, e.ENTRA_API_CLIENT_ID])],
      jwksUrl:
        e.ENTRA_JWKS_URL ?? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
      requiredScope: REQUIRED_SCOPE,
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
