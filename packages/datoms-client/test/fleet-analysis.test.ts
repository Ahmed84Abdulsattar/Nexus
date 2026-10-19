import { describe, expect, it } from 'vitest';
import { cadence, median, nullStats, type RawRow } from '../scripts/fleet-analysis.js';

const row = (id: string, time: string, p: Record<string, unknown> = {}): RawRow => ({
  asset_id: id,
  success: true,
  data: { time, parameters: p },
});

describe('fleet-watch analysis', () => {
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('finds advanced packets, deltas and assets that never updated', () => {
    const runs = [
      [row('a', '2026-10-14T10:00:00Z'), row('b', '2026-10-14T09:00:00Z')],
      [row('a', '2026-10-14T10:01:00Z'), row('b', '2026-10-14T09:00:00Z')],
      [row('a', '2026-10-14T10:02:10Z'), row('b', '2026-10-14T09:00:00Z')],
    ];
    const [a, b] = cadence(runs);
    expect(a?.advanced).toEqual([true, true]);
    expect(a?.deltasSeconds).toEqual([60, 70]);
    expect(b?.advanced).toEqual([false, false]);
    expect(b?.deltasSeconds).toEqual([]);
  });

  it('counts nulls per category, never-null and always-null keys', () => {
    const rows = [
      row('1', 't', { x: 1, y: null, z: 0 }),
      row('2', 't', { x: 2, y: null, z: null }),
    ].map((r) => ({ ...r, data: { ...r.data!, time: '2026-10-14T10:00:00Z' } }));
    const out = nullStats(rows, () => 'DG');
    expect(out['DG']).toMatchObject({
      assets: 2,
      keys: 3,
      nullCount: 3,
      valueCount: 6,
      neverNull: ['x'],
      alwaysNull: ['y'],
    });
  });
});
