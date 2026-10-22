import { describe, expect, it } from 'vitest';
import {
  mapAsset,
  mapAssetListPage,
  mapLocation,
  type RawAsset,
  type RawAssetList,
} from '../src/index.js';
import { fixture } from './helpers.js';

// Contract tests against the real 2026-10-22 recording (74 assets, site/location/status fields).
const list = fixture<RawAssetList>('assets-list-page1.json').body;
const page = mapAssetListPage(list);

describe('asset list fields (2026-10-22 recording)', () => {
  it('maps all 74 rows with no invalid rows', () => {
    expect(page.assets).toHaveLength(74);
    expect(page.invalidRows).toBe(0);
    expect(page.pagination?.total).toBe(74);
  });

  it('raw field types: site_id is a string, coordinates are numbers, all nullable', () => {
    for (const r of list.data) {
      expect(['string', 'object']).toContain(typeof r.site_id); // string or null
      expect(['string', 'object']).toContain(typeof r.site_name);
      expect(['number', 'object']).toContain(typeof r.latitude);
      expect(['number', 'object']).toContain(typeof r.longitude);
      expect(['string', 'object']).toContain(typeof r.status);
    }
  });

  it('11 assets belong to site GHAFWOODS (1270); the rest have no site', () => {
    const withSite = page.assets.filter((a) => a.sourceSite !== null);
    expect(withSite).toHaveLength(11);
    for (const a of withSite) {
      expect(a.sourceSite).toEqual({ externalId: '1270', name: 'GHAFWOODS' });
      expect(a.siteExternalId).toBe('1270');
    }
    for (const a of page.assets.filter((x) => x.sourceSite === null)) {
      expect(a.siteExternalId).toBeUndefined();
    }
  });

  it('22 assets have a location and a status; the rest are null, never 0', () => {
    expect(page.assets.filter((a) => a.location !== null)).toHaveLength(22);
    expect(page.assets.filter((a) => a.sourceStatus !== null)).toHaveLength(22);
    const a = page.assets.find((x) => x.externalId === '43514')!;
    expect(a.location).toEqual({ lat: 25.077390670776367, lon: 55.3101577758789 });
    const none = page.assets.find((x) => x.externalId === '46568')!;
    expect(none.location).toBeNull();
    expect(none.sourceStatus).toBeNull();
    expect(none.sourceSite).toBeNull();
  });

  it('status is the DATOMS string unchanged', () => {
    const seen = new Map<string, number>();
    for (const a of page.assets) {
      if (a.sourceStatus) seen.set(a.sourceStatus, (seen.get(a.sourceStatus) ?? 0) + 1);
    }
    expect(Object.fromEntries(seen)).toEqual({ connected: 13, running: 4, offline: 3, stopped: 2 });
  });
});

describe('asset list field edge cases', () => {
  const base: RawAsset = { id: '1' };

  it('absent fields map to null, not 0 or ""', () => {
    const a = mapAsset(base);
    expect(a.sourceSite).toBeNull();
    expect(a.location).toBeNull();
    expect(a.sourceStatus).toBeNull();
    expect(a.siteExternalId).toBeUndefined();
  });

  it('a numeric site_id becomes a string external id; a site without a name keeps the id', () => {
    const a = mapAsset({ ...base, site_id: 1270, site_name: null });
    expect(a.sourceSite).toEqual({ externalId: '1270', name: null });
  });

  it('out-of-range coordinates become null and do not drop the row', () => {
    const body: RawAssetList = {
      data: [
        { id: '1', latitude: 95, longitude: 55 },
        { id: '2', latitude: 25, longitude: 181 },
        { id: '3', latitude: 25, longitude: null },
        { id: '4', latitude: 'north', longitude: 55 } as unknown as RawAsset,
        { id: '5', latitude: 25.1, longitude: 55.3, status: 'running' },
      ],
      pagination: { total: 5, page: 1, limit: 1000, total_pages: 1 },
    };
    const p = mapAssetListPage(body);
    expect(p.invalidRows).toBe(0);
    expect(p.assets.map((a) => a.location)).toEqual([
      null,
      null,
      null,
      null,
      { lat: 25.1, lon: 55.3 },
    ]);
    expect(p.assets[4]!.sourceStatus).toBe('running');
  });

  it('0,0 is treated as missing; a single zero axis is a valid position', () => {
    expect(mapLocation(0, 0)).toBeNull();
    expect(mapLocation(0, 55)).toEqual({ lat: 0, lon: 55 });
    expect(mapLocation(Number.NaN, 55)).toBeNull();
    expect(mapLocation(undefined, undefined)).toBeNull();
  });

  it('wrong-typed or oversized site/status values become null, the row is kept', () => {
    const p = mapAssetListPage({
      data: [
        {
          id: '1',
          site_id: { x: 1 },
          status: 5,
          site_name: 'x'.repeat(600),
        } as unknown as RawAsset,
        { id: '2', status: '' },
      ],
      pagination: { total: 2, page: 1, limit: 1000, total_pages: 1 },
    });
    expect(p.invalidRows).toBe(0);
    expect(p.assets[0]!.sourceSite).toBeNull();
    expect(p.assets[0]!.sourceStatus).toBeNull();
    expect(p.assets[1]!.sourceStatus).toBeNull();
  });

  it('unknown extra fields are ignored', () => {
    const a = mapAssetListPage({
      data: [{ id: '1', brand_new_field: { a: 1 } } as unknown as RawAsset],
      pagination: { total: 1, page: 1, limit: 1000, total_pages: 1 },
    });
    expect(a.assets).toHaveLength(1);
  });
});
