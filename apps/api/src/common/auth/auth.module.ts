import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { ProblemJsonFilter } from '../http/problem-json.filter.js';
import { AccessChangeListener } from './access-change-listener.js';
import { ACCESS_DIRECTORY, AccessContextService, CLOCK } from './access-context.js';
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
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.auth.mode === 'dev') {
          throw new Error('AUTH_MODE=dev is not implemented yet; use AUTH_MODE=entra.');
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
    { provide: APP_GUARD, useClass: EntraJwtGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ProjectScopeGuard },
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
  ],
  exports: [AccessContextService, ACCESS_DIRECTORY],
})
export class AuthModule {}
