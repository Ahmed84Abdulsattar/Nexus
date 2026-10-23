import { createDatomsConnector } from '@nexus/connectors-datoms';
import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { WorkerConnector } from '../src/jobs/worker-connector.js';

const WORKER_URL = 'postgres://nexus_worker_local@127.0.0.1:1/nexus_unit_tests';

describe('DATOMS_MAX_SHARE_CEILING config (ADR 0005, S3-03 prep)', () => {
  const dbOnly = { WORKER_DATABASE_URL: WORKER_URL };

  it('is required outside prod, with a message that names the variable and no URL', () => {
    for (const appEnv of ['local', 'dev'] as const) {
      expect(() => loadWorkerConfig({ ...dbOnly, APP_ENV: appEnv })).toThrow(
        /DATOMS_MAX_SHARE_CEILING: required/,
      );
    }
    expect(() =>
      loadWorkerConfig({ ...dbOnly, APP_ENV: 'local', DATOMS_MAX_SHARE_CEILING: '' }),
    ).toThrow(/DATOMS_MAX_SHARE_CEILING/);
    try {
      loadWorkerConfig({ ...dbOnly, APP_ENV: 'local' });
    } catch (error) {
      expect((error as Error).message).not.toContain('127.0.0.1');
    }
  });

  it('refuses values outside (0, 1] and non-numbers', () => {
    for (const bad of ['0', '-0.1', '1.01', '2', 'abc']) {
      expect(() =>
        loadWorkerConfig({ ...dbOnly, APP_ENV: 'local', DATOMS_MAX_SHARE_CEILING: bad }),
      ).toThrow(/DATOMS_MAX_SHARE_CEILING/);
    }
  });

  it('accepts a valid ceiling and exposes it', () => {
    for (const ok of ['0.1', '1']) {
      expect(
        loadWorkerConfig({ ...dbOnly, APP_ENV: 'local', DATOMS_MAX_SHARE_CEILING: ok })
          .maxShareCeiling,
      ).toBe(Number(ok));
    }
  });

  it('is optional in prod and then 1; a value set in prod is still range checked', () => {
    const prod = { APP_ENV: 'prod', WORKER_DATABASE_URL: WORKER_URL + '?sslmode=verify-full' };
    expect(loadWorkerConfig(prod).maxShareCeiling).toBe(1);
    expect(loadWorkerConfig({ ...prod, DATOMS_MAX_SHARE_CEILING: '' }).maxShareCeiling).toBe(1);
    expect(loadWorkerConfig({ ...prod, DATOMS_MAX_SHARE_CEILING: '0.5' }).maxShareCeiling).toBe(
      0.5,
    );
    expect(() => loadWorkerConfig({ ...prod, DATOMS_MAX_SHARE_CEILING: '3' })).toThrow(
      /DATOMS_MAX_SHARE_CEILING/,
    );
  });

  it('refuses DATOMS_LIVE=true outside prod without the ceiling', () => {
    for (const appEnv of ['local', 'dev'] as const) {
      expect(() => loadWorkerConfig({ ...dbOnly, APP_ENV: appEnv, DATOMS_LIVE: 'true' })).toThrow(
        /DATOMS_LIVE=true is refused without it/,
      );
    }
    expect(
      loadWorkerConfig({
        ...dbOnly,
        APP_ENV: 'local',
        DATOMS_LIVE: 'true',
        DATOMS_MAX_SHARE_CEILING: '0.1',
      }).maxShareCeiling,
    ).toBe(0.1);
  });
});

describe('WorkerConnector applies the ceiling', () => {
  function rig(values: unknown[], ceiling: number) {
    const shares: number[] = [];
    const clamps: Array<[number, number]> = [];
    let i = 0;
    const c = new WorkerConnector(
      () => Promise.resolve(values[Math.min(i++, values.length - 1)]),
      (maxShare) => {
        shares.push(maxShare);
        return createDatomsConnector({ env: {}, maxShare });
      },
      { warn() {} },
      ceiling,
      (s, cl) => clamps.push([s, cl]),
    );
    return { c, shares, clamps };
  }

  it('setting 1.0 with ceiling 0.1 builds the connector with 0.1 and logs the clamp once', async () => {
    const { c, shares, clamps } = rig([1.0, 1.0, 1.0], 0.1);
    await c.refreshBudgetShare();
    await c.listAssets();
    await c.refreshBudgetShare();
    await c.refreshBudgetShare();
    expect(shares).toEqual([0.1]);
    expect(c.currentShare).toBe(0.1);
    expect(clamps).toEqual([[1, 0.1]]);
  });

  it('logs again on a change to another value above the ceiling, not while below it', async () => {
    const { c, clamps } = rig([0.5, 0.05, 0.5, 0.5, 0.8], 0.1);
    for (let n = 0; n < 5; n++) await c.refreshBudgetShare();
    expect(clamps).toEqual([
      [0.5, 0.1],
      [0.5, 0.1],
      [0.8, 0.1],
    ]);
    expect(c.currentShare).toBe(0.1);
  });

  it('uses a setting below the ceiling as is; the default ceiling 1 changes nothing', async () => {
    const a = rig([0.05], 0.1);
    await a.c.refreshBudgetShare();
    expect(a.c.currentShare).toBe(0.05);
    const b = rig([1], 1);
    await b.c.refreshBudgetShare();
    expect(b.c.currentShare).toBe(1);
    expect(b.clamps).toEqual([]);
  });

  it('applies the clamped share to a running connector', async () => {
    const { c } = rig([0.05, 1], 0.1);
    await c.refreshBudgetShare();
    await c.listAssets();
    await c.refreshBudgetShare();
    expect(c.currentShare).toBe(0.1);
  });
});
