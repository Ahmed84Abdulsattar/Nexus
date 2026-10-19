import { Module } from '@nestjs/common';
import { ClientConfigController } from './config.controller.js';
import { CLIENT_CONFIG_REPOSITORY, PostgresClientConfigRepository } from './config.repository.js';

@Module({
  controllers: [ClientConfigController],
  providers: [{ provide: CLIENT_CONFIG_REPOSITORY, useClass: PostgresClientConfigRepository }],
})
export class ClientConfigModule {}
