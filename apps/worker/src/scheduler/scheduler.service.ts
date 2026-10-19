import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { LeaderElection } from '../leader/leader-election.js';
import { LEADER } from '../leader/leader.module.js';
import { Scheduler, type ScheduledJob } from './scheduler.js';

/**
 * Nest wrapper around `Scheduler`: jobs register in `onModuleInit`, the schedule starts once every
 * module is up, and before shutdown (so before the database pool closes) it stops, waits for a running job and gives the leader lock back.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly scheduler: Scheduler;

  constructor(@Inject(LEADER) private readonly leader: LeaderElection) {
    const logger = new Logger('Scheduler');
    this.scheduler = new Scheduler({
      ensureLeader: () => this.leader.ensureLeader(),
      logger: {
        log: (m) => logger.log(m),
        warn: (m) => logger.warn(m),
        error: (m) => logger.error(m),
      },
    });
  }

  register(job: ScheduledJob): void {
    this.scheduler.register(job);
  }

  requestEarly(name: string): ReturnType<Scheduler['requestEarly']> {
    return this.scheduler.requestEarly(name);
  }

  runNow(name: string): ReturnType<Scheduler['runNow']> {
    return this.scheduler.runNow(name);
  }

  onApplicationBootstrap(): void {
    this.scheduler.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.scheduler.stop();
    await this.scheduler.idle();
    await this.leader.release();
  }
}
