import 'reflect-metadata';
import { Controller, Get, Module, Param, SetMetadata } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  type JWTPayload,
  SignJWT,
} from 'jose';
import { AppModule } from '../../src/app.module.js';
import { ACCESS_DIRECTORY } from '../../src/common/auth/access-context.js';
import {
  AnySignedIn,
  PUBLIC_KEY,
  Public,
  RequirePermission,
} from '../../src/common/auth/decorators.js';
import { JWT_KEY_RESOLVER } from '../../src/common/auth/entra-jwt.guard.js';
import type { InMemoryAccessDirectory } from '../../src/common/auth/in-memory-access-directory.js';
import { APP_CONFIG, type AppConfig, loadConfig } from '../../src/config/env.js';

export const TENANT_ID = '11111111-2222-4333-8444-555555555555';
export const API_AUDIENCE = 'api://nexus-api';
export const API_CLIENT_ID = '99999999-8888-4777-8666-555555555555';
export const WEB_CLIENT_ID = '77777777-6666-4555-8444-333333333333';
export const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

export const TEST_ENV = {
  APP_ENV: 'local',
  AUTH_MODE: 'entra',
  ENTRA_TENANT_ID: TENANT_ID,
  ENTRA_API_CLIENT_ID: API_CLIENT_ID,
  ENTRA_WEB_CLIENT_ID: WEB_CLIENT_ID,
  ENTRA_API_AUDIENCE: API_AUDIENCE,
} as const;

export interface TestKeys {
  kid: string;
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  publicJwk: JWK;
}

/** A fresh RSA key pair for tests. Never a real Entra key. */
export async function makeKeys(kid = 'test-key-1', alg = 'RS256'): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
  return { kid, privateKey, publicJwk };
}

export interface SignOptions {
  /** Claims merged over the valid defaults; set a claim to undefined to remove it. */
  claims?: Record<string, unknown>;
  keys: TestKeys;
  kid?: string;
  /** JWS algorithm in the header. Default RS256. */
  alg?: string;
  /** Extra protected header fields (jwk, jku, x5u ...). */
  header?: Record<string, unknown>;
  /** Sign with this key instead of keys.privateKey (HS256 secret etc.). */
  signWith?: Parameters<SignJWT['sign']>[0];
  expiresIn?: string | number;
  notBefore?: string | number;
  issuer?: string;
  audience?: string;
}

export const USER_OID = 'aaaaaaaa-0000-4000-8000-000000000001';

export function validClaims(): JWTPayload {
  return {
    tid: TENANT_ID,
    oid: USER_OID,
    scp: 'access_as_user',
    name: 'Test User',
    preferred_username: 'test.user@innovo.example',
    ver: '2.0',
    azp: WEB_CLIENT_ID,
  };
}

export async function signToken(opts: SignOptions): Promise<string> {
  const claims: Record<string, unknown> = { ...validClaims(), ...opts.claims };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  let jwt = new SignJWT(claims as JWTPayload)
    .setProtectedHeader({
      alg: opts.alg ?? 'RS256',
      kid: opts.kid ?? opts.keys.kid,
      ...opts.header,
    })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h');
  if (opts.notBefore !== undefined) jwt = jwt.setNotBefore(opts.notBefore);
  return jwt.sign(opts.signWith ?? opts.keys.privateKey);
}

/** Routes that exist only in tests, one per access mode. */
@Controller('test-auth')
export class TestAuthController {
  @Public()
  @Get('public')
  open(): { ok: true } {
    return { ok: true };
  }

  @AnySignedIn()
  @Get('any')
  any(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('asset.read')
  @Get('asset')
  asset(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('admin.users.manage')
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('project.read')
  @Get('projects/:projectId')
  project(@Param('projectId') projectId: string): { projectId: string } {
    return { projectId };
  }
}

/** A handler without any access decorator: must be refused, and the route scan must find it. */
@Controller('test-undecorated')
export class UndecoratedController {
  @Get()
  forgotten(): { leaked: true } {
    return { leaked: true };
  }
}

/** Class-level access metadata (set raw, as the typed decorators are method-only): refused. */
@SetMetadata(PUBLIC_KEY, true)
@Controller('test-class-level')
export class ClassLevelController {
  @Get()
  leaked(): { leaked: true } {
    return { leaked: true };
  }
}

/** Class-level plus method-level: also refused. */
@SetMetadata(PUBLIC_KEY, true)
@Controller('test-class-plus-method')
export class ClassPlusMethodController {
  @AnySignedIn()
  @Get()
  leaked(): { leaked: true } {
    return { leaked: true };
  }
}

@Module({
  controllers: [
    TestAuthController,
    UndecoratedController,
    ClassLevelController,
    ClassPlusMethodController,
  ],
})
export class TestRoutesModule {}

export interface TestApp {
  app: NestFastifyApplication;
  keys: TestKeys;
  directory: InMemoryAccessDirectory;
  config: AppConfig;
  token: (opts?: Partial<Omit<SignOptions, 'keys'>>) => Promise<string>;
  get: (url: string, token?: string) => ReturnType<NestFastifyApplication['inject']>;
}

export async function createTestApp(
  options: {
    withTestRoutes?: boolean;
    /** Extra public keys published in the JWKS (other algorithms). */
    extraKeys?: TestKeys[];
    /** Replaces the local JWKS, e.g. createKeyResolver(url) against a test server. */
    resolver?: JWTVerifyGetKey;
    env?: Record<string, string>;
  } = {},
): Promise<TestApp> {
  const keys = await makeKeys();
  const config = loadConfig({ ...TEST_ENV, ...options.env });
  const moduleRef = await Test.createTestingModule({
    imports: options.withTestRoutes ? [AppModule, TestRoutesModule] : [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(JWT_KEY_RESOLVER)
    .useValue(
      options.resolver ??
        createLocalJWKSet({
          keys: [keys.publicJwk, ...(options.extraKeys ?? []).map((k) => k.publicJwk)],
        }),
    )
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    keys,
    config,
    directory: app.get<InMemoryAccessDirectory>(ACCESS_DIRECTORY),
    token: (opts = {}) => signToken({ ...opts, keys }),
    get: (url, token) =>
      app.inject({
        method: 'GET',
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      }),
  };
}
