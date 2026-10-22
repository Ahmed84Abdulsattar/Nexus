import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig, WORKER_CONFIG, WorkerConfigError } from '../src/config/env.js';
import { DB } from '../src/db/database.module.js';
import { WorkerModule } from '../src/worker.module.js';

const WORKER_URL = 'postgres://nexus_worker_local@127.0.0.1:1/nexus_unit_tests';
const API_URL = 'postgres://nexus_api_local@127.0.0.1:1/nexus_unit_tests';
const CEIL = { DATOMS_MAX_SHARE_CEILING: '0.1' };

describe('worker config', () => {
  it('reads WORKER_DATABASE_URL and the pool size', () => {
    const c = loadWorkerConfig({
      APP_ENV: 'prod',
      WORKER_DATABASE_URL: WORKER_URL + '?sslmode=verify-full',
      DATABASE_URL: API_URL,
      DATABASE_POOL_MAX: '4',
    });
    expect(c.database).toEqual({
      url: WORKER_URL + '?sslmode=verify-full',
      poolMax: 4,
      fellBack: false,
    });
  });

  it('requires TLS outside APP_ENV=local', () => {
    expect(() => loadWorkerConfig({ APP_ENV: 'prod', WORKER_DATABASE_URL: WORKER_URL })).toThrow(
      /must use TLS/,
    );
  });

  it('falls back to DATABASE_URL only when APP_ENV=local', () => {
    expect(
      loadWorkerConfig({ ...CEIL, APP_ENV: 'local', DATABASE_URL: API_URL }).database,
    ).toMatchObject({
      url: API_URL,
      fellBack: true,
      poolMax: 10,
    });
    for (const appEnv of ['dev', 'prod'] as const) {
      expect(() => loadWorkerConfig({ ...CEIL, APP_ENV: appEnv, DATABASE_URL: API_URL })).toThrow(
        /WORKER_DATABASE_URL is not set/,
      );
    }
  });

  it('refuses a missing or unknown APP_ENV and a bad pool size, without printing URLs', () => {
    expect(() => loadWorkerConfig({ WORKER_DATABASE_URL: WORKER_URL })).toThrow(WorkerConfigError);
    expect(() =>
      loadWorkerConfig({ ...CEIL, APP_ENV: 'test', WORKER_DATABASE_URL: WORKER_URL }),
    ).toThrow(/APP_ENV/);
    const bad = {
      ...CEIL,
      APP_ENV: 'local',
      WORKER_DATABASE_URL: WORKER_URL,
      DATABASE_POOL_MAX: '0',
    };
    expect(() => loadWorkerConfig(bad)).toThrow(/DATABASE_POOL_MAX/);
    try {
      loadWorkerConfig({
        ...CEIL,
        APP_ENV: 'local',
        WORKER_DATABASE_URL: 'mysql://u:hunter2@h/db',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});

describe('worker module', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, {
      APP_ENV: 'local',
      WORKER_DATABASE_URL: WORKER_URL,
      DATOMS_MAX_SHARE_CEILING: '0.1',
    });
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('compiles with config and a lazy database provider (no connection is made)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeInstanceOf(WorkerModule);
    expect(moduleRef.get(WORKER_CONFIG).database.url).toBe(WORKER_URL);
    expect(moduleRef.get(DB)).toBeDefined();
    await moduleRef.close();
  });
});
