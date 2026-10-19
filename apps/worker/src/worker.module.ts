import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './db/database.module.js';

/** Config and the database provider. Leader lock, jobs, pipeline and publisher are added by their own tasks. */
@Module({ imports: [ConfigModule, DatabaseModule] })
export class WorkerModule {}
