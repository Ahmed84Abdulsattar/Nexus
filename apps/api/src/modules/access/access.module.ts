import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { ME_REPOSITORY, PostgresMeRepository } from './me.repository.js';

@Module({
  controllers: [MeController],
  providers: [{ provide: ME_REPOSITORY, useClass: PostgresMeRepository }],
})
export class AccessModule {}
