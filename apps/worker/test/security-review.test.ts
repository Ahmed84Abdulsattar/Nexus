import { createDatomsConnector } from '@nexus/connectors-datoms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerConfig, WorkerConfigError } from '../src/config/env.js';
import { WorkerConnector } from '../src/jobs/worker-connector.js';
import { LeaderElection } from '../src/leader/leader-election.js';
import { MAX_TIMER_MS, Scheduler, type ScheduledJob } from '../src/scheduler/scheduler.js';

const MIN = 60_000;

describe('M1: the worker refuses the PgBouncer port', () => {
  const base = { APP_ENV: 'local' };
  it('port 6432 in the URL', () => {
    expect(() =>
      loadWorkerConfig({ ...base, WORKER_DATABASE_URL: 'postgres://w@db.example:6432/nexus' }),
    ).toThrow(/6432.*advisory locks/s);
  });
  it('?port=6432 as a query parameter', () => {
    expect(() =>
      loadWorkerConfig({
        ...base,
        WORKER_DATABASE_URL: 'postgres://w@db.example:5432/nexus?port=6432',
      }),
    ).toThrow(WorkerConfigError);
  });
  it('names the variable and never prints the password', () => {
    try {
      loadWorkerConfig({ ...base, WORKER_DATABASE_URL: 'postgres://w:hunter2@db.example:6432/n' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('WORKER_DATABASE_URL');
      expect((e as Error).message).not.toContain('hunter2');
    }
  });
  it('accepts the direct port', () => {
    expect(
      loadWorkerConfig({ ...base, WORKER_DATABASE_URL: 'postgres://w@db.example:5432/nexus' })
        .database.url,
    ).toContain(':5432');
  });
  it('LeaderElection itself refuses it too (defence in depth)', async () => {
    const warnings: string[] = [];
    const e = new LeaderElection({
      url: 'postgres://w@db.example:6432/nexus',
      logger: { log() {}, warn: (m) => warnings.push(m) },
    });
    expect(await e.ensureLeader()).toBe(false);
    expect(warnings.join()).toMatch(/6432/);
  });
});

describe('L3: a hung leader check does not stall the jobs', () => {
  it('returns false within the bound and answers every waiting caller', async () => {
    // 10.255.255.1 never answers: the connect hangs until the bound destroys it.
    const e = new LeaderElection({
      url: 'postgres://w@10.255.255.1:5432/nexus',
      checkTimeoutMs: 300,
      closeTimeoutMs: 100,
    });
    const started = Date.now();
    const [a, b] = await Promise.all([e.ensureLeader(), e.ensureLeader()]);
    expect([a, b]).toEqual([false, false]);
    expect(Date.now() - started).toBeLessThan(3_000);
    // A later check starts afresh (the `checking` slot was cleared).
    expect(await e.ensureLeader()).toBe(false);
    await e.release();
  });
});

describe('scheduler: security review fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(over: Partial<ScheduledJob> = {}, signal?: () => AbortSignal) {
    const runs: number[] = [];
    const s = new Scheduler({
      ensureLeader: () => Promise.resolve(true),
      ...(signal ? { leaderSignal: signal } : {}),
    });
    s.register({
      name: 'j',
      runOnStart: true,
      intervalMs: () => 60 * MIN,
      minEarlyGapMs: 5 * MIN,
      run: () => {
        runs.push(Date.now());
        return Promise.resolve();
      },
      ...over,
    });
    return { s, runs };
  }

  it('M2: an interval above the timer limit is clamped, never fired at once', async () => {
    const { s, runs } = make({ intervalMs: () => 10 ** 12 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(runs).toHaveLength(1); // not an immediate re-run
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
    s.stop();
  });

  it('L1: jobs get the signal of the leader term', async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const { s } = make(
      {
        run: (sig) => {
          seen = sig;
          return Promise.resolve();
        },
      },
      () => ctl.signal,
    );
    await s.runNow('j');
    expect(seen).toBe(ctl.signal);
  });

  it('Info: requestEarly is not_allowed once stopped', async () => {
    const { s } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    s.stop();
    expect(s.requestEarly('j')).toBe('not_allowed');
  });

  it('QA: an early request during a run is remembered and run once afterwards, bounded by the gap', async () => {
    let release: () => void = () => undefined;
    const runs: number[] = [];
    const { s } = make({
      run: () => {
        runs.push(Date.now());
        return new Promise<void>((r) => (release = r));
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.requestEarly('j')).toBe('running');
    expect(s.requestEarly('j')).toBe('running');
    await vi.advanceTimersByTimeAsync(MIN); // the run lasts a minute
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1); // not at once: the gap since the start is 1 minute
    await vi.advanceTimersByTimeAsync(4 * MIN + 10);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(2);
    expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(5 * MIN);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(runs).toHaveLength(2); // just one
    s.stop();
  });

  it('L5: idle() gives up after its timeout', async () => {
    const { s } = make({ run: () => new Promise<void>(() => undefined) });
    void s.runNow('j');
    await vi.advanceTimersByTimeAsync(0);
    const idle = s.idle(1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await idle).toBe(false);
  });
});

describe('M4: budget.max_share is applied at run time', () => {
  function rig(values: unknown[]) {
    const warnings: string[] = [];
    const shares: number[] = [];
    let i = 0;
    const c = new WorkerConnector(
      () => Promise.resolve(values[Math.min(i++, values.length - 1)]),
      (maxShare) => {
        shares.push(maxShare);
        return createDatomsConnector({ env: {}, maxShare });
      },
      { warn: (m) => warnings.push(m) },
    );
    return { c, warnings, shares };
  }

  it('builds the connector with the share from the setting and never with a default', async () => {
    const { c, shares } = rig([0.1]);
    await c.refreshBudgetShare();
    await c.listAssets();
    expect(shares).toEqual([0.1]);
  });

  it('refuses to run before a valid share has been read', async () => {
    const { c } = rig(['nope']);
    await expect(c.refreshBudgetShare()).rejects.toThrow(/no earlier valid value/);
    await expect(c.listAssets()).rejects.toThrow(/refreshBudgetShare/);
  });

  it('applies a changed share, and keeps the last valid one when a later value is invalid', async () => {
    const { c, warnings } = rig([0.1, 0.3, 5, null, 0]);
    await c.refreshBudgetShare();
    await c.listAssets();
    await c.refreshBudgetShare();
    expect(c.currentShare).toBe(0.3);
    for (let k = 0; k < 3; k++) await c.refreshBudgetShare(); // 5, null, 0: all invalid
    expect(c.currentShare).toBe(0.3); // never 1
    expect(warnings).toHaveLength(3);
    expect((await c.listAssets()).total).toBe(22); // still works
  });
});
