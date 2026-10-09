import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // docs/04: DATOMS_LIVE=false (the default) means fixtures. S0 has no DATOMS code at all.
  const live = process.env['DATOMS_LIVE'] === 'true';
  new Logger('Worker').log(`worker started, DATOMS_LIVE=${live}, no jobs registered`);

  // Keeps the process alive until scheduled jobs exist (S2/S3); remove then.
  const keepAlive = setInterval(() => undefined, 60_000);
  process.once('SIGTERM', () => clearInterval(keepAlive));
  process.once('SIGINT', () => clearInterval(keepAlive));
}

void bootstrap();
