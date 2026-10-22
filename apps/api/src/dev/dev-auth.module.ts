import { Global, Module } from '@nestjs/common';
import { isLocalHost } from '@nexus/db';
import { DEV_KEY_SOURCE } from '../common/auth/dev-key-source.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DevAuthController } from './dev-auth.controller.js';
import { LocalRequestHook } from './local-request.hook.js';
import { DevKeyService } from './dev-key.service.js';

/**
 * Local sign-in. Loaded with a dynamic import() by createAppModule only when AUTH_MODE=dev, so in
 * every other mode this file is never evaluated. The factory re-checks the guards of loadConfig as a
 * second line of defence. Global: AuthModule reads the key source without importing this folder.
 */
@Global()
@Module({
  controllers: [DevAuthController],
  providers: [
    LocalRequestHook,
    {
      provide: DEV_KEY_SOURCE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Promise<DevKeyService> => {
        if (
          config.auth.mode !== 'dev' ||
          config.appEnv !== 'local' ||
          !isLocalHost(config.database.url)
        ) {
          throw new Error('Local sign-in needs AUTH_MODE=dev, APP_ENV=local and a local database.');
        }
        return DevKeyService.create();
      },
    },
  ],
  exports: [DEV_KEY_SOURCE],
})
export class DevAuthModule {}
