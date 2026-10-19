import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './common/auth/auth.module.js';
import { DatabaseModule } from './common/db/database.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, HealthModule],
  providers: [
    // Every body, query and param typed with a zod DTO from @nexus/shared is validated (422).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Responses declared with @ZodResponse are checked against their schema before they leave.
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
