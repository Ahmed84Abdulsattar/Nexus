// Pure analysis of several fleet-mode bulk runs (used by `live fleet-watch`). No DATOMS calls here.
// Works on raw rows because it is a CLI report, not product code.

export interface RawRow {
  asset_id: string;
  success: boolean;
  data?: { time: string; parameters: Record<string, unknown> };
}

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export interface AssetCadence {
  assetId: string;
  times: (string | null)[];
  advanced: boolean[];
  deltasSeconds: number[];
}

export function cadence(runs: RawRow[][]): AssetCadence[] {
  const ids = [...new Set(runs.flatMap((r) => r.map((x) => x.asset_id)))];
  return ids.map((assetId) => {
    const times = runs.map((r) => r.find((x) => x.asset_id === assetId)?.data?.time ?? null);
    const advanced: boolean[] = [];
    const deltasSeconds: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const a = times[i - 1];
      const b = times[i];
      const moved =
        a !== null &&
        a !== undefined &&
        b !== null &&
        b !== undefined &&
        Date.parse(b) > Date.parse(a);
      advanced.push(moved);
      if (moved && a && b) deltasSeconds.push((Date.parse(b) - Date.parse(a)) / 1000);
    }
    return { assetId, times, advanced, deltasSeconds };
  });
}

export interface CategoryNulls {
  assets: number;
  keys: number;
  /** Null values over all assets of the category (assets x keys). */
  nullCount: number;
  valueCount: number;
  neverNull: string[];
  alwaysNull: string[];
  /** Per key: assets where the value is null. */
  nullAssetsPerKey: Record<string, number>;
}

export function nullStats(
  rows: RawRow[],
  categoryOf: (assetId: string) => string,
): Record<string, CategoryNulls> {
  const byCat = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.success || !r.data) continue;
    const c = categoryOf(r.asset_id);
    byCat.set(c, [...(byCat.get(c) ?? []), r]);
  }
  const out: Record<string, CategoryNulls> = {};
  for (const [cat, list] of byCat) {
    const keys = [...new Set(list.flatMap((r) => Object.keys(r.data?.parameters ?? {})))];
    const nullAssetsPerKey: Record<string, number> = {};
    let nullCount = 0;
    let valueCount = 0;
    for (const k of keys) {
      let n = 0;
      for (const r of list) {
        const v = r.data?.parameters[k];
        valueCount++;
        if (v === null || v === undefined) {
          n++;
          nullCount++;
        }
      }
      nullAssetsPerKey[k] = n;
    }
    out[cat] = {
      assets: list.length,
      keys: keys.length,
      nullCount,
      valueCount,
      neverNull: keys.filter((k) => nullAssetsPerKey[k] === 0),
      alwaysNull: keys.filter((k) => nullAssetsPerKey[k] === list.length),
      nullAssetsPerKey,
    };
  }
  return out;
}
