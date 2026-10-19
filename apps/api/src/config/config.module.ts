import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, loadConfig } from './env.js';

/**
 * The validated environment, read once at startup, so a bad environment stops the app before it
 * serves anything. Global: inject with `@Inject(APP_CONFIG)`.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
