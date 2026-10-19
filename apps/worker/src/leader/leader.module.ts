import { Global, Logger, Module } from '@nestjs/common';
import { WORKER_CONFIG, type WorkerConfig } from '../config/env.js';
import { LeaderElection } from './leader-election.js';

/** The leader election (one dedicated connection holding an advisory lock). */
export const LEADER = Symbol('LEADER');

@Global()
@Module({
  providers: [
    {
      provide: LEADER,
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig): LeaderElection => {
        const logger = new Logger('Leader');
        return new LeaderElection({
          url: config.database.url,
          logger: { log: (m) => logger.log(m), warn: (m) => logger.warn(m) },
        });
      },
    },
  ],
  exports: [LEADER],
})
export class LeaderModule {}
