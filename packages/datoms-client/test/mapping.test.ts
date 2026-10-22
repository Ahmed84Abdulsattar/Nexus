import { describe, expect, it } from 'vitest';
import {
  bulkFleetRequest,
  bulkIdRequest,
  mapAsset,
  mapAssetListPage,
  mapBulkPage,
  mapBulkRows,
  type RawAssetList,
  type RawBulkResponse,
  type RawBulkRow,
} from '../src/index.js';
import { fixture } from './helpers.js';

const list = fixture<RawAssetList>('assets-list-legacy-22.json').body;
const bulk = fixture<RawBulkResponse>('bulk-latest-id-mode.json').body;

describe('asset list mapping', () => {
  it('maps the recorded list: 22 assets by category', () => {
    const page = mapAssetListPage(list);
    expect(page.assets).toHaveLength(22);
    expect(page.pagination).toEqual({ total: 22, page: 1, limit: 1000, totalPages: 1 });
    const counts: Record<string, number> = {};
    for (const a of page.assets)
      counts[a.sourceTypeName ?? '?'] = (counts[a.sourceTypeName ?? '?'] ?? 0) + 1;
    expect(counts).toEqual({
      'AC Sub-Meter': 12,
      'DG Set': 8,
      'Fuel Tank': 1,
      'Solar Inverter': 1,
    });
  });

  it('maps one asset field by field; nameplate passes through unchanged, nulls kept', () => {
    const raw = list.data.find((a) => a.id === '42485')!;
    const a = mapAsset(raw);
    expect(a.externalId).toBe('42485');
    expect(a.name).toBe('DG-3062');
    expect(a.sourceTypeName).toBe('DG Set');
    expect(a.sourceTypeId).toBe('18');
    expect(a.lifecycleStatus).toBe('active');
    expect(a.createdAt).toBeInstanceOf(Date);
    expect(a.nameplate).toEqual(raw.asset_info);
    expect(a.nameplate?.['model']).toBeNull();
  });

  it('missing fields are absent, not defaulted', () => {
    const a = mapAsset({ id: '1' });
    expect(a.name).toBeUndefined();
    expect(a.createdAt).toBeUndefined();
    expect(a.sourceTypeName).toBeUndefined();
    expect(a.sourceTypeId).toBeUndefined();
    expect(a.lifecycleStatus).toBeUndefined();
    expect(a.nameplate).toBeUndefined();
  });
});

describe('bulk mapping', () => {
  it('maps the recorded rows; non-null values pass through unchanged', () => {
    const page = mapBulkPage(bulk);
    expect(page.readings).toHaveLength(4);
    expect(page.noData).toEqual([]);
    expect(page.invalid).toEqual([]);
    for (const row of bulk.data) {
      const r = page.readings.find((x) => x.externalAssetId === row.asset_id)!;
      expect(r.ts).toEqual(new Date(row.data!.time));
      const p = row.data!.parameters;
      expect(r.values).toEqual(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null)));
      expect(r.seenKeys).toEqual(Object.keys(p));
    }
  });

  it('drops null values (null means no data) but keeps every key in seenKeys', () => {
    const dg = mapBulkPage(bulk).readings.find((r) => r.externalAssetId === '42485')!;
    expect('mc_st' in dg.values).toBe(false);
    expect(Object.values(dg.values).some((v) => v === null)).toBe(false);
    expect(Object.keys(dg.values)).toHaveLength(103 - 96);
    expect(dg.seenKeys).toHaveLength(103);
    expect(dg.seenKeys).toContain('mc_st');
  });

  it('a real 0 is kept', () => {
    const rows: RawBulkRow[] = [
      {
        asset_id: '1',
        success: true,
        data: { time: '2026-10-12T11:00:00Z', parameters: { a: 0, b: null, c: false, d: '' } },
      },
    ];
    const r = mapBulkRows(rows).readings[0]!;
    expect(r.values).toStrictEqual({ a: 0, c: false, d: '' });
    expect(r.seenKeys).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a reading where every value is null has empty values but full seenKeys', () => {
    const rows: RawBulkRow[] = [
      {
        asset_id: '1',
        success: true,
        data: { time: '2026-10-12T11:00:00Z', parameters: { x: null, y: null } },
      },
    ];
    const out = mapBulkRows(rows);
    expect(out.readings).toHaveLength(1); // still a reading: the device did report
    expect(out.readings[0]!.values).toStrictEqual({});
    expect(out.readings[0]!.seenKeys).toEqual(['x', 'y']);
  });

  it('leaves status, location, site, type, kind and alerts absent', () => {
    const dg = mapBulkPage(bulk).readings.find((r) => r.externalAssetId === '42485')!;
    for (const k of ['status', 'location', 'siteExternalId', 'assetTypeName', 'kind', 'alerts']) {
      expect(k in dg).toBe(false);
    }
    // lat/long/mc_st/under_maintenance are plain parameter values (Q22: not assumed).
    expect(dg.values['lat']).toBe(25.0774);
    expect(dg.values['long']).toBe(55.31);
  });

  it('success:false rows are no-data; unusable rows are invalid', () => {
    const rows: RawBulkRow[] = [
      { asset_id: '1', success: false },
      { asset_id: '2', success: true, data: { time: 'not a date', parameters: {} } },
      { asset_id: '3', success: true },
      {
        asset_id: '4',
        success: true,
        data: { time: '2026-10-12T11:00:00Z', parameters: { a: 1 } },
      },
    ];
    const m = mapBulkRows(rows);
    expect(m.noData).toEqual(['1']);
    expect(m.invalid).toEqual(['2', '3']);
    expect(m.readings.map((r) => r.externalAssetId)).toEqual(['4']);
  });
});

describe('request bodies', () => {
  it('fleet and id mode bodies are never mixed', () => {
    expect(bulkFleetRequest(2, 500)).toEqual({ page: 2, limit: 500 });
    expect(bulkIdRequest(['1', '2'])).toEqual({ asset_ids: ['1', '2'] });
  });
});
