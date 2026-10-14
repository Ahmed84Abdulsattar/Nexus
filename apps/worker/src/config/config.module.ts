import { Global, Module } from '@nestjs/common';
import { loadWorkerConfig, WORKER_CONFIG, type WorkerConfig } from './env.js';

/** The validated environment, read once at startup. Global: inject with `@Inject(WORKER_CONFIG)`. */
@Global()
@Module({
  providers: [
    { provide: WORKER_CONFIG, useFactory: (): WorkerConfig => loadWorkerConfig(process.env) },
  ],
  exports: [WORKER_CONFIG],
})
export class ConfigModule {}
