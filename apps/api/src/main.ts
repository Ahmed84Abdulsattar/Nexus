import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig, loadConfig } from './config/env.js';
import { configureApp } from './common/http/configure-app.js';
import { Logger } from '@nestjs/common';
import { applySecurity, createHttpAdapter, describeTrustProxy } from './common/http/security.js';
import { mountDocs } from './openapi/setup.js';

// docs/04: the web app expects the API at http://localhost:3000.
const PORT = 3000;

async function bootstrap(): Promise<void> {
  // Body limit and trustProxy are fixed when the Fastify instance is created, so read the config first.
  const adapterConfig = loadConfig(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createHttpAdapter(adapterConfig),
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app);
  await applySecurity(app, config);
  mountDocs(app, config.appEnv);
  Logger.log(describeTrustProxy(config.http.trustProxy), 'Bootstrap');
  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
