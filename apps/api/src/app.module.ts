import { type DynamicModule, Module, type Type } from '@nestjs/common';
import type { AppConfig } from './config/env.js';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './common/auth/auth.module.js';
import { DatabaseModule } from './common/db/database.module.js';
import { ConfigModule } from './config/config.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { ClientConfigModule } from './modules/config/client-config.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    AccessModule,
    ClientConfigModule,
  ],
  providers: [
    // Every body, query and param typed with a zod DTO from @nexus/shared is validated (422).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Responses declared with @ZodResponse are checked against their schema before they leave.
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}

/**
 * The application module for this configuration. With AUTH_MODE=dev (APP_ENV=local, local database;
 * loadConfig refuses anything else) it adds the local sign-in module, loaded with a dynamic import so
 * in every other mode that code is never even evaluated. main.ts uses this; plain AppModule is the
 * Entra-only application.
 */
export async function createAppModule(config: AppConfig): Promise<Type<unknown> | DynamicModule> {
  if (config.auth.mode !== 'dev') return AppModule;
  const { DevAuthModule } = await import('./dev/dev-auth.module.js');
  return { module: AppModule, imports: [DevAuthModule] };
}
