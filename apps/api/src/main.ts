import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { mountDocs } from './openapi/setup.js';

// docs/04: the web app expects the API at http://localhost:3000.
const PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  mountDocs(app, app.get<AppConfig>(APP_CONFIG).appEnv);
  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
