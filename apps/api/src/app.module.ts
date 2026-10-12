import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './common/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [AuthModule, HealthModule],
  providers: [
    // Every body, query and param typed with a zod DTO from @nexus/shared is validated (422).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Responses declared with @ZodResponse are checked against their schema before they leave.
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
