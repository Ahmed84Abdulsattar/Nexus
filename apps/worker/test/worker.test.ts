import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { WorkerModule } from '../src/worker.module.js';

it('compiles the worker module', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  expect(moduleRef.get(WorkerModule)).toBeInstanceOf(WorkerModule);
});
