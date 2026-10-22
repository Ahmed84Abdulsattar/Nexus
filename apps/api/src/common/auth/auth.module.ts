import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { UserRateLimiter } from '../rate-limit/rate-limit.js';
import { ProblemJsonFilter } from '../http/problem-json.filter.js';
import { AccessChangeListener } from './access-change-listener.js';
import { ACCESS_DIRECTORY, AccessContextService, CLOCK } from './access-context.js';
import { DEV_KEY_SOURCE, type DevKeySource } from './dev-key-source.js';
import { EntraJwtGuard, JWT_KEY_RESOLVER } from './entra-jwt.guard.js';
import { createKeyResolver } from './key-resolver.js';
import { PermissionGuard } from './permission.guard.js';
import { PostgresAccessDirectory } from './postgres-access-directory.js';
import { ProjectScopeGuard } from './project-scope.guard.js';

/**
 * Global authentication and authorisation (docs/08 sections 2-3). Imported once, by AppModule.
 * APP_CONFIG (ConfigModule) and DB (DatabaseModule) are global.
 */
@Module({
  providers: [
    {
      provide: JWT_KEY_RESOLVER,
      inject: [APP_CONFIG, { token: DEV_KEY_SOURCE, optional: true }],
      useFactory: (config: AppConfig, devKeys: DevKeySource | undefined) => {
        if (config.auth.mode === 'dev') {
          // Local sign-in (docs/08): the same guard and the same jwtVerify checks, with the keys of
          // an in-memory pair instead of the Entra JWKS. Provided by src/dev/, loaded only in this mode.
          if (!devKeys)
            throw new Error('AUTH_MODE=dev needs the dev key source (createAppModule).');
          return devKeys.resolver;
        }
        // Remote JWKS from config: cached 6 h, re-fetched on an unknown kid (key rollover), rate limited.
        return createKeyResolver(new URL(config.auth.jwksUrl));
      },
    },
    { provide: ACCESS_DIRECTORY, useClass: PostgresAccessDirectory },
    { provide: CLOCK, useValue: (): number => Date.now() },
    AccessContextService,
    // Clears the access cache on every instance when the database announces a change.
    AccessChangeListener,
    // The per-address limit is an onRequest hook (applySecurity); EntraJwtGuard calls the per-user one.
    UserRateLimiter,
    { provide: APP_GUARD, useClass: EntraJwtGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ProjectScopeGuard },
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
  ],
  exports: [AccessContextService, ACCESS_DIRECTORY],
})
export class AuthModule {}
