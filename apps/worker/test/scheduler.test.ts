import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler, type ScheduledJob } from '../src/scheduler/scheduler.js';

const HOUR = 3_600_000;

function rig(opts: { leader?: () => Promise<boolean>; run?: () => Promise<void> } = {}) {
  const runs: number[] = [];
  const errors: string[] = [];
  const ensureLeader = vi.fn(opts.leader ?? (() => Promise.resolve(true)));
  const scheduler = new Scheduler({
    ensureLeader,
    logger: { log() {}, warn() {}, error: (m) => errors.push(m) },
  });
  const run =
    opts.run ??
    ((): Promise<void> => {
      runs.push(Date.now());
      return Promise.resolve();
    });
  const job: ScheduledJob = {
    name: 'j',
    runOnStart: true,
    intervalMs: () => HOUR,
    minEarlyGapMs: 5 * 60_000,
    run,
  };
  scheduler.register(job);
  return { scheduler, runs, errors, ensureLeader };
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on start, then every interval', async () => {
    const { scheduler, runs } = rig();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(runs).toHaveLength(3);
    scheduler.stop();
  });

  it('checks the leader before every run and does nothing when it is not the leader', async () => {
    let leader = false;
    const { scheduler, runs, ensureLeader } = rig({ leader: () => Promise.resolve(leader) });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(0);
    expect(ensureLeader).toHaveBeenCalledTimes(1);
    // A replica that is not the leader looks again within a minute, not after a whole hour.
    leader = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toHaveLength(1);
    expect(ensureLeader).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('never overlaps: a tick during a running job is skipped', async () => {
    let release: () => void = () => undefined;
    let started = 0;
    const { scheduler } = rig({
      run: () => {
        started++;
        return new Promise<void>((resolve) => (release = resolve));
      },
    });
    const first = scheduler.runNow('j');
    await vi.advanceTimersByTimeAsync(0);
    expect(await scheduler.runNow('j')).toBe('skipped_overlap');
    expect(started).toBe(1);
    release();
    expect(await first).toBe('ran');
  });

  it('a failing job is logged and the schedule continues', async () => {
    let n = 0;
    const { scheduler, errors } = rig({
      run: () => (++n === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors.join()).toContain('boom');
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(n).toBe(2);
    scheduler.stop();
  });

  it('a leader check that throws counts as not leader', async () => {
    const { scheduler, runs, errors } = rig({ leader: () => Promise.reject(new Error('db down')) });
    expect(await scheduler.runNow('j')).toBe('skipped_not_leader');
    expect(runs).toHaveLength(0);
    expect(errors.join()).toContain('leader check failed');
  });

  describe('early runs (unknown ids seen by the poll)', () => {
    it('starts at once when the last run began more than 5 minutes ago', async () => {
      const { scheduler, runs } = rig();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(runs).toHaveLength(1);
      expect(scheduler.requestEarly('j')).toBe('started');
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toHaveLength(2);
      scheduler.stop();
    });

    it('at most once per 5 minutes: a request inside the gap is deferred, and many make one run', async () => {
      const { scheduler, runs } = rig();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000); // last run began 1 minute ago
      expect(scheduler.requestEarly('j')).toBe('deferred');
      expect(scheduler.requestEarly('j')).toBe('already_pending');
      expect(scheduler.requestEarly('j')).toBe('already_pending');
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(runs).toHaveLength(1); // still inside the gap
      await vi.advanceTimersByTimeAsync(60_000 + 1);
      expect(runs).toHaveLength(2); // exactly one early run, 5 minutes after the last start
      expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(5 * 60_000);
      scheduler.stop();
    });

    it('is ignored while the job is running and for jobs that allow no early runs', async () => {
      let release: () => void = () => undefined;
      const { scheduler } = rig({ run: () => new Promise<void>((r) => (release = r)) });
      const first = scheduler.runNow('j');
      await vi.advanceTimersByTimeAsync(0);
      expect(scheduler.requestEarly('j')).toBe('running');
      release();
      await first;

      const s2 = new Scheduler({ ensureLeader: () => Promise.resolve(true) });
      s2.register({
        name: 'x',
        runOnStart: false,
        intervalMs: () => HOUR,
        run: () => Promise.resolve(),
      });
      expect(s2.requestEarly('x')).toBe('not_allowed');
    });
  });

  it('stop() cancels the schedule', async () => {
    const { scheduler, runs } = rig();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(runs).toHaveLength(1);
  });
});
