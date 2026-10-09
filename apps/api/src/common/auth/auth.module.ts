import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { APP_CONFIG, type AppConfig, loadConfig } from '../../config/env.js';
import { ProblemJsonFilter } from '../http/problem-json.filter.js';
import { ACCESS_DIRECTORY, AccessContextService, CLOCK } from './access-context.js';
import { EntraJwtGuard, JWT_KEY_RESOLVER } from './entra-jwt.guard.js';
import { InMemoryAccessDirectory } from './in-memory-access-directory.js';
import { PermissionGuard } from './permission.guard.js';

/**
 * Global authentication and authorisation (docs/08 sections 2-3). Imported once, by AppModule.
 * The config is read and validated here, so a bad environment stops the app at startup.
 */
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig(process.env) },
    {
      provide: JWT_KEY_RESOLVER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.auth.mode === 'dev') {
          throw new Error('AUTH_MODE=dev is not implemented yet; use AUTH_MODE=entra.');
        }
        // Remote JWKS from config: cached, re-fetched on an unknown kid (key rollover), rate limited.
        return createRemoteJWKSet(new URL(config.auth.jwksUrl));
      },
    },
    // S1-01 replaces this with the Postgres implementation.
    { provide: ACCESS_DIRECTORY, useClass: InMemoryAccessDirectory },
    { provide: CLOCK, useValue: (): number => Date.now() },
    AccessContextService,
    { provide: APP_GUARD, useClass: EntraJwtGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
  ],
  exports: [AccessContextService, APP_CONFIG, ACCESS_DIRECTORY],
})
export class AuthModule {}
