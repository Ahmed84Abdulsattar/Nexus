import 'reflect-metadata';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createAppModule } from '../../src/app.module.js';
import { AccessChangeListener } from '../../src/common/auth/access-change-listener.js';
import { ACCESS_DIRECTORY } from '../../src/common/auth/access-context.js';
import { InMemoryAccessDirectory } from '../../src/common/auth/in-memory-access-directory.js';
import { configureApp } from '../../src/common/http/configure-app.js';
import { applySecurity, createHttpAdapter } from '../../src/common/http/security.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/env.js';

export const LOCAL_DB = 'postgres://nexus_api_local@localhost:5432/nexus';

export const devEnv = (extra: Record<string, string> = {}) => ({
  APP_ENV: 'local',
  AUTH_MODE: 'dev',
  DATABASE_URL: LOCAL_DB,
  ...extra,
});

export interface DevApp {
  app: NestFastifyApplication;
  config: AppConfig;
  post: (
    url: string,
    payload: object,
    token?: string,
  ) => ReturnType<NestFastifyApplication['inject']>;
  get: (url: string, token?: string) => ReturnType<NestFastifyApplication['inject']>;
}

/** The real application in dev mode, built the way main.ts builds it, with an in-memory directory. */
export async function createInMemoryDevApp(config: AppConfig): Promise<DevApp> {
  const moduleRef = await Test.createTestingModule({ imports: [await createAppModule(config)] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(ACCESS_DIRECTORY)
    .useClass(InMemoryAccessDirectory)
    .overrideProvider(AccessChangeListener)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(config));
  configureApp(app);
  await applySecurity(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const auth = (token?: string) => (token ? { headers: { authorization: `Bearer ${token}` } } : {});
  return {
    app,
    config,
    post: (url, payload, token) => app.inject({ method: 'POST', url, payload, ...auth(token) }),
    get: (url, token) => app.inject({ method: 'GET', url, ...auth(token) }),
  };
}
