import { describe, expect, it } from 'vitest';
import { BudgetTracker, InMemoryBudgetStore, fleetUnit } from '../src/index.js';

const T0 = Date.parse('2026-10-12T12:00:00Z');

function tracker(o: { fleet?: number; share?: number; allowance?: number } = {}) {
  const clock = { t: T0 };
  const b = new BudgetTracker({
    fleetSize: o.fleet ?? 500,
    maxShare: o.share ?? 1,
    ...(o.allowance !== undefined ? { monthlyAllowance: o.allowance } : {}),
    now: () => clock.t,
  });
  return { b, clock };
}

describe('budget tracker', () => {
  it('F is the fleet rounded up to 500, minimum 500', () => {
    expect(fleetUnit(22)).toBe(500);
    expect(fleetUnit(500)).toBe(500);
    expect(fleetUnit(501)).toBe(1000);
    expect(fleetUnit(20_000)).toBe(20_000);
  });

  it('caps follow the DATOMS windows and are multiplied by max_share', () => {
    const { b } = tracker({ share: 0.1 });
    const caps = Object.fromEntries(b.usage().map((u) => [u.name, u.cap]));
    expect(caps['1m']).toBe(4 * 500 * 0.1);
    expect(caps['5m']).toBe(8 * 500 * 0.1);
    expect(caps['1h']).toBe(100 * 500 * 0.1);
    expect(caps['24h']).toBe(2500 * 500 * 0.1);
    expect(caps['30d']).toBe(60000 * 500 * 0.1);
  });

  it('allows a full 500-row poll in prod, then waits when the 1m window would pass 90%', () => {
    const { b, clock } = tracker();
    expect(b.check(500).allowed).toBe(true);
    b.record(clock.t, 500);
    b.record(clock.t, 500);
    b.record(clock.t, 500); // 1500 of 2000 in the last minute
    const d = b.check(500); // 2000 > 1800 (90%)
    expect(d.allowed).toBe(false);
    expect(d.waitMs).toBe(60_000);
    clock.t += 60_001;
    expect(b.check(500).allowed).toBe(true);
  });

  it('a call that can never fit is skipped, not waited for', () => {
    const { b } = tracker({ share: 0.01 }); // 1m cap = 20, 90% = 18
    const d = b.check(500);
    expect(d.allowed).toBe(false);
    expect(d.waitMs).toBe(Infinity);
  });

  it('windows slide: old calls stop counting', () => {
    const { b, clock } = tracker();
    b.record(clock.t, 1000);
    expect(b.usage().find((u) => u.name === '1m')!.used).toBe(1000);
    clock.t += 61_000;
    expect(b.usage().find((u) => u.name === '1m')!.used).toBe(0);
    expect(b.usage().find((u) => u.name === '5m')!.used).toBe(1000);
  });

  it('the monthly allowance is a cap too, with a warning at 80%', () => {
    const { b, clock } = tracker({ allowance: 1000 });
    expect(b.allowanceWarning()).toBe(false);
    b.record(clock.t - 3_600_000, 800);
    expect(b.allowanceWarning()).toBe(true);
    // 800 used, 90% = 900: 150 more would pass it.
    expect(b.check(150).allowed).toBe(false);
    expect(b.check(50).allowed).toBe(true);
  });

  it('slows polls x2 above 80% and x5 above 90%, and recovers', () => {
    const { b, clock } = tracker();
    expect(b.slowdownFactor()).toBe(1);
    b.record(clock.t, 1700); // 85% of the 1m cap
    expect(b.slowdownFactor()).toBe(2);
    b.record(clock.t, 200); // 95%
    expect(b.slowdownFactor()).toBe(5);
    clock.t += 61_000;
    // 1m is clear again; the 5m window holds 1900 of 4000 = 47.5%.
    expect(b.slowdownFactor()).toBe(1);
  });

  it('uses the server count when it says fewer credits are left (Unit read first)', () => {
    const { b } = tracker();
    b.applyHeaders({ unit: 'asset-read-credits', limit: '2000', remaining: '30', reset: '45' });
    const d = b.check(100);
    expect(d.allowed).toBe(false);
    expect(d.waitMs).toBe(45_000);
  });

  it('ignores Limit/Remaining when there is no Unit header or the unit is requests', () => {
    const { b } = tracker();
    b.applyHeaders({ limit: '8', remaining: '0', reset: '300' }); // per-asset latest style
    expect(b.check(100).allowed).toBe(true);
    b.applyHeaders({ unit: 'requests', limit: '240', remaining: '0', reset: '30' });
    expect(b.check(100).allowed).toBe(true);
  });

  it('restores usage from the store after a restart', async () => {
    const store = new InMemoryBudgetStore();
    const { b, clock } = tracker();
    await store.append({
      at: clock.t - 10_000,
      endpoint: '/x',
      mode: 'fleet',
      status: 200,
      durationMs: 1,
      credits: 500,
      requests: 1,
      correlationId: 'c',
    });
    await b.restore(store);
    expect(b.usage().find((u) => u.name === '1m')!.used).toBe(500);
  });
});
