import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  // The schedule starts in onApplicationBootstrap (SchedulerService). Timers keep the process
  // alive; SIGTERM / SIGINT stop the schedule, wait for a running job and release the leader lock.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // docs/04: DATOMS_LIVE=false (the default) means fixtures.
  const live = process.env['DATOMS_LIVE'] === 'true';
  new Logger('Worker').log(`worker started, DATOMS_LIVE=${live}, jobs: catalogue-sync`);
}

bootstrap().catch((error: unknown) => {
  // Config errors name the missing variable and never print a URL or a token.
  new Logger('Worker').error(error instanceof Error ? error.message : 'worker failed to start');
  process.exitCode = 1;
});
