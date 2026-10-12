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

const list = fixture<RawAssetList>('assets-list-page1.json').body;
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
  it('maps the recorded rows; keys and values pass through unchanged', () => {
    const page = mapBulkPage(bulk);
    expect(page.readings).toHaveLength(4);
    expect(page.noData).toEqual([]);
    expect(page.invalid).toEqual([]);
    for (const row of bulk.data) {
      const r = page.readings.find((x) => x.externalAssetId === row.asset_id)!;
      expect(r.ts).toEqual(new Date(row.data!.time));
      expect(r.values).toEqual(row.data!.parameters);
      expect(Object.keys(r.values)).toEqual(Object.keys(row.data!.parameters));
    }
  });

  it('keeps null as reported (never 0, never dropped)', () => {
    const dg = mapBulkPage(bulk).readings.find((r) => r.externalAssetId === '42485')!;
    expect(dg.values['mc_st']).toBeNull();
    expect('mc_st' in dg.values).toBe(true);
    expect(Object.values(dg.values).filter((v) => v === null).length).toBe(96);
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
