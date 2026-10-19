import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './db/database.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LeaderModule } from './leader/leader.module.js';

/**
 * Config, the database provider, the leader election and the jobs. Today the only job is the
 * catalogue sync (S3-01); the live poll, rollups and maintenance are added by their own tasks.
 */
@Module({ imports: [ConfigModule, DatabaseModule, LeaderModule, JobsModule] })
export class WorkerModule {}
